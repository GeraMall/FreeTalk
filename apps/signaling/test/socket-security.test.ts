import { once } from 'node:events';
import type { Server } from 'node:http';
import { WebSocket } from 'ws';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  record: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/authorization.js', () => ({
  assertAuthorizationConfigured: vi.fn(),
  authorizeRoom: mocks.authorize,
  recordCallEvent: mocks.record,
  recordTelemetry: vi.fn(),
  getRegisteredProfile: vi.fn(),
}));
vi.mock('../src/turn.js', () => ({
  getIceConfig: async () => ({ type: 'ice-config', iceServers: [] }),
}));
let server: Server;
let url: string;
afterEach(() => mocks.authorize.mockClear());
beforeAll(async () => {
  vi.stubEnv('PORT', '0');
  vi.stubEnv('ALLOWED_ORIGIN', '*');
  server = (await import('../src/server.js')).httpServer;
  if (!server.listening) await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  url = `ws://127.0.0.1:${address.port}/ws`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.unstubAllEnvs();
});
const join = (roomId: string) =>
  JSON.stringify({
    type: 'create-room',
    roomId,
    clientId: '00000000-0000-4000-8000-000000000001',
    sessionId: 'session-123456789',
    name: 'Person',
  });
describe('socket authorization races', () => {
  it('keeps temporary API failure recoverable instead of terminating the user call', async () => {
    mocks.authorize.mockResolvedValueOnce({ allowed: false, reason: 'AUTH_UNAVAILABLE' });
    const socket = new WebSocket(url),
      messages: unknown[] = [];
    socket.on('message', (data) => messages.push(JSON.parse(String(data))));
    await once(socket, 'open');
    const closed = once(socket, 'close');
    socket.send(join('ABCDEFGH2359'));
    expect((await closed)[0]).toBe(1013);
    expect(messages).toEqual([]);
  });
  it('rejects a concurrent room request while authorization is pending', async () => {
    let release!: (value: object) => void;
    mocks.authorize.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const socket = new WebSocket(url);
    await once(socket, 'open');
    const response = once(socket, 'message');
    socket.send(join('ABCDEFGH2345'));
    socket.send(join('ABCDEFGH2346'));
    expect(JSON.parse(String((await response)[0]))).toMatchObject({
      type: 'error',
      code: 'INVALID_MESSAGE',
    });
    expect(mocks.authorize).toHaveBeenCalledTimes(1);
    const created = new Promise<void>((resolve) =>
      socket.on('message', (data) => {
        if (JSON.parse(String(data)).type === 'room-created') resolve();
      }),
    );
    release({ allowed: true, kind: 'registered', userId: 'account', displayName: 'Person' });
    await created;
    const closed = once(socket, 'close');
    socket.close(1000);
    await closed;
  });
  it('does not create a ghost room when the socket closes during authorization', async () => {
    mocks.record.mockClear();
    let release!: (value: object) => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => {
      entered = resolve;
    });
    mocks.authorize.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
          entered();
        }),
    );
    const socket = new WebSocket(url);
    await once(socket, 'open');
    socket.send(join('ABCDEFGH2347'));
    await pending;
    const closed = once(socket, 'close');
    socket.close(1000);
    await closed;
    release({ allowed: true, kind: 'registered', userId: 'account', displayName: 'Person' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(mocks.record.mock.calls.some(([event]) => event.roomId === 'ABCDEFGH2347')).toBe(false);
  });
});

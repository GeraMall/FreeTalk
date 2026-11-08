import { once } from 'node:events';
import type { Server } from 'node:http';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RoomActivity, RoomActivityAction } from '@freetalk/protocol';
vi.mock('../src/authorization.js', () => ({
  assertAuthorizationConfigured: vi.fn(),
  authorizeRoom: async () => ({ allowed: true, kind: 'development' }),
  recordCallEvent: async () => {},
  recordTelemetry: async () => {},
  getRegisteredProfile: async () => null,
}));
vi.mock('../src/turn.js', () => ({
  getIceConfig: async () => ({ type: 'ice-config', iceServers: [] }),
}));
let server: Server, url: string;
const sockets: WebSocket[] = [];
beforeAll(async () => {
  vi.stubEnv('PORT', '0');
  vi.stubEnv('ALLOWED_ORIGIN', '*');
  server = (await import('../src/server.js')).httpServer;
  if (!server.listening) await once(server, 'listening');
  const a = server.address();
  if (!a || typeof a === 'string') throw Error('No port');
  url = `ws://127.0.0.1:${a.port}/ws`;
});
afterAll(async () => {
  for (const s of sockets) s.terminate();
  await new Promise<void>((r) => server.close(() => r()));
  vi.unstubAllEnvs();
});
async function until(predicate: () => boolean) {
  const end = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > end) throw Error('Snapshot timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
}
describe('monopoly shared socket state', () => {
  it('broadcasts the same authoritative throw to six players and rejects actions during token travel', async () => {
    const states: (RoomActivity | undefined)[] = [],
      errors: unknown[] = [];
    const ids = Array.from(
      { length: 6 },
      (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    );
    for (let i = 0; i < 6; i++) {
      const s = new WebSocket(url);
      sockets.push(s);
      s.on('message', (data) => {
        const m = JSON.parse(String(data));
        if (m.type === 'activity-state' || m.type === 'joined-room') states[i] = m.activity;
        if (m.type === 'error') errors.push(m);
      });
      await once(s, 'open');
      const response = once(s, 'message');
      s.send(
        JSON.stringify({
          type: i === 0 ? 'create-room' : 'join-room',
          roomId: 'MNPLXYZB2345',
          clientId: ids[i],
          sessionId: `monopoly-session-00000${i}`,
          name: `Player ${i}`,
          activityVersion: 2,
          tabletVersion: 3,
          propertyRules: 2,
        }),
      );
      await response;
    }
    async function act(i: number, action: RoomActivityAction) {
      const revision = states[i]?.revision ?? 0;
      sockets[i]!.send(JSON.stringify({ type: 'activity-action', revision, action }));
      await until(() => !!states[0] && states[0].revision > revision);
      await until(() => states.every((s) => s?.revision === states[0]?.revision));
    }
    await act(0, { kind: 'open' });
    await act(0, { kind: 'table-open', game: 'monopoly', edition: 3, propertyRules: 2 });
    for (let i = 1; i < 6; i++) await act(i, { kind: 'table-seat', seat: i });
    await act(0, { kind: 'table-start' });
    await act(0, { kind: 'property', action: 'roll' });
    const v = states[0]!.table;
    if (v?.kind !== 'monopoly') throw Error('Wrong game');
    expect(v.propertyRules).toBe(2);
    expect(v.seats).toHaveLength(6);
    expect(v.lastMove?.sequence).toBe(1);
    expect(v.lastMove!.until).toBeGreaterThan(v.lastMove!.at);
    expect(v.dice.every((d) => d >= 1 && d <= 6)).toBe(true);
    for (const s of states) expect(s?.table).toEqual(v);
    const revision = states[0]!.revision;
    sockets[0]!.send(
      JSON.stringify({
        type: 'activity-action',
        revision,
        action: { kind: 'property', action: 'roll' },
      }),
    );
    await new Promise((r) => setTimeout(r, 80));
    expect(states[0]!.revision).toBe(revision);
    expect(errors).toEqual([]);
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { createAccountSocket } from './signaling-transport';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(invoke).mockReset();
});

describe('desktop account transport', () => {
  it('uses native network I/O in a hidden desktop window and preserves authentication ordering', async () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const browserSocket = vi.spyOn(window, 'WebSocket');
    let receive: ((event: unknown) => void) | undefined;
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === 'signaling_receive')
        return new Promise((resolve) => {
          receive = resolve;
        });
      return Promise.resolve(undefined);
    });
    const socket = createAccountSocket(
      'wss://freetalk.191-44-38-60.sslip.io/api/v1/chats/realtime',
    );
    const opened = vi.fn();
    socket.addEventListener('open', opened);
    const message = vi.fn();
    socket.addEventListener('message', message);
    await vi.waitFor(() => expect(receive).toBeTypeOf('function'));
    receive!({ kind: 'open' });
    await vi.waitFor(() => expect(opened).toHaveBeenCalledOnce());
    socket.send('{"type":"authenticate","token":"test-token"}');
    socket.send('{"type":"presence","status":"online"}');
    await vi.waitFor(() =>
      expect(
        vi.mocked(invoke).mock.calls.filter(([command]) => command === 'signaling_send'),
      ).toHaveLength(2),
    );
    const sends = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'signaling_send');
    expect(sends.map(([, args]) => JSON.parse((args as { message: string }).message).type)).toEqual(
      ['authenticate', 'presence'],
    );
    receive!({ kind: 'message', data: '{"type":"ready"}' });
    await vi.waitFor(() => expect(message).toHaveBeenCalledOnce());
    expect(browserSocket).not.toHaveBeenCalled();
    socket.close();
    await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.CLOSED));
    receive!({ kind: 'close', code: 1000, reason: '', initiatedBy: 'client' });
  });
});

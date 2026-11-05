// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accountClient } from './api-client';
import { AWAY_AFTER_MS, ChatRealtimeClient } from './chat-realtime';
import { setPresenceMode } from './presence-preference';
import { markVoiceActivity, setCallActive } from './presence-activity';

class FakeWebSocket extends EventTarget {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  sent: string[] = [];
  readyState = FakeWebSocket.OPEN;

  constructor(readonly url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  open() {
    this.dispatchEvent(new Event('open'));
  }

  receive(payload: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(payload) }));
  }

  close() {
    this.dispatchEvent(new Event('close'));
  }
}

describe('ChatRealtimeClient', () => {
  beforeEach(() => {
    setCallActive(false);
    localStorage.clear();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.spyOn(accountClient, 'realtimeAccessToken').mockResolvedValue('a'.repeat(48));
  });

  afterEach(() => {
    setCallActive(false);
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reports away after five idle minutes and returns online on activity', async () => {
    vi.useFakeTimers();
    const onPresence = vi.fn();
    const client = new ChatRealtimeClient(vi.fn(), onPresence);
    client.start();
    await Promise.resolve();
    await Promise.resolve();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.receive({ type: 'ready' });
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ type: 'presence', status: 'online' });

    vi.advanceTimersByTime(AWAY_AFTER_MS);
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ type: 'presence', status: 'away' });
    expect(onPresence).toHaveBeenLastCalledWith('away');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ type: 'presence', status: 'online' });
    expect(onPresence).toHaveBeenLastCalledWith('online');
    client.stop();
  });

  it('counts speech as activity in a call and becomes away after five silent idle minutes', async () => {
    vi.useFakeTimers();
    setCallActive(true);
    const client = new ChatRealtimeClient(vi.fn());
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.receive({ type: 'ready' });
    for (let minute = 0; minute < 8; minute++) {
      await vi.advanceTimersByTimeAsync(60_000);
      markVoiceActivity();
    }
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ type: 'presence', status: 'online' });
    await vi.advanceTimersByTimeAsync(AWAY_AFTER_MS - 1);
    expect(JSON.parse(socket.sent.at(-1)!).status).toBe('online');
    await vi.advanceTimersByTimeAsync(1);
    expect(JSON.parse(socket.sent.at(-1)!).status).toBe('away');
    markVoiceActivity();
    expect(JSON.parse(socket.sent.at(-1)!).status).toBe('online');
    client.stop();
  });
  it('respects manually selected invisible, away and do-not-disturb during a call', async () => {
    vi.useFakeTimers();
    const client = new ChatRealtimeClient(vi.fn());
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.receive({ type: 'ready' });
    setCallActive(true);
    for (const [mode, status] of [
      ['invisible', 'offline'],
      ['dnd', 'dnd'],
      ['away', 'away'],
    ] as const) {
      setPresenceMode(mode);
      markVoiceActivity();
      await vi.advanceTimersByTimeAsync(AWAY_AFTER_MS * 2);
      expect(JSON.parse(socket.sent.at(-1)!).status).toBe(status);
    }
    client.stop();
  });

  it('authenticates and delivers a message event immediately', async () => {
    const listener = vi.fn();
    const client = new ChatRealtimeClient(listener);
    client.start();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    expect(JSON.parse(socket.sent[0]!)).toEqual({ type: 'authenticate', token: 'a'.repeat(48) });

    socket.receive({ type: 'ready' });
    const event = {
      type: 'message-created',
      chatId: crypto.randomUUID(),
      message: {
        id: crypto.randomUUID(),
        kind: 'text',
        body: 'Мгновенное сообщение',
        metadata: {},
        sender_id: crypto.randomUUID(),
        username: 'friend_1',
        display_name: 'Друг',
        created_at: new Date().toISOString(),
        expires_at: null,
      },
    };
    socket.receive(event);
    expect(listener).toHaveBeenCalledWith(event);
    client.stop();
  });

  it('requests a fresh snapshot after each authenticated reconnect and ignores a retired socket', async () => {
    vi.useFakeTimers();
    const onReady = vi.fn();
    const client = new ChatRealtimeClient(vi.fn(), undefined, onReady);
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    const first = FakeWebSocket.instances[0]!;
    first.open();
    expect(onReady).not.toHaveBeenCalled();
    first.receive({ type: 'ready' });
    expect(onReady).toHaveBeenCalledTimes(1);
    first.close();
    await vi.advanceTimersByTimeAsync(1_000);
    const second = FakeWebSocket.instances[1]!;
    second.open();
    first.receive({ type: 'ready' });
    expect(onReady).toHaveBeenCalledTimes(1);
    second.receive({ type: 'ready' });
    expect(onReady).toHaveBeenCalledTimes(2);
    client.stop();
  });

  it('keeps the realtime socket open while reporting invisible as offline', async () => {
    const onPresence = vi.fn();
    const client = new ChatRealtimeClient(vi.fn(), onPresence);
    client.start();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.receive({ type: 'ready' });

    setPresenceMode('invisible');

    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ type: 'presence', status: 'offline' });
    expect(socket.readyState).toBe(FakeWebSocket.OPEN);
    expect(onPresence).toHaveBeenLastCalledWith('offline');
    client.stop();
  });

  it('keeps a hidden window online, becomes away on idle, and goes offline only on stop', async () => {
    vi.useFakeTimers();
    const onPresence = vi.fn();
    const client = new ChatRealtimeClient(vi.fn(), onPresence);
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeWebSocket.instances[0]!;
    const close = vi.spyOn(socket, 'close');
    socket.open();
    socket.receive({ type: 'ready' });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('blur'));
    await vi.advanceTimersByTimeAsync(AWAY_AFTER_MS - 1);
    expect(onPresence).toHaveBeenLastCalledWith('online');
    expect(close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onPresence).toHaveBeenLastCalledWith('away');
    expect(close).not.toHaveBeenCalled();
    client.stop();
    expect(onPresence).toHaveBeenLastCalledWith('offline');
    expect(close).toHaveBeenCalledOnce();
  });

  it('ignores a late close from a retired socket after reconnect', async () => {
    vi.useFakeTimers();
    const onPresence = vi.fn();
    const client = new ChatRealtimeClient(vi.fn(), onPresence);
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    const first = FakeWebSocket.instances[0]!;
    first.open();
    first.receive({ type: 'ready' });
    first.close();
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    const second = FakeWebSocket.instances[1]!;
    second.open();
    second.receive({ type: 'ready' });
    onPresence.mockClear();
    first.close();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onPresence).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(2);
    client.stop();
  });
});

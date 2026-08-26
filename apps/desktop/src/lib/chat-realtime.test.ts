// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accountClient } from './api-client';
import { AWAY_AFTER_MS, ChatRealtimeClient } from './chat-realtime';

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
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.spyOn(accountClient, 'realtimeAccessToken').mockResolvedValue('a'.repeat(48));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reports away after ten idle minutes and returns online on activity', async () => {
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
});

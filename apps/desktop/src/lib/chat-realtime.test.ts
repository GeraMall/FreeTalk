// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accountClient } from './api-client';
import { ChatRealtimeClient } from './chat-realtime';

class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];
  sent: string[] = [];

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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

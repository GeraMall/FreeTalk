import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { ChatRealtimeHub } from '../src/chat-realtime.js';

function fakeSocket(bufferedAmount = 0) {
  return {
    readyState: 1,
    bufferedAmount,
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as WebSocket;
}

describe('ChatRealtimeHub', () => {
  it('delivers a chat event only to intended users and removes closed connections', () => {
    const hub = new ChatRealtimeHub();
    const first = fakeSocket();
    const second = fakeSocket();
    const removeFirst = hub.add('user-a', first);
    hub.add('user-b', second);

    hub.publish(['user-a'], { type: 'history-cleared', chatId: crypto.randomUUID() });
    expect(first.send).toHaveBeenCalledOnce();
    expect(second.send).not.toHaveBeenCalled();

    removeFirst();
    expect(hub.connectionCount()).toBe(1);
  });

  it('disconnects a slow consumer instead of growing its memory buffer', () => {
    const hub = new ChatRealtimeHub();
    const socket = fakeSocket(300 * 1024);
    hub.add('user-a', socket);
    hub.publish(['user-a'], { type: 'history-cleared', chatId: crypto.randomUUID() });
    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledWith(1013, 'Client is too slow');
  });
});

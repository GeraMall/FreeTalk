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

  it('aggregates online, away and offline across all user devices', () => {
    const hub = new ChatRealtimeHub();
    const changes = vi.fn();
    hub.onPresenceChanged(changes);
    const desktop = fakeSocket();
    const laptop = fakeSocket();
    const removeDesktop = hub.add('user-a', desktop);
    const removeLaptop = hub.add('user-a', laptop);

    expect(hub.presence('user-a')).toBe('online');
    hub.setPresence('user-a', desktop, 'away');
    expect(hub.presence('user-a')).toBe('online');
    hub.setPresence('user-a', laptop, 'away');
    expect(hub.presence('user-a')).toBe('away');
    removeDesktop();
    expect(hub.presence('user-a')).toBe('away');
    removeLaptop();
    expect(hub.presence('user-a')).toBe('offline');
    expect(changes).toHaveBeenCalledWith('user-a', 'offline');
  });
});

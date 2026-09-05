import type { WebSocket } from 'ws';
import type { ChatRealtimeServerMessage, PresenceStatus } from '@freetalk/protocol';

export type { ChatRealtimeServerMessage, PresenceStatus } from '@freetalk/protocol';

const MAX_BUFFERED_BYTES = 256 * 1024;

export class ChatRealtimeHub {
  private readonly socketsByUser = new Map<string, Set<WebSocket>>();
  private readonly statusBySocket = new Map<WebSocket, PresenceStatus>();
  private presenceListener?: (userId: string, status: PresenceStatus) => void;

  onPresenceChanged(listener: (userId: string, status: PresenceStatus) => void) {
    this.presenceListener = listener;
  }

  presence(userId: string): PresenceStatus {
    const sockets = this.socketsByUser.get(userId);
    if (!sockets?.size) return 'offline';
    for (const socket of sockets) if (this.statusBySocket.get(socket) === 'online') return 'online';
    for (const socket of sockets) if (this.statusBySocket.get(socket) === 'dnd') return 'dnd';
    for (const socket of sockets) if (this.statusBySocket.get(socket) === 'away') return 'away';
    return 'offline';
  }

  add(userId: string, socket: WebSocket) {
    const before = this.presence(userId);
    const sockets = this.socketsByUser.get(userId) ?? new Set<WebSocket>();
    sockets.add(socket);
    this.statusBySocket.set(socket, 'online');
    this.socketsByUser.set(userId, sockets);
    this.emitPresenceChange(userId, before);
    return () => {
      const previous = this.presence(userId);
      sockets.delete(socket);
      this.statusBySocket.delete(socket);
      if (sockets.size === 0) this.socketsByUser.delete(userId);
      this.emitPresenceChange(userId, previous);
    };
  }

  setPresence(userId: string, socket: WebSocket, status: PresenceStatus) {
    if (!this.socketsByUser.get(userId)?.has(socket)) return;
    const before = this.presence(userId);
    this.statusBySocket.set(socket, status);
    this.emitPresenceChange(userId, before);
  }

  private emitPresenceChange(userId: string, before: PresenceStatus) {
    const after = this.presence(userId);
    if (after !== before) this.presenceListener?.(userId, after);
  }

  publish(userIds: Iterable<string>, event: ChatRealtimeServerMessage) {
    const payload = JSON.stringify(event);
    for (const userId of new Set(userIds)) {
      for (const socket of this.socketsByUser.get(userId) ?? []) {
        if (socket.readyState !== 1) continue;
        if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
          socket.close(1013, 'Client is too slow');
          continue;
        }
        try {
          socket.send(payload);
        } catch {
          try {
            socket.close(1011, 'Realtime delivery failed');
          } catch {
            // The close event removes this socket; keep delivering to other members.
          }
        }
      }
    }
  }

  connectionCount() {
    let count = 0;
    for (const sockets of this.socketsByUser.values()) count += sockets.size;
    return count;
  }
}

export const chatRealtimeHub = new ChatRealtimeHub();

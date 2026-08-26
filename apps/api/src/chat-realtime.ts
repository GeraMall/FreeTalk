import type { WebSocket } from 'ws';

type RealtimeChatMessage = {
  id: string;
  kind: 'text' | 'system' | 'call';
  body: string;
  metadata?: Record<string, unknown>;
  sender_id: string | null;
  username?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  created_at: string;
  expires_at: string | null;
};

export type ChatRealtimeServerMessage =
  | { type: 'ready' }
  | { type: 'message-created'; chatId: string; message: RealtimeChatMessage }
  | { type: 'history-cleared'; chatId: string }
  | { type: 'profile-updated'; userId: string }
  | {
      type: 'retention-changed';
      chatId: string;
      retentionHours: 24 | 168 | 720 | null;
    };

const MAX_BUFFERED_BYTES = 256 * 1024;

export class ChatRealtimeHub {
  private readonly socketsByUser = new Map<string, Set<WebSocket>>();

  add(userId: string, socket: WebSocket) {
    const sockets = this.socketsByUser.get(userId) ?? new Set<WebSocket>();
    sockets.add(socket);
    this.socketsByUser.set(userId, sockets);
    return () => {
      sockets.delete(socket);
      if (sockets.size === 0) this.socketsByUser.delete(userId);
    };
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
        socket.send(payload);
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

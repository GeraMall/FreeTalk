import type { WebSocket } from 'ws';
export type PresenceStatus = 'online' | 'away' | 'dnd' | 'offline';

type RealtimeChatMessage = {
  id: string;
  kind: 'text' | 'system' | 'call' | 'image';
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
  | {
      type: 'message-updated';
      chatId: string;
      messageId: string;
      metadata: Record<string, unknown>;
    }
  | { type: 'history-cleared'; chatId: string }
  | { type: 'profile-updated'; userId: string }
  | {
      type: 'chat-updated';
      chatId: string;
      avatarUrl: string | null;
      avatarPositionX: number;
      avatarPositionY: number;
      avatarScale: number;
    }
  | { type: 'presence-updated'; userId: string; status: PresenceStatus }
  | {
      type: 'retention-changed';
      chatId: string;
      retentionHours: 24 | 168 | 720 | null;
    };

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

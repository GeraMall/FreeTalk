import { ROOM_MAX_PARTICIPANTS } from '@freetalk/config';
import type { Participant, RoomChatMessage, ServerMessage } from '@freetalk/protocol';

export interface PeerConnection {
  send(message: ServerMessage): void;
  close(code?: number, reason?: string): void;
}

interface Peer {
  participant: Participant;
  sessionId: string;
  connection: PeerConnection;
  lastSeen: number;
  profileChanges: number[];
  lastReactionAt: number;
}

interface Room {
  id: string;
  ownerId: string;
  peers: Map<string, Peer>;
  createdAt: number;
  chatMessages: RoomChatMessage[];
}

export class RoomError extends Error {
  constructor(
    public readonly code: 'ROOM_NOT_FOUND' | 'ROOM_EXISTS' | 'ROOM_FULL',
    message: string,
  ) {
    super(message);
  }
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  create(
    roomId: string,
    clientId: string,
    sessionId: string,
    name: string,
    connection: PeerConnection,
    avatar?: string,
  ) {
    if (this.rooms.has(roomId)) throw new RoomError('ROOM_EXISTS', 'Комната уже существует');
    this.rooms.set(roomId, {
      id: roomId,
      ownerId: clientId,
      peers: new Map(),
      createdAt: Date.now(),
      chatMessages: [],
    });
    return this.join(roomId, clientId, sessionId, name, connection, avatar);
  }

  join(
    roomId: string,
    clientId: string,
    sessionId: string,
    name: string,
    connection: PeerConnection,
    avatar?: string,
  ) {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', 'Комната не найдена');

    const existing = room.peers.get(clientId);
    if (!existing && room.peers.size >= ROOM_MAX_PARTICIPANTS) {
      throw new RoomError('ROOM_FULL', 'В комнате уже восемь участников');
    }
    if (existing && existing.sessionId !== sessionId) {
      throw new RoomError('ROOM_FULL', 'Этот идентификатор участника уже используется');
    }

    const participant: Participant = existing?.participant ?? {
      id: clientId,
      name,
      avatar,
      muted: false,
      isOwner: clientId === room.ownerId,
      connectedAt: Date.now(),
    };
    if (existing) existing.connection.close(4001, 'Соединение заменено после переподключения');
    participant.name = name;
    participant.avatar = avatar;
    participant.isOwner = clientId === room.ownerId;
    const peer: Peer = {
      participant,
      sessionId,
      connection,
      lastSeen: Date.now(),
      profileChanges: existing?.profileChanges ?? [],
      lastReactionAt: existing?.lastReactionAt ?? 0,
    };
    room.peers.set(clientId, peer);

    connection.send({
      type: 'joined-room',
      roomId,
      selfId: clientId,
      roomStartedAt: room.createdAt,
      participants: [...room.peers.values()].map((entry) => entry.participant),
      roomChatMessages: room.chatMessages,
    });
    if (!existing) this.broadcast(room, { type: 'participant-joined', participant }, clientId);
    return participant;
  }

  leave(roomId: string, clientId: string, connection?: PeerConnection, reason = 'Участник вышел') {
    const room = this.rooms.get(roomId);
    const peer = room?.peers.get(clientId);
    if (!room || !peer || (connection && peer.connection !== connection)) return false;
    room.peers.delete(clientId);
    this.broadcast(room, { type: 'participant-left', participantId: clientId, reason });
    if (room.peers.size === 0) this.rooms.delete(roomId);
    else if (room.ownerId === clientId) {
      const nextOwner = [...room.peers.values()].sort(
        (a, b) => a.participant.connectedAt - b.participant.connectedAt,
      )[0]!;
      room.ownerId = nextOwner.participant.id;
      for (const entry of room.peers.values())
        entry.participant.isOwner = entry.participant.id === room.ownerId;
      this.broadcast(room, { type: 'owner-changed', ownerId: room.ownerId });
    }
    return true;
  }

  relay(
    roomId: string,
    from: string,
    to: string,
    message: Extract<ServerMessage, { type: 'offer' | 'answer' | 'ice-candidate' }>,
  ) {
    const room = this.rooms.get(roomId);
    if (!room?.peers.has(from)) return false;
    const target = room.peers.get(to);
    if (!target) return false;
    target.connection.send(message);
    return true;
  }

  setMuted(roomId: string, clientId: string, muted: boolean) {
    const room = this.rooms.get(roomId);
    const peer = room?.peers.get(clientId);
    if (!room || !peer) return false;
    peer.participant.muted = muted;
    this.broadcast(room, { type: 'mute-changed', participantId: clientId, muted });
    return true;
  }

  updateProfile(
    roomId: string,
    clientId: string,
    name: string,
    avatar: string | undefined,
    now = Date.now(),
  ) {
    const room = this.rooms.get(roomId);
    const peer = room?.peers.get(clientId);
    if (!room || !peer) return 'TARGET_NOT_FOUND' as const;
    if (peer.participant.name === name && peer.participant.avatar === avatar) return 'OK' as const;
    peer.profileChanges = peer.profileChanges.filter((time) => now - time < 5 * 60 * 60 * 1000);
    if (peer.profileChanges.length >= 5) return 'RATE_LIMITED' as const;
    peer.profileChanges.push(now);
    peer.participant.name = name;
    peer.participant.avatar = avatar;
    this.broadcast(room, { type: 'participant-updated', participant: peer.participant });
    return 'OK' as const;
  }

  react(
    roomId: string,
    clientId: string,
    id: string,
    reaction: '👍' | '❤️' | '😂' | '🎉' | '🔥',
    now = Date.now(),
  ) {
    const room = this.rooms.get(roomId);
    const peer = room?.peers.get(clientId);
    if (!room || !peer) return false;
    if (now - peer.lastReactionAt < 500) return false;
    peer.lastReactionAt = now;
    this.broadcast(room, { type: 'reaction', id, participantId: clientId, reaction });
    return true;
  }

  chat(roomId: string, clientId: string, id: string, text: string, now = Date.now()) {
    const room = this.rooms.get(roomId);
    const peer = room?.peers.get(clientId);
    if (!room || !peer) return false;
    if (room.chatMessages.some((message) => message.id === id)) return true;
    const message: RoomChatMessage = {
      id,
      participantId: clientId,
      senderName: peer.participant.name,
      text,
      timestamp: now,
    };
    room.chatMessages.push(message);
    if (room.chatMessages.length > 200) room.chatMessages.splice(0, room.chatMessages.length - 200);
    this.broadcast(room, { type: 'room-chat-message', message });
    return true;
  }

  recordingStarted(roomId: string, clientId: string, now = Date.now()) {
    const room = this.rooms.get(roomId);
    const peer = room?.peers.get(clientId);
    if (!room || !peer) return 'TARGET_NOT_FOUND' as const;
    if (room.ownerId !== clientId) return 'NOT_OWNER' as const;
    this.broadcast(room, {
      type: 'recording-started',
      participantId: clientId,
      participantName: peer.participant.name,
      timestamp: now,
    });
    return 'OK' as const;
  }

  moderationMute(roomId: string, requesterId: string, targetId: string) {
    const room = this.rooms.get(roomId);
    if (!room || room.ownerId !== requesterId) return 'NOT_OWNER' as const;
    const target = room.peers.get(targetId);
    if (!target || targetId === requesterId) return 'TARGET_NOT_FOUND' as const;
    target.participant.muted = true;
    target.connection.send({ type: 'force-mute', byParticipantId: requesterId });
    this.broadcast(room, { type: 'mute-changed', participantId: targetId, muted: true });
    return 'OK' as const;
  }

  touch(roomId: string, clientId: string, now = Date.now()) {
    const peer = this.rooms.get(roomId)?.peers.get(clientId);
    if (peer) peer.lastSeen = now;
  }

  removeStale(maxAgeMs: number, now = Date.now()) {
    for (const room of [...this.rooms.values()]) {
      for (const [clientId, peer] of [...room.peers]) {
        if (now - peer.lastSeen > maxAgeMs) {
          peer.connection.close(4000, 'Тайм-аут');
          this.leave(room.id, clientId, peer.connection, 'Соединение потеряно');
        }
      }
    }
  }

  hasRoom(roomId: string) {
    return this.rooms.has(roomId);
  }
  roomSize(roomId: string) {
    return this.rooms.get(roomId)?.peers.size ?? 0;
  }
  hasParticipant(roomId: string, clientId: string) {
    return this.rooms.get(roomId)?.peers.has(clientId) ?? false;
  }

  private broadcast(room: Room, message: ServerMessage, exceptId?: string) {
    for (const [id, peer] of room.peers) if (id !== exceptId) peer.connection.send(message);
  }
}

import { ROOM_MAX_PARTICIPANTS } from '@freetalk/config';
import type { Participant, ServerMessage } from '@freetalk/protocol';

export interface PeerConnection {
  send(message: ServerMessage): void;
  close(code?: number, reason?: string): void;
}

interface Peer {
  participant: Participant;
  sessionId: string;
  connection: PeerConnection;
  lastSeen: number;
}

interface Room {
  id: string;
  ownerId: string;
  peers: Map<string, Peer>;
  createdAt: number;
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
  ) {
    if (this.rooms.has(roomId)) throw new RoomError('ROOM_EXISTS', 'Комната уже существует');
    this.rooms.set(roomId, {
      id: roomId,
      ownerId: clientId,
      peers: new Map(),
      createdAt: Date.now(),
    });
    return this.join(roomId, clientId, sessionId, name, connection);
  }

  join(
    roomId: string,
    clientId: string,
    sessionId: string,
    name: string,
    connection: PeerConnection,
  ) {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', 'Комната не найдена');

    const existing = room.peers.get(clientId);
    if (!existing && room.peers.size >= ROOM_MAX_PARTICIPANTS) {
      throw new RoomError('ROOM_FULL', 'В комнате уже шесть участников');
    }
    if (existing && existing.sessionId !== sessionId) {
      throw new RoomError('ROOM_FULL', 'Этот идентификатор участника уже используется');
    }

    const participant: Participant = existing?.participant ?? {
      id: clientId,
      name,
      muted: false,
      isOwner: clientId === room.ownerId,
      connectedAt: Date.now(),
    };
    if (existing) existing.connection.close(4001, 'Соединение заменено после переподключения');
    participant.name = name;
    participant.isOwner = clientId === room.ownerId;
    const peer: Peer = { participant, sessionId, connection, lastSeen: Date.now() };
    room.peers.set(clientId, peer);

    connection.send({
      type: 'joined-room',
      roomId,
      selfId: clientId,
      participants: [...room.peers.values()].map((entry) => entry.participant),
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

  touch(roomId: string, clientId: string) {
    const peer = this.rooms.get(roomId)?.peers.get(clientId);
    if (peer) peer.lastSeen = Date.now();
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

  private broadcast(room: Room, message: ServerMessage, exceptId?: string) {
    for (const [id, peer] of room.peers) if (id !== exceptId) peer.connection.send(message);
  }
}

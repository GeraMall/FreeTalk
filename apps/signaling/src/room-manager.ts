import { mergeParticipantAudioState } from '@freetalk/protocol';
import { ROOM_MAX_PARTICIPANTS } from '@freetalk/config';
import {
  applyRoomActivity,
  emptyRoomActivity,
  roomActivityView,
  tickRoomActivity,
  type RoomActivitySession,
  type RoomActivityAction,
} from '@freetalk/protocol';
import type {
  Participant,
  ParticipantCardDecoration,
  ParticipantCardStyle,
  RoomChatMessage,
  ServerMessage,
} from '@freetalk/protocol';

export interface PeerConnection {
  canUseActivity?: boolean;
  activityVersion?: 2;
  pokerSeats?: 8;
  tabletVersion?: 3;
  pokerFlow?: 2;
  isAdult?: boolean;
  lastAgeCheckAt?: number;
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
  lastActivityAt: number;
  lastPointerAt: number;
  lastActivityResyncAt: number;
}

interface Room {
  id: string;
  ownerId?: string;
  authority: RoomAuthority;
  peers: Map<string, Peer>;
  createdAt: number;
  chatMessages: RoomChatMessage[];
  activity: RoomActivitySession;
  identities: Map<string, { sessionId: string; accountId?: string }>;
}

export type RoomAuthority =
  { scope: 'standalone' } | { scope: 'direct' } | { scope: 'group'; groupOwnerAccountId?: string };

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
    accountId?: string,
    authority: RoomAuthority = { scope: 'standalone' },
    cardStyle: ParticipantCardStyle = 'avatar-glass',
    _cardDecoration: ParticipantCardDecoration = 'none',
  ) {
    void _cardDecoration;
    if (this.rooms.has(roomId)) throw new RoomError('ROOM_EXISTS', 'Комната уже существует');
    this.rooms.set(roomId, {
      id: roomId,
      ownerId: authority.scope === 'standalone' ? clientId : undefined,
      authority,
      peers: new Map(),
      createdAt: Date.now(),
      chatMessages: [],
      activity: emptyRoomActivity(),
      identities: new Map(),
    });
    return this.join(
      roomId,
      clientId,
      sessionId,
      name,
      connection,
      avatar,
      accountId,
      authority,
      cardStyle,
      'none',
    );
  }

  join(
    roomId: string,
    clientId: string,
    sessionId: string,
    name: string,
    connection: PeerConnection,
    avatar?: string,
    accountId?: string,
    authority?: RoomAuthority,
    cardStyle: ParticipantCardStyle = 'avatar-glass',
    _cardDecoration: ParticipantCardDecoration = 'none',
  ) {
    void _cardDecoration;
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', 'Комната не найдена');
    if (room.activity.table?.view.bots?.some((bot) => bot.id === clientId))
      throw new RoomError('ROOM_FULL', 'Этот идентификатор зарезервирован тренировочным ботом');

    const existing = room.peers.get(clientId);
    const identity = room.identities.get(clientId);
    if (
      !existing &&
      identity &&
      !(identity.accountId && identity.accountId === accountId) &&
      (identity.sessionId !== sessionId || identity.accountId !== accountId)
    )
      throw new RoomError('ROOM_FULL', 'Этот идентификатор закреплён за другим участником');
    if (!existing && room.peers.size >= ROOM_MAX_PARTICIPANTS) {
      throw new RoomError('ROOM_FULL', 'В комнате уже восемь участников');
    }
    if (
      existing &&
      (existing.sessionId !== sessionId || existing.participant.accountId !== accountId)
    ) {
      throw new RoomError('ROOM_FULL', 'Этот идентификатор участника уже используется');
    }

    const authorityChanged = authority ? this.applyAuthority(room, authority) : false;
    const participant: Participant = existing?.participant ?? {
      id: clientId,
      accountId,
      name,
      avatar,
      cardStyle,
      cardDecoration: 'none',
      muted: false,
      isOwner: false,
      connectedAt: Date.now(),
    };
    if (existing) existing.connection.close(4001, 'Соединение заменено после переподключения');
    participant.name = name;
    participant.avatar = avatar;
    participant.accountId = accountId;
    participant.cardStyle = cardStyle;
    participant.cardDecoration = 'none';
    const peer: Peer = {
      participant,
      sessionId,
      connection,
      lastSeen: Date.now(),
      profileChanges: existing?.profileChanges ?? [],
      lastReactionAt: existing?.lastReactionAt ?? 0,
      lastActivityAt: existing?.lastActivityAt ?? 0,
      lastPointerAt: 0,
      lastActivityResyncAt: 0,
    };
    room.peers.set(clientId, peer);
    if (room.identities.size >= 64 && !room.identities.has(clientId)) {
      const removable = [...room.identities.keys()].find(
        (id) => !room.peers.has(id) && !room.activity.table?.view.seats.includes(id),
      );
      if (removable) room.identities.delete(removable);
    }
    room.identities.set(clientId, { sessionId, accountId });
    const ownerChanged = this.reconcileOwner(room);

    connection.send({
      type: 'joined-room',
      roomId,
      selfId: clientId,
      roomStartedAt: room.createdAt,
      participants: [...room.peers.values()].map((entry) => entry.participant),
      roomChatMessages: room.chatMessages,
      activity: roomActivityView(
        room.activity,
        clientId,
        connection.activityVersion === 2,
        connection.pokerSeats === 8,
        connection.tabletVersion === 3,
        connection.isAdult === true,
        connection.pokerFlow === 2,
      ),
    });
    if (!existing) this.broadcast(room, { type: 'participant-joined', participant }, clientId);
    if (authorityChanged || ownerChanged)
      this.broadcast(room, {
        type: 'participants',
        participants: [...room.peers.values()].map((entry) => entry.participant),
      });
    return participant;
  }

  leave(roomId: string, clientId: string, connection?: PeerConnection, reason = 'Участник вышел') {
    const room = this.rooms.get(roomId);
    const peer = room?.peers.get(clientId);
    if (!room || !peer || (connection && peer.connection !== connection)) return false;
    room.peers.delete(clientId);
    if (room.activity.view.viewers?.includes(clientId)) {
      room.activity.view = {
        ...room.activity.view,
        viewers: room.activity.view.viewers.filter((id) => id !== clientId),
      };
      this.sendActivity(room);
    }
    if (room.activity.table?.view.hostId === clientId && room.peers.size) {
      room.activity.table.view = {
        ...room.activity.table.view,
        hostId: [...room.peers.keys()][0]!,
      };
      room.activity.view = { ...room.activity.view, revision: room.activity.view.revision + 1 };
      this.sendActivity(room);
    }
    this.broadcast(room, { type: 'participant-left', participantId: clientId, reason });
    if (room.peers.size === 0) this.rooms.delete(roomId);
    else if (room.authority.scope === 'standalone' && room.ownerId === clientId) {
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

  setMuted(roomId: string, clientId: string, muted: boolean, deafened?: boolean) {
    const room = this.rooms.get(roomId);
    const peer = room?.peers.get(clientId);
    if (!room || !peer) return false;
    const state = mergeParticipantAudioState(peer.participant, { muted, deafened });
    Object.assign(peer.participant, state);
    this.broadcast(room, { type: 'mute-changed', participantId: clientId, ...state });
    return true;
  }

  refreshPokerAccess(roomId: string, clientId: string, isAdult: boolean) {
    const room = this.rooms.get(roomId),
      peer = room?.peers.get(clientId);
    if (!room || !peer) return;
    peer.connection.isAdult = isAdult;
    this.sendActivity(room);
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

  updateCardAppearance(
    roomId: string,
    clientId: string,
    cardStyle: ParticipantCardStyle,
    _cardDecoration: ParticipantCardDecoration,
  ) {
    void _cardDecoration;
    const room = this.rooms.get(roomId);
    const peer = room?.peers.get(clientId);
    if (!room || !peer) return false;
    peer.participant.cardStyle = cardStyle;
    peer.participant.cardDecoration = 'none';
    this.broadcast(room, { type: 'participant-updated', participant: peer.participant });
    return true;
  }

  updateActivity(roomId: string, clientId: string, revision: number, action: RoomActivityAction) {
    const room = this.rooms.get(roomId);
    const peer = room?.peers.get(clientId);
    if (!room || !peer) return;
    const v2 = peer.connection.activityVersion === 2;
    if (
      (action.kind === 'poker-break-vote' ||
        (action.kind === 'table-open' && action.pokerFlow === 2)) &&
      peer.connection.pokerFlow !== 2
    )
      return;
    const targetsPoker =
      (action.kind === 'table-open' || action.kind === 'game-propose') && action.game === 'poker';
    const controlsPoker =
      room.activity.table?.view.kind === 'poker' &&
      (action.kind.startsWith('poker-') ||
        (action.kind.startsWith('table-') && !action.kind.startsWith('tablet-')));
    if (peer.connection.isAdult !== true && (targetsPoker || controlsPoker)) {
      this.sendActivity(room);
      return;
    }
    if (
      ['table-bot', 'poker-config', 'game-propose', 'game-vote', 'game-access'].includes(
        action.kind,
      ) &&
      peer.connection.tabletVersion !== 3
    )
      return;
    if (action.kind === 'game-access') {
      this.sendActivity(room);
      return;
    }
    if (
      room.activity.table?.view.kind === 'poker' &&
      room.activity.table.view.pokerFlow === 2 &&
      peer.connection.pokerFlow !== 2 &&
      (action.kind.startsWith('poker-') ||
        (action.kind.startsWith('table-') && !action.kind.startsWith('tablet-')))
    )
      return;
    // Old clients cannot parse an eight-seat snapshot. Keep their call connected.
    if (action.kind === 'table-open' && action.pokerSeats === 8 && peer.connection.pokerSeats !== 8)
      return;
    if (
      room.activity.table?.view.kind === 'poker' &&
      room.activity.table.view.seats.length > 6 &&
      peer.connection.pokerSeats !== 8 &&
      (action.kind.startsWith('table-') || action.kind.startsWith('poker-'))
    )
      return;
    if (action.kind === 'tablet-join') {
      if (!v2 || !room.activity.view.open) return;
      const viewers = new Set(room.activity.view.viewers ?? []);
      if (action.joined) viewers.add(clientId);
      else viewers.delete(clientId);
      if (
        viewers.size === (room.activity.view.viewers ?? []).length &&
        viewers.has(clientId) === Boolean(room.activity.view.viewers?.includes(clientId))
      )
        return;
      room.activity.view = { ...room.activity.view, viewers: [...viewers] };
      this.sendActivity(room);
      return;
    }
    if (action.kind === 'tablet-pointer') {
      if (!v2 || !room.activity.view.open || !room.activity.view.viewers?.includes(clientId))
        return;
      const table = room.activity.table?.view;
      if (table && ['fleet', 'poker'].includes(table.kind)) return;
      if (
        !action.surface.startsWith((table?.id ?? 'catalog') + ':') ||
        !['tablet', 'catalog', 'chess', 'quiz', 'property'].includes(
          action.surface.split(':')[1] ?? '',
        )
      )
        return;
      const now = Date.now();
      if (action.visible && now - peer.lastPointerAt < 140) return;
      peer.lastPointerAt = now;
      for (const [id, other] of room.peers)
        if (
          id !== clientId &&
          other.connection.activityVersion === 2 &&
          room.activity.view.viewers?.includes(id)
        )
          other.connection.send({ type: 'activity-pointer', participantId: clientId, ...action });
      return;
    }
    if (room.activity.table && !v2) return;
    if (
      !peer.connection.canUseActivity &&
      (!room.activity.view.open || !['game', 'cell', 'move'].includes(action.kind))
    )
      return;
    // Delivery content is intentionally absent from the shared gaming tablet.
    if (action.kind === 'service' || action.kind === 'region') return;
    const now = Date.now();
    if (
      v2 &&
      revision !== room.activity.view.revision &&
      action.kind !== 'game-vote' &&
      action.kind !== 'poker-break-vote'
    ) {
      // A delayed action must refresh this player's private snapshot rather
      // than leave apparently live controls stuck on an obsolete betting turn.
      if (now - peer.lastActivityResyncAt >= 250) {
        peer.lastActivityResyncAt = now;
        peer.connection.send({
          type: 'activity-state',
          activity: roomActivityView(
            room.activity,
            clientId,
            true,
            peer.connection.pokerSeats === 8,
            peer.connection.tabletVersion === 3,
            peer.connection.isAdult === true,
            peer.connection.pokerFlow === 2,
          ),
        });
      }
      return;
    }
    if (!v2 && now - peer.lastActivityAt < 125) return;
    peer.lastActivityAt = now;
    const next = applyRoomActivity(
      room.activity,
      revision,
      action,
      v2
        ? {
            actorId: clientId,
            pokerFlow: peer.connection.pokerFlow,
            members: [...room.peers.keys()],
            now,
            voters: [...room.peers]
              .filter(
                ([, p]) =>
                  p.connection.tabletVersion === 3 &&
                  p.connection.canUseActivity &&
                  (!(
                    action.kind === 'game-propose' &&
                    action.game === 'poker' &&
                    peer.connection.pokerFlow === 2
                  ) ||
                    p.connection.pokerFlow === 2),
              )
              .map(([id]) => id),
            adultIds: [...room.peers]
              .filter(([, p]) => p.connection.isAdult === true)
              .map(([id]) => id),
          }
        : undefined,
    );
    if (next === room.activity) return;
    if (action.kind === 'open') {
      next.view = { ...next.view, startedBy: clientId, sessionId: crypto.randomUUID() };
    }
    room.activity = next;
    this.sendActivity(room);
  }
  private sendActivity(room: Room) {
    for (const [id, peer] of room.peers)
      peer.connection.send({
        type: 'activity-state',
        activity: roomActivityView(
          room.activity,
          id,
          peer.connection.activityVersion === 2,
          peer.connection.pokerSeats === 8,
          peer.connection.tabletVersion === 3,
          peer.connection.isAdult === true,
          peer.connection.pokerFlow === 2,
        ),
      });
  }
  tickActivities(now = Date.now()) {
    for (const room of this.rooms.values()) {
      const next = tickRoomActivity(room.activity, now, [...room.peers.keys()]);
      if (next !== room.activity) {
        room.activity = next;
        this.sendActivity(room);
      }
    }
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
    if (room.authority.scope !== 'direct' && room.ownerId !== clientId) return 'NOT_OWNER' as const;
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
    const endedRooms: string[] = [];
    for (const room of [...this.rooms.values()]) {
      for (const [clientId, peer] of [...room.peers]) {
        if (now - peer.lastSeen > maxAgeMs) {
          peer.connection.close(4000, 'Тайм-аут');
          this.leave(room.id, clientId, peer.connection, 'Соединение потеряно');
        }
      }
      if (!this.rooms.has(room.id)) endedRooms.push(room.id);
    }
    return endedRooms;
  }

  hasRoom(roomId: string) {
    return this.rooms.has(roomId);
  }
  activeRoomIds() {
    return [...this.rooms.values()].filter((room) => room.peers.size > 0).map((room) => room.id);
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

  private applyAuthority(room: Room, authority: RoomAuthority) {
    const previous = JSON.stringify(room.authority);
    if (authority.scope === 'group') room.authority = authority;
    else if (room.authority.scope !== 'group') room.authority = authority;
    return previous !== JSON.stringify(room.authority);
  }

  private reconcileOwner(room: Room) {
    const previousOwnerId = room.ownerId;
    if (room.authority.scope === 'direct') room.ownerId = undefined;
    else if (room.authority.scope === 'group') {
      const groupOwnerAccountId = room.authority.groupOwnerAccountId;
      room.ownerId = [...room.peers.values()].find(
        (peer) => peer.participant.accountId === groupOwnerAccountId,
      )?.participant.id;
    }
    for (const entry of room.peers.values())
      entry.participant.isOwner = entry.participant.id === room.ownerId;
    return previousOwnerId !== room.ownerId;
  }
}

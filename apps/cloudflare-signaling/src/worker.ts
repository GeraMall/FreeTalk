import {
  CLIENT_STALE_AFTER_MS,
  MAX_SIGNAL_BYTES,
  RATE_LIMIT_MESSAGES,
  RATE_LIMIT_WINDOW_MS,
  ROOM_MAX_PARTICIPANTS,
  ROOM_CODE_PATTERN,
} from '@freetalk/config';
import { parseClientMessage, type Participant, type ServerMessage } from '@freetalk/protocol';

interface Env {
  ROOMS: DurableObjectNamespace;
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
  TURN_CREDENTIAL_TTL_SECONDS?: string;
  ALLOWED_ORIGIN?: string;
}

interface SocketAttachment {
  joined: boolean;
  roomId: string;
  clientId?: string;
  sessionId?: string;
  name?: string;
  muted?: boolean;
  isOwner?: boolean;
  connectedAt?: number;
  lastSeen: number;
  timestamps: number[];
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health')
      return Response.json({ ok: true, service: 'freetalk-cloudflare-signaling' });
    if (url.pathname !== '/ws' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
      return new Response('Not found', { status: 404 });
    const origin = request.headers.get('Origin');
    if (env.ALLOWED_ORIGIN && env.ALLOWED_ORIGIN !== '*' && origin !== env.ALLOWED_ORIGIN)
      return new Response('Forbidden', { status: 403 });
    const roomId = url.searchParams.get('room')?.toUpperCase() ?? '';
    if (!ROOM_CODE_PATTERN.test(roomId)) return new Response('Invalid room', { status: 400 });
    return env.ROOMS.get(env.ROOMS.idFromName(roomId)).fetch(request);
  },
};

export class VoiceRoom implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
      return new Response('Expected websocket', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    server.serializeAttachment({
      joined: false,
      roomId: new URL(request.url).searchParams.get('room')?.toUpperCase() ?? '',
      lastSeen: Date.now(),
      timestamps: [],
    } satisfies SocketAttachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > MAX_SIGNAL_BYTES) {
      socket.close(1009, 'Message too large');
      return;
    }
    const attachment = socket.deserializeAttachment() as SocketAttachment;
    const now = Date.now();
    attachment.timestamps = attachment.timestamps.filter(
      (time) => now - time < RATE_LIMIT_WINDOW_MS,
    );
    if (attachment.timestamps.length >= RATE_LIMIT_MESSAGES) {
      this.send(socket, {
        type: 'error',
        code: 'RATE_LIMITED',
        message: 'Слишком много сообщений',
        fatal: true,
      });
      socket.close(1008, 'Rate limit');
      return;
    }
    attachment.timestamps.push(now);
    attachment.lastSeen = now;
    socket.serializeAttachment(attachment);
    try {
      const message = parseClientMessage(raw);
      if (message.type === 'create-room' || message.type === 'join-room') {
        await this.join(socket, message, attachment);
        return;
      }
      if (!attachment.joined || !attachment.clientId) {
        this.send(socket, {
          type: 'error',
          code: 'NOT_JOINED',
          message: 'Сначала войдите в комнату',
        });
        return;
      }
      if (message.type === 'leave-room') {
        socket.close(1000, 'Leave');
        return;
      }
      if (message.type === 'ping') {
        this.send(socket, { type: 'pong', timestamp: message.timestamp });
        return;
      }
      if (message.type === 'mute-changed') {
        attachment.muted = message.muted;
        socket.serializeAttachment(attachment);
        this.broadcast({
          type: 'mute-changed',
          participantId: attachment.clientId,
          muted: message.muted,
        });
        return;
      }
      if (message.type === 'moderation-mute') {
        if (!attachment.isOwner) {
          this.send(socket, {
            type: 'error',
            code: 'NOT_OWNER',
            message: 'Только создатель комнаты может выключать микрофоны участников',
          });
          return;
        }
        const target = this.find(message.targetParticipantId);
        if (!target || target === socket) {
          this.send(socket, {
            type: 'error',
            code: 'TARGET_NOT_FOUND',
            message: 'Участник уже отключился',
          });
          return;
        }
        const targetAttachment = target.deserializeAttachment() as SocketAttachment;
        targetAttachment.muted = true;
        target.serializeAttachment(targetAttachment);
        this.send(target, { type: 'force-mute', byParticipantId: attachment.clientId });
        this.broadcast({
          type: 'mute-changed',
          participantId: message.targetParticipantId,
          muted: true,
        });
        return;
      }
      const target = this.find(message.to);
      if (!target) {
        this.send(socket, {
          type: 'error',
          code: 'TARGET_NOT_FOUND',
          message: 'Участник уже отключился',
        });
        return;
      }
      const relayed =
        message.type === 'ice-candidate'
          ? ({
              type: 'ice-candidate',
              from: attachment.clientId,
              candidate: message.candidate,
            } as const)
          : ({
              type: message.type,
              from: attachment.clientId,
              description: message.description,
            } as const);
      this.send(target, relayed);
    } catch {
      this.send(socket, {
        type: 'error',
        code: 'INVALID_MESSAGE',
        message: 'Некорректное сообщение',
      });
    }
  }

  async webSocketClose(socket: WebSocket) {
    await this.leave(socket);
  }
  async webSocketError(socket: WebSocket) {
    await this.leave(socket);
  }

  async alarm() {
    const now = Date.now();
    for (const socket of this.active()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment;
      if (now - attachment.lastSeen > CLIENT_STALE_AFTER_MS)
        socket.close(4000, 'Heartbeat timeout');
    }
    if (this.active().length > 0) await this.state.storage.setAlarm(now + 60_000);
    else {
      const grace = await this.state.storage.get<{ expiresAt: number }>('grace');
      if (!grace || grace.expiresAt <= now) await this.state.storage.delete('grace');
      else await this.state.storage.setAlarm(grace.expiresAt);
    }
  }

  private async join(
    socket: WebSocket,
    message: Extract<ReturnType<typeof parseClientMessage>, { type: 'create-room' | 'join-room' }>,
    attachment: SocketAttachment,
  ) {
    if (message.roomId !== attachment.roomId) {
      this.send(socket, {
        type: 'error',
        code: 'INVALID_MESSAGE',
        message: 'Код комнаты не совпадает с WebSocket-маршрутом',
        fatal: true,
      });
      return;
    }
    const active = this.active();
    const grace = await this.state.storage.get<{ sessionId: string; expiresAt: number }>('grace');
    if (message.type === 'create-room' && active.length > 0) {
      this.send(socket, {
        type: 'error',
        code: 'ROOM_EXISTS',
        message: 'Комната уже существует',
        fatal: true,
      });
      return;
    }
    if (
      message.type === 'join-room' &&
      active.length === 0 &&
      (!grace || grace.expiresAt < Date.now() || grace.sessionId !== message.sessionId)
    ) {
      this.send(socket, {
        type: 'error',
        code: 'ROOM_NOT_FOUND',
        message: 'Комната не найдена',
        fatal: true,
      });
      return;
    }
    const same = active.find(
      (entry) => (entry.deserializeAttachment() as SocketAttachment).clientId === message.clientId,
    );
    const sameAttachment = same?.deserializeAttachment() as SocketAttachment | undefined;
    if (same && sameAttachment?.sessionId !== message.sessionId) {
      this.send(socket, {
        type: 'error',
        code: 'ROOM_FULL',
        message: 'Идентификатор уже используется',
        fatal: true,
      });
      return;
    }
    if (!same && active.length >= ROOM_MAX_PARTICIPANTS) {
      this.send(socket, {
        type: 'error',
        code: 'ROOM_FULL',
        message: 'В комнате уже шесть участников',
        fatal: true,
      });
      return;
    }
    if (same && sameAttachment) {
      // Cloudflare can keep a closing socket in getWebSockets() until its close
      // callback runs. Remove the replaced socket from the active set first so
      // it cannot be included in the new participant snapshot or emit a stale
      // participant-left event for the replacement.
      sameAttachment.joined = false;
      same.serializeAttachment(sameAttachment);
      same.close(4001, 'Reconnected');
    }
    Object.assign(attachment, {
      joined: true,
      clientId: message.clientId,
      sessionId: message.sessionId,
      name: message.name,
      muted: sameAttachment?.muted ?? false,
      isOwner:
        sameAttachment?.isOwner ??
        (message.type === 'create-room' && active.filter((entry) => entry !== same).length === 0),
      connectedAt: sameAttachment?.connectedAt ?? Date.now(),
    });
    socket.serializeAttachment(attachment);
    await this.state.storage.put('grace', {
      sessionId: message.sessionId,
      expiresAt: Date.now() + 30_000,
    });
    await this.state.storage.setAlarm(Date.now() + 60_000);
    const participant = this.participant(attachment);
    this.send(socket, {
      type: 'joined-room',
      roomId: message.roomId,
      selfId: message.clientId,
      participants: this.active().map((entry) =>
        this.participant(entry.deserializeAttachment() as SocketAttachment),
      ),
    });
    if (message.type === 'create-room')
      this.send(socket, { type: 'room-created', roomId: message.roomId });
    if (!same) this.broadcast({ type: 'participant-joined', participant }, message.clientId);
    this.send(socket, await this.iceConfig());
  }

  private async leave(socket: WebSocket) {
    const attachment = socket.deserializeAttachment() as SocketAttachment;
    if (!attachment.joined || !attachment.clientId) return;
    // webSocketError and webSocketClose may both run for one connection.
    // Mark it inactive before broadcasting so leave remains idempotent.
    attachment.joined = false;
    socket.serializeAttachment(attachment);
    this.broadcast(
      {
        type: 'participant-left',
        participantId: attachment.clientId,
        reason: 'Соединение потеряно',
      },
      attachment.clientId,
    );
    const remaining = this.active().filter((entry) => entry !== socket);
    if (attachment.isOwner && remaining.length > 0) {
      const nextOwner = remaining
        .map((entry) => ({
          socket: entry,
          attachment: entry.deserializeAttachment() as SocketAttachment,
        }))
        .sort((a, b) => (a.attachment.connectedAt ?? 0) - (b.attachment.connectedAt ?? 0))[0]!;
      nextOwner.attachment.isOwner = true;
      nextOwner.socket.serializeAttachment(nextOwner.attachment);
      this.broadcast({ type: 'owner-changed', ownerId: nextOwner.attachment.clientId! });
    }
    if (remaining.length === 0 && attachment.sessionId) {
      await this.state.storage.put('grace', {
        sessionId: attachment.sessionId,
        expiresAt: Date.now() + 30_000,
      });
      await this.state.storage.setAlarm(Date.now() + 30_000);
    }
  }

  private active() {
    return this.state
      .getWebSockets()
      .filter((socket) => (socket.deserializeAttachment() as SocketAttachment | null)?.joined);
  }
  private find(clientId: string) {
    return this.active().find(
      (socket) => (socket.deserializeAttachment() as SocketAttachment).clientId === clientId,
    );
  }
  private participant(value: SocketAttachment): Participant {
    return {
      id: value.clientId!,
      name: value.name!,
      muted: value.muted ?? false,
      isOwner: value.isOwner ?? false,
      connectedAt: value.connectedAt!,
    };
  }
  private broadcast(message: ServerMessage, except?: string) {
    for (const socket of this.active()) {
      const id = (socket.deserializeAttachment() as SocketAttachment).clientId;
      if (id !== except) this.send(socket, message);
    }
  }
  private send(socket: WebSocket, message: ServerMessage) {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      /* closing socket */
    }
  }

  private async iceConfig(): Promise<Extract<ServerMessage, { type: 'ice-config' }>> {
    const fallback: RTCIceServer[] = [
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.l.google.com:19302' },
    ];
    if (!this.env.TURN_KEY_ID || !this.env.TURN_KEY_API_TOKEN) {
      console.warn('TURN credentials unavailable: Worker secrets are missing');
      return { type: 'ice-config', iceServers: fallback };
    }
    const ttl = Number(this.env.TURN_CREDENTIAL_TTL_SECONDS ?? 86_400);
    try {
      const response = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(this.env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.env.TURN_KEY_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ttl }),
        },
      );
      if (!response.ok) {
        console.warn(`TURN credential request failed with HTTP ${response.status}`);
        throw new Error('TURN error');
      }
      const result = await response.json<{ iceServers: RTCIceServer[] }>();
      return {
        type: 'ice-config',
        iceServers: [...fallback, ...result.iceServers],
        expiresAt: Date.now() + ttl * 1000,
      };
    } catch {
      console.warn('TURN credentials unavailable: using STUN fallback');
      return { type: 'ice-config', iceServers: fallback };
    }
  }
}

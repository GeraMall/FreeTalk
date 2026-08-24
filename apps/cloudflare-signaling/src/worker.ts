import {
  CLIENT_STALE_AFTER_MS,
  MAX_SIGNAL_BYTES,
  RATE_LIMIT_MESSAGES,
  RATE_LIMIT_WINDOW_MS,
  ROOM_MAX_PARTICIPANTS,
  ROOM_CODE_PATTERN,
  parseDnsIpv4Answers,
  withCloudflareTurnIpFallbacks,
} from '@freetalk/config';
import { parseClientMessage, type Participant, type ServerMessage } from '@freetalk/protocol';

interface Env {
  ROOMS: DurableObjectNamespace;
  BUILD_COMMIT?: string;
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
  TURN_CREDENTIAL_TTL_SECONDS?: string;
  TURN_BROKER_TOKEN?: string;
  ALLOWED_ORIGIN?: string;
}

const fallbackIceServers: RTCIceServer[] = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
];

async function turnIpv4Addresses() {
  try {
    const response = await fetch(
      'https://cloudflare-dns.com/dns-query?name=turn.cloudflare.com&type=A',
      {
        headers: { Accept: 'application/dns-json' },
      },
    );
    if (!response.ok) return [];
    return parseDnsIpv4Answers(await response.json<unknown>());
  } catch {
    return [];
  }
}

export async function generateIceConfig(
  env: Pick<Env, 'TURN_KEY_ID' | 'TURN_KEY_API_TOKEN' | 'TURN_CREDENTIAL_TTL_SECONDS'>,
): Promise<Extract<ServerMessage, { type: 'ice-config' }>> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN)
    return { type: 'ice-config', iceServers: fallbackIceServers };
  const ttl = Number(env.TURN_CREDENTIAL_TTL_SECONDS ?? 86_400);
  try {
    const [response, turnAddresses] = await Promise.all([
      fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ttl }),
        },
      ),
      turnIpv4Addresses(),
    ]);
    if (!response.ok) throw new Error(`TURN provider returned ${response.status}`);
    const result = await response.json<{ iceServers: RTCIceServer[] }>();
    return {
      type: 'ice-config',
      iceServers: [
        ...fallbackIceServers,
        ...withCloudflareTurnIpFallbacks(result.iceServers, turnAddresses),
      ],
      expiresAt: Date.now() + ttl * 1000,
    };
  } catch {
    return { type: 'ice-config', iceServers: fallbackIceServers };
  }
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
  clientConnectionId: string;
  serverConnectionId: string;
  edgeColo: string;
  clientAsn: number | null;
  serverCloseCode?: number;
  serverCloseReason?: string;
  serverCloseCause?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health')
      return Response.json({ ok: true, service: 'freetalk-cloudflare-signaling' });
    if (url.pathname === '/turn-credentials') {
      if (
        request.method !== 'POST' ||
        !env.TURN_BROKER_TOKEN ||
        request.headers.get('Authorization') !== `Bearer ${env.TURN_BROKER_TOKEN}`
      )
        return new Response('Forbidden', { status: 403 });
      return Response.json(await generateIceConfig(env), {
        headers: { 'Cache-Control': 'no-store' },
      });
    }
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
    const url = new URL(request.url);
    const requestedConnectionId = url.searchParams.get('cid') ?? '';
    const clientConnectionId = /^[0-9a-f-]{36}$/i.test(requestedConnectionId)
      ? requestedConnectionId
      : 'missing-or-invalid';
    const serverConnectionId = crypto.randomUUID();
    const edgeColo = typeof request.cf?.colo === 'string' ? request.cf.colo : 'unknown';
    const clientAsn = typeof request.cf?.asn === 'number' ? request.cf.asn : null;
    this.state.acceptWebSocket(server);
    server.serializeAttachment({
      joined: false,
      roomId: url.searchParams.get('room')?.toUpperCase() ?? '',
      lastSeen: Date.now(),
      timestamps: [],
      clientConnectionId,
      serverConnectionId,
      edgeColo,
      clientAsn,
    } satisfies SocketAttachment);
    this.trace('socket.accepted', server);
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: {
        'x-freetalk-server-connection-id': serverConnectionId,
        'x-freetalk-edge-colo': edgeColo,
      },
    });
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > MAX_SIGNAL_BYTES) {
      this.closeSocket(socket, 1009, 'Message too large', 'invalid-payload');
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
      this.closeSocket(socket, 1008, 'Rate limit', 'rate-limit');
      return;
    }
    attachment.timestamps.push(now);
    attachment.lastSeen = now;
    socket.serializeAttachment(attachment);
    try {
      const message = parseClientMessage(raw);
      this.trace('message.received', socket, {
        messageType: message.type,
        ...(message.type === 'ping' ? { pingTimestamp: message.timestamp } : {}),
        ...('to' in message ? { targetPeerId: message.to } : {}),
      });
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
        this.closeSocket(socket, 1000, 'Leave', 'client-request');
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
      const targetAttachment = target.deserializeAttachment() as SocketAttachment;
      this.trace('signal.forwarded', socket, {
        messageType: message.type,
        targetPeerId: message.to,
        targetClientConnectionId: targetAttachment.clientConnectionId,
        targetServerConnectionId: targetAttachment.serverConnectionId,
      });
    } catch {
      this.send(socket, {
        type: 'error',
        code: 'INVALID_MESSAGE',
        message: 'Некорректное сообщение',
      });
    }
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string, wasClean: boolean) {
    const attachment = socket.deserializeAttachment() as SocketAttachment;
    this.trace('socket.close-callback', socket, {
      code,
      reason,
      wasClean,
      initiatedBy: attachment.serverCloseCause ? 'server' : 'client-or-transport',
      serverCloseCause: attachment.serverCloseCause ?? null,
    });
    await this.leave(socket);
  }
  async webSocketError(socket: WebSocket, error: unknown) {
    this.trace('socket.error', socket, {
      error: error instanceof Error ? error.message : String(error),
    });
    await this.leave(socket);
  }

  async alarm() {
    const now = Date.now();
    for (const socket of this.active()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment;
      if (now - attachment.lastSeen > CLIENT_STALE_AFTER_MS)
        this.closeSocket(socket, 4000, 'Heartbeat timeout', 'stale-alarm');
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
    const iceConfig = await this.iceConfig();
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
      this.closeSocket(same, 4001, 'Reconnected', 'connection-replaced');
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
    this.trace('participant.joined', socket, { peerId: message.clientId });
    await this.state.storage.put('grace', {
      sessionId: message.sessionId,
      expiresAt: Date.now() + 30_000,
    });
    await this.state.storage.setAlarm(Date.now() + 60_000);
    const participant = this.participant(attachment);
    this.send(socket, iceConfig);
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
    // Older clients only apply TURN after creating their PeerManager. Send the
    // same configuration again during the 0.3.5 -> 0.3.6 transition.
    this.send(socket, iceConfig);
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
      this.trace('message.sent', socket, {
        messageType: message.type,
        ...(message.type === 'pong' ? { pingTimestamp: message.timestamp } : {}),
      });
    } catch (error) {
      this.trace('message.send-error', socket, {
        messageType: message.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private closeSocket(socket: WebSocket, code: number, reason: string, cause: string) {
    const attachment = socket.deserializeAttachment() as SocketAttachment;
    attachment.serverCloseCode = code;
    attachment.serverCloseReason = reason;
    attachment.serverCloseCause = cause;
    socket.serializeAttachment(attachment);
    this.trace('socket.close-initiated', socket, { code, reason, cause });
    socket.close(code, reason);
  }

  private trace(
    event: string,
    socket: WebSocket,
    details: Record<string, string | number | boolean | null> = {},
  ) {
    const attachment = socket.deserializeAttachment() as SocketAttachment;
    console.log(
      JSON.stringify({
        source: 'freetalk-signaling',
        serverBuildCommit: this.env.BUILD_COMMIT ?? 'unknown',
        timestamp: new Date().toISOString(),
        event,
        roomId: attachment.roomId,
        peerId: attachment.clientId ?? null,
        clientConnectionId: attachment.clientConnectionId,
        serverConnectionId: attachment.serverConnectionId,
        edgeColo: attachment.edgeColo,
        clientAsn: attachment.clientAsn,
        ...details,
      }),
    );
  }

  private async iceConfig(): Promise<Extract<ServerMessage, { type: 'ice-config' }>> {
    return generateIceConfig(this.env);
  }
}

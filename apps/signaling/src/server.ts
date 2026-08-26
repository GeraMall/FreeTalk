import { createServer, type IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  CLIENT_STALE_AFTER_MS,
  MAX_SIGNAL_BYTES,
  RATE_LIMIT_MESSAGES,
  RATE_LIMIT_WINDOW_MS,
} from '@freetalk/config';
import { parseClientMessage, type ServerMessage } from '@freetalk/protocol';
import { WebSocketServer, type WebSocket } from 'ws';
import { RoomError, RoomManager, type PeerConnection } from './room-manager.js';
import { getIceConfig } from './turn.js';
import {
  assertAuthorizationConfigured,
  authorizeRoom,
  getRegisteredProfile,
  recordCallEvent,
  type RoomAuthorization,
} from './authorization.js';

assertAuthorizationConfigured();

const port = Number(process.env.PORT ?? 8787);
const allowedOrigin = process.env.ALLOWED_ORIGIN ?? '*';
const manager = new RoomManager();
const metadata = new WeakMap<
  WebSocket,
  {
    roomId?: string;
    clientId?: string;
    timestamps: number[];
    clientConnectionId: string;
    serverConnectionId: string;
    guestExpiryTimer?: NodeJS.Timeout;
    authorization?: Extract<RoomAuthorization, { allowed: true }>;
    displayName?: string;
  }
>();
const upgradeMetadata = new WeakMap<
  IncomingMessage,
  { clientConnectionId: string; serverConnectionId: string }
>();

const httpServer = createServer(async (request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, service: 'freetalk-signaling' }));
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'not found' }));
});

const sockets = new WebSocketServer({
  noServer: true,
  maxPayload: MAX_SIGNAL_BYTES,
  perMessageDeflate: false,
});

httpServer.on('upgrade', (request, socket, head) => {
  const origin = request.headers.origin;
  if (request.url?.split('?')[0] !== '/ws' || (allowedOrigin !== '*' && origin !== allowedOrigin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  const url = new URL(request.url, 'http://127.0.0.1');
  const requestedConnectionId = url.searchParams.get('cid') ?? '';
  const connectionInfo = {
    clientConnectionId: /^[0-9a-f-]{36}$/i.test(requestedConnectionId)
      ? requestedConnectionId
      : 'missing-or-invalid',
    serverConnectionId: randomUUID(),
  };
  upgradeMetadata.set(request, connectionInfo);
  sockets.handleUpgrade(request, socket, head, (webSocket) =>
    sockets.emit('connection', webSocket, request),
  );
});

sockets.on('headers', (headers, request) => {
  const info = upgradeMetadata.get(request);
  if (!info) return;
  headers.push(`x-freetalk-server-connection-id: ${info.serverConnectionId}`);
  headers.push('x-freetalk-edge-colo: VPS-SPB');
});

sockets.on('connection', (socket, request) => {
  const connectionInfo = upgradeMetadata.get(request) ?? {
    clientConnectionId: 'missing-or-invalid',
    serverConnectionId: randomUUID(),
  };
  metadata.set(socket, { timestamps: [], ...connectionInfo });
  console.info(
    JSON.stringify({
      event: 'socket.accepted',
      timestamp: new Date().toISOString(),
      ...connectionInfo,
    }),
  );
  const connection: PeerConnection = {
    send: (message) => send(socket, message),
    close: (code, reason) => socket.close(code, reason),
  };

  socket.on('message', async (data, isBinary) => {
    const meta = metadata.get(socket)!;
    const now = Date.now();
    meta.timestamps = meta.timestamps.filter((time) => now - time < RATE_LIMIT_WINDOW_MS);
    if (isBinary || Buffer.byteLength(data.toString(), 'utf8') > MAX_SIGNAL_BYTES)
      return socket.close(1009, 'Сообщение слишком велико');
    if (meta.timestamps.length >= RATE_LIMIT_MESSAGES)
      return send(socket, {
        type: 'error',
        code: 'RATE_LIMITED',
        message: 'Слишком много сообщений',
        fatal: true,
      });
    meta.timestamps.push(now);

    try {
      const message = parseClientMessage(data.toString());
      logSocketEvent(socket, 'message.received', { messageType: message.type });
      if (message.type === 'create-room' || message.type === 'join-room') {
        if (meta.roomId)
          return send(socket, {
            type: 'error',
            code: 'INVALID_MESSAGE',
            message: 'Вы уже находитесь в комнате',
          });
        const authorization = await authorizeRoom(
          message.type === 'create-room' ? 'create' : 'join',
          message.roomId,
          message.authToken,
        );
        if (!authorization.allowed)
          return send(socket, {
            type: 'error',
            code:
              authorization.reason === 'REGISTERED_ONLY'
                ? 'REGISTERED_ONLY'
                : authorization.reason === 'GUEST_DAILY_LIMIT'
                  ? 'GUEST_DAILY_LIMIT'
                  : authorization.reason === 'RATE_LIMITED'
                    ? 'RATE_LIMITED'
                    : authorization.reason === 'AUTH_UNAVAILABLE'
                      ? 'INTERNAL_ERROR'
                      : 'AUTH_REQUIRED',
            message:
              authorization.reason === 'REGISTERED_ONLY'
                ? 'Создавать комнаты могут только зарегистрированные пользователи'
                : authorization.reason === 'GUEST_DAILY_LIMIT'
                  ? 'Лимит гостя: 5 подключений в сутки'
                  : authorization.reason === 'RATE_LIMITED'
                    ? 'Слишком много входов. Попробуйте позже'
                    : authorization.reason === 'AUTH_UNAVAILABLE'
                      ? 'Сервер авторизации временно недоступен'
                      : 'Требуется авторизация',
            fatal: true,
          });
        const authorizedName = authorization.displayName ?? message.name;
        const authorizedAvatar =
          authorization.kind === 'registered'
            ? authorization.avatar
            : authorization.kind === 'development'
              ? message.avatar
              : undefined;
        let iceConfig: Extract<ServerMessage, { type: 'ice-config' }>;
        try {
          iceConfig = await getIceConfig();
        } catch {
          iceConfig = {
            type: 'ice-config',
            iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
          };
        }
        send(socket, iceConfig);
        if (message.type === 'create-room')
          manager.create(
            message.roomId,
            message.clientId,
            message.sessionId,
            authorizedName,
            connection,
            authorizedAvatar,
          );
        else
          manager.join(
            message.roomId,
            message.clientId,
            message.sessionId,
            authorizedName,
            connection,
            authorizedAvatar,
          );
        meta.roomId = message.roomId;
        meta.clientId = message.clientId;
        meta.authorization = authorization;
        meta.displayName = authorizedName;
        void recordCallEvent({
          event: message.type === 'create-room' ? 'start' : 'join',
          roomId: message.roomId,
          displayName: authorizedName,
          userId: 'userId' in authorization ? authorization.userId : undefined,
          anonymousUserId:
            'anonymousUserId' in authorization ? authorization.anonymousUserId : undefined,
        }).catch((error) => logSocketEvent(socket, 'call-event.error', { error: String(error) }));
        if (authorization.kind === 'guest' && authorization.disconnectAt) {
          const delay = Math.max(0, new Date(authorization.disconnectAt).getTime() - Date.now());
          meta.guestExpiryTimer = setTimeout(() => {
            send(socket, {
              type: 'error',
              code: 'GUEST_SESSION_EXPIRED',
              message:
                'Гостевая сессия завершена. Зарегистрируйтесь, чтобы общаться без ограничений.',
              fatal: true,
            });
            socket.close(4003, 'Guest session expired');
          }, delay);
          meta.guestExpiryTimer.unref();
        }
        if (message.type === 'create-room')
          send(socket, { type: 'room-created', roomId: message.roomId });
        send(socket, iceConfig);
        return;
      }
      // Heartbeats can arrive while authorization/ICE configuration is still pending.
      // Answer them without pretending the user attempted a room action.
      if (message.type === 'ping') {
        send(socket, { type: 'pong', timestamp: message.timestamp });
        return;
      }
      if (!meta.roomId || !meta.clientId)
        return send(socket, {
          type: 'error',
          code: 'NOT_JOINED',
          message: 'Сначала войдите в комнату',
        });
      manager.touch(meta.roomId, meta.clientId);
      switch (message.type) {
        case 'leave-room':
          leaveRoom(meta, connection);
          socket.close(1000, 'Выход');
          break;
        case 'mute-changed':
          manager.setMuted(meta.roomId, meta.clientId, message.muted);
          break;
        case 'update-profile': {
          if (meta.authorization?.kind === 'guest') {
            send(socket, {
              type: 'error',
              code: 'REGISTERED_ONLY',
              message: 'Профиль доступен после регистрации',
            });
            break;
          }
          const registeredProfile =
            meta.authorization && 'userId' in meta.authorization && meta.authorization.userId
              ? await getRegisteredProfile(meta.authorization.userId)
              : null;
          const result = manager.updateProfile(
            meta.roomId,
            meta.clientId,
            registeredProfile?.displayName ?? message.name,
            registeredProfile?.avatar ??
              (meta.authorization?.kind === 'development' ? message.avatar : undefined),
          );
          if (result === 'RATE_LIMITED')
            send(socket, {
              type: 'error',
              code: 'PROFILE_RATE_LIMITED',
              message: 'Профиль можно изменить не более трёх раз за пять часов',
            });
          break;
        }
        case 'reaction':
          manager.react(meta.roomId, meta.clientId, message.id, message.reaction);
          break;
        case 'moderation-mute': {
          const result = manager.moderationMute(
            meta.roomId,
            meta.clientId,
            message.targetParticipantId,
          );
          if (result !== 'OK')
            send(socket, {
              type: 'error',
              code: result,
              message:
                result === 'NOT_OWNER'
                  ? 'Только создатель комнаты может выключать микрофоны участников'
                  : 'Участник уже отключился',
            });
          break;
        }
        case 'offer':
        case 'answer':
        case 'ice-candidate': {
          const payload =
            message.type === 'ice-candidate'
              ? ({ type: message.type, from: meta.clientId, candidate: message.candidate } as const)
              : ({
                  type: message.type,
                  from: meta.clientId,
                  description: message.description,
                } as const);
          if (!manager.relay(meta.roomId, meta.clientId, message.to, payload))
            send(socket, {
              type: 'error',
              code: 'TARGET_NOT_FOUND',
              message: 'Участник уже отключился',
            });
          break;
        }
      }
    } catch (error) {
      if (error instanceof RoomError)
        send(socket, { type: 'error', code: error.code, message: error.message, fatal: true });
      else
        send(socket, { type: 'error', code: 'INVALID_MESSAGE', message: 'Некорректное сообщение' });
    }
  });

  socket.on('close', (code, reason) => {
    const meta = metadata.get(socket);
    if (meta?.guestExpiryTimer) clearTimeout(meta.guestExpiryTimer);
    console.info(
      JSON.stringify({
        event: 'socket.closed',
        timestamp: new Date().toISOString(),
        clientConnectionId: meta?.clientConnectionId ?? null,
        serverConnectionId: meta?.serverConnectionId ?? null,
        code,
        reason: reason.toString(),
      }),
    );
    if (meta?.roomId && meta.clientId) {
      // A short grace period lets the same authenticated in-memory session replace
      // this connection. RoomManager ignores this delayed leave after replacement.
      setTimeout(() => leaveRoom(meta, connection, 'Соединение потеряно'), 12_000).unref();
    }
  });

  socket.on('error', (error) => {
    logSocketEvent(socket, 'socket.error', { error: error.message });
  });
});

function leaveRoom(
  meta: NonNullable<ReturnType<typeof metadata.get>>,
  connection: PeerConnection,
  reason?: string,
) {
  if (!meta.roomId || !meta.clientId) return;
  if (!manager.leave(meta.roomId, meta.clientId, connection, reason)) return;
  void recordCallEvent({
    event: 'leave',
    roomId: meta.roomId,
    displayName: meta.displayName,
    userId:
      meta.authorization && 'userId' in meta.authorization ? meta.authorization.userId : undefined,
    anonymousUserId:
      meta.authorization && 'anonymousUserId' in meta.authorization
        ? meta.authorization.anonymousUserId
        : undefined,
  }).catch((error) => logSocketEventForMeta(meta, 'call-event.error', { error: String(error) }));
  if (manager.roomSize(meta.roomId) === 0)
    void recordCallEvent({ event: 'end', roomId: meta.roomId }).catch((error) =>
      logSocketEventForMeta(meta, 'call-event.error', { error: String(error) }),
    );
}

function logSocketEventForMeta(
  meta: NonNullable<ReturnType<typeof metadata.get>>,
  event: string,
  details: Record<string, unknown>,
) {
  console.info(
    JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      clientConnectionId: meta.clientConnectionId,
      serverConnectionId: meta.serverConnectionId,
      ...details,
    }),
  );
}

function send(socket: WebSocket, message: ServerMessage) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
    logSocketEvent(socket, 'message.sent', { messageType: message.type });
  }
}

function logSocketEvent(socket: WebSocket, event: string, details: Record<string, unknown>) {
  const meta = metadata.get(socket);
  console.info(
    JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      clientConnectionId: meta?.clientConnectionId ?? null,
      serverConnectionId: meta?.serverConnectionId ?? null,
      ...details,
    }),
  );
}

setInterval(() => manager.removeStale(CLIENT_STALE_AFTER_MS), 15_000).unref();
httpServer.listen(port, '127.0.0.1', () =>
  console.info(`FreeTalk signaling: ws://127.0.0.1:${port}/ws`),
);

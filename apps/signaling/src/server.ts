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
            message.name,
            connection,
          );
        else
          manager.join(
            message.roomId,
            message.clientId,
            message.sessionId,
            message.name,
            connection,
          );
        meta.roomId = message.roomId;
        meta.clientId = message.clientId;
        if (message.type === 'create-room')
          send(socket, { type: 'room-created', roomId: message.roomId });
        send(socket, iceConfig);
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
          manager.leave(meta.roomId, meta.clientId, connection);
          socket.close(1000, 'Выход');
          break;
        case 'mute-changed':
          manager.setMuted(meta.roomId, meta.clientId, message.muted);
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
        case 'ping':
          send(socket, { type: 'pong', timestamp: message.timestamp });
          break;
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
      setTimeout(
        () => manager.leave(meta.roomId!, meta.clientId!, connection, 'Соединение потеряно'),
        12_000,
      ).unref();
    }
  });

  socket.on('error', (error) => {
    logSocketEvent(socket, 'socket.error', { error: error.message });
  });
});

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

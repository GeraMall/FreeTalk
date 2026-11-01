import { createServer, request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { timingSafeEqual } from 'node:crypto';
import { ROOM_CODE_PATTERN } from '@freetalk/config';
import { clusterPool, routeRoom } from './cluster-store.js';

const database = process.env.SIGNALING_CLUSTER_DATABASE_URL;
const secret = process.env.INTERNAL_SIGNALING_SECRET;
if (!database || !secret || secret.length < 32)
  throw new Error('Cluster database and internal secret are required');
const pool = clusterPool(database);
const internalAuthorized = (request: IncomingMessage) => {
  const value = request.headers['x-freetalk-internal-secret'];
  return (
    typeof value === 'string' &&
    Buffer.byteLength(value) === Buffer.byteLength(secret) &&
    timingSafeEqual(Buffer.from(value), Buffer.from(secret))
  );
};
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/internal/active-rooms') {
      if (!internalAuthorized(request)) {
        response.writeHead(401);
        response.end();
        return;
      }
      const rooms = await pool.query<{ id: string }>(
        `SELECT id FROM signaling_rooms WHERE snapshot IS NOT NULL AND recover_until>clock_timestamp()`,
      );
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ roomIds: rooms.rows.map((row) => row.id) }));
    } else if (request.url === '/health' || request.url === '/ready') {
      const nodes = await pool.query(
        `SELECT 1 FROM signaling_nodes WHERE seen_at>clock_timestamp()-interval '15 seconds' LIMIT 1`,
      );
      response.writeHead(nodes.rowCount ? 200 : 503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: Boolean(nodes.rowCount), service: 'trlka-room-gateway' }));
    } else {
      response.writeHead(404);
      response.end();
    }
  } catch {
    response.writeHead(503, { 'retry-after': '2' });
    response.end();
  }
});
server.on('upgrade', async (request, socket, head) => {
  socket.on('error', () => socket.destroy());
  try {
    const url = new URL(request.url ?? '', 'http://localhost');
    const roomId = url.searchParams.get('room') ?? '';
    if (url.pathname !== '/ws' || !ROOM_CODE_PATTERN.test(roomId)) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    const target = new URL(await routeRoom(pool, roomId));
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password)
      throw new Error('Invalid node URL');
    const headers: IncomingMessage['headers'] = { ...request.headers, host: target.host };
    // Cluster authentication is never accepted from a public WebSocket client.
    delete headers['x-freetalk-internal-secret'];
    const upstream = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, {
      method: 'GET',
      path: request.url,
      headers,
      timeout: 5_000,
    });
    let upgraded = false;
    upstream.on('upgrade', (response, remote, remoteHead) => {
      upgraded = true;
      remote.setTimeout(0);
      remote.on('error', () => socket.destroy());
      socket.on('close', () => remote.destroy());
      remote.on('close', () => socket.destroy());
      socket.write(
        `HTTP/1.1 ${response.statusCode ?? 101} Switching Protocols\r\n` +
          response.rawHeaders.reduce(
            (text, value, index, all) =>
              index % 2 === 0 ? text + `${value}: ${all[index + 1]}\r\n` : text,
            '',
          ) +
          '\r\n',
      );
      if (head.length) remote.write(head);
      if (remoteHead.length) socket.write(remoteHead);
      socket.pipe(remote).pipe(socket);
    });
    upstream.on('response', () => {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nRetry-After: 2\r\n\r\n');
      upstream.destroy();
    });
    upstream.on('timeout', () => {
      if (!upgraded) upstream.destroy();
    });
    upstream.on('error', () => socket.destroy());
    socket.on('close', () => {
      if (!upgraded) upstream.destroy();
    });
    upstream.end();
  } catch {
    socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nRetry-After: 2\r\n\r\n');
  }
});
server.listen(Number(process.env.GATEWAY_PORT ?? 8786), process.env.GATEWAY_HOST ?? '127.0.0.1');

async function shutdown() {
  server.close();
  await pool.end();
  setTimeout(() => process.exit(0), 2_000).unref();
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

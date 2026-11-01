import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';
import { ApiLeadership } from '../../api/src/api-leadership.js';
import { readFile } from 'node:fs/promises';
import { CLUSTER_SCHEMA, ClusterStore, routeRoom, type NodeConfig } from '../src/cluster-store.js';
import { RoomManager } from '../src/room-manager.js';

const url = process.env.CLUSTER_TEST_DATABASE_URL;
describe.skipIf(!url)('PostgreSQL cluster fencing and routing', () => {
  let pool: pg.Pool;
  const node = (id: string): NodeConfig => ({
    id,
    instanceId: randomUUID(),
    url: `http://${id}:8787/`,
    capacity: 10,
    leaseMs: 5_000,
    recoveryMs: 120_000,
  });
  let a: ClusterStore, b: ClusterStore;
  const room = 'BCDEFGHJ2345';
  beforeAll(async () => {
    if (!url || new URL(url).pathname !== '/trlka_cluster_test')
      throw new Error('Tests require an isolated trlka_cluster_test database');
    pool = new pg.Pool({ connectionString: url });
    await pool.query(CLUSTER_SCHEMA);
    await pool.query('TRUNCATE signaling_rooms,signaling_nodes');
    a = new ClusterStore(pool, node('node-a'));
    b = new ClusterStore(pool, node('node-b'));
    await a.register();
    await b.register();
  });
  afterAll(async () => {
    await pool?.end();
  });
  it('allows one owner, preserves state on takeover and rejects the old writer', async () => {
    const state = new RoomManager();
    state.create(room, randomUUID(), 'session-123456789', 'Owner', {
      send: () => {},
      close: () => {},
    });
    const lease = await a.acquire(room, true);
    await a.save(room, lease.epoch, state.snapshot(room));
    expect(await routeRoom(pool, room)).toBe(a.node.url);
    await expect(b.acquire(room, false)).rejects.toThrow('another live node');
    await pool.query(
      `UPDATE signaling_rooms SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`,
      [room],
    );
    await pool.query(
      `UPDATE signaling_nodes SET seen_at=clock_timestamp()-interval '1 minute' WHERE id=$1`,
      [a.node.id],
    );
    expect(await routeRoom(pool, room)).toBe(b.node.url);
    const takeover = await b.acquire(room, false);
    expect(takeover.snapshot?.createdAt).toBe(state.snapshot(room)?.createdAt);
    expect(BigInt(takeover.epoch)).toBeGreaterThan(BigInt(lease.epoch));
    await expect(a.save(room, lease.epoch, state.snapshot(room))).rejects.toThrow('fenced');
    await b.save(room, takeover.epoch, takeover.snapshot);
  });
  it('keeps existing rooms on a draining node and excludes it from new assignments', async () => {
    await pool.query('UPDATE signaling_nodes SET draining=true WHERE id=$1', [b.node.id]);
    expect(await routeRoom(pool, room)).toBe(b.node.url);
    await a.heartbeat();
    expect(await routeRoom(pool, 'BCDEFGHJ2346')).toBe(a.node.url);
    await expect(
      new ClusterStore(pool, { ...a.node, instanceId: randomUUID() }).register(),
    ).rejects.toThrow('already used');
  });
  it('does not resurrect an expired room and rejects renewal after lease expiry', async () => {
    await pool.query(
      `UPDATE signaling_rooms SET recover_until=clock_timestamp()-interval '1 second',lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`,
      [room],
    );
    await expect(a.acquire(room, false)).rejects.toThrow('unavailable');
  });

  it('elects one account API and promotes standby after primary lease expiration', async () => {
    await pool.query(
      await readFile(
        new URL('../../api/migrations/020_api_leadership.sql', import.meta.url),
        'utf8',
      ),
    );
    await pool.query('TRUNCATE service_leases');
    const primary = new ApiLeadership(pool, () => {}),
      standby = new ApiLeadership(pool, () => {});
    try {
      await primary.start();
      await standby.start();
      expect(primary.isActive()).toBe(true);
      expect(standby.isActive()).toBe(false);
      primary.stop();
      await pool.query(
        "UPDATE service_leases SET lease_until=clock_timestamp()-interval '1 second'",
      );
      await new Promise((resolve) => setTimeout(resolve, 3_300));
      expect(standby.isActive()).toBe(true);
    } finally {
      primary.stop();
      standby.stop();
    }
  });

  it('recovers a real WebSocket room through a gateway after killing its owner process', async () => {
    await pool.query('TRUNCATE signaling_rooms,signaling_nodes');
    const auth = createServer(async (req, res) => {
      if (req.url?.endsWith('/room-authorize')) {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw);
        if (body.token !== 'integration-test-token-0123456789abcdef') {
          res.writeHead(401);
          res.end('{}');
          return;
        }
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            allowed: true,
            kind: 'registered',
            displayName: 'Owner',
            userId: '11111111-1111-4111-8111-111111111111',
          }),
        );
      } else {
        res.writeHead(200);
        res.end('{}');
      }
    });
    auth.listen(0, '127.0.0.1');
    await once(auth, 'listening');
    const authPort = portOf(auth),
      aPort = await freePort(),
      bPort = await freePort(),
      gatewayPort = await freePort();
    const logs: string[] = [];
    const children: ChildProcess[] = [];
    const common = {
      ...process.env,
      SIGNALING_CLUSTER_DATABASE_URL: url!,
      SIGNALING_CLUSTER_DATABASE_SSL: 'false',
      SIGNALING_LEASE_MS: '5000',
      SIGNALING_RECOVERY_MS: '120000',
      INTERNAL_SIGNALING_SECRET: 'test-only-internal-secret-0123456789',
      ACCOUNT_API_URL: `http://127.0.0.1:${authPort}`,
      TURN_KEY_ID: '',
      TURN_KEY_API_TOKEN: '',
      TURN_BROKER_URL: '',
      ALLOWED_ORIGIN: '*',
    };
    const launch = (entry: string, extra: Record<string, string>) => {
      const child = spawn(process.execPath, ['--import', 'tsx', `src/${entry}.ts`], {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        env: { ...common, ...extra },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout?.on('data', (data) => logs.push(String(data)));
      child.stderr?.on('data', (data) => logs.push(String(data)));
      children.push(child);
      return child;
    };
    const sockets: WebSocket[] = [];
    try {
      const first = launch('server', {
        PORT: String(aPort),
        SIGNALING_NODE_ID: 'real-a',
        SIGNALING_NODE_URL: `http://127.0.0.1:${aPort}/`,
      });
      const second = launch('server', {
        PORT: String(bPort),
        SIGNALING_NODE_ID: 'real-b',
        SIGNALING_NODE_URL: `http://127.0.0.1:${bPort}/`,
      });
      launch('gateway', { GATEWAY_PORT: String(gatewayPort) });
      await Promise.all([ready(aPort), ready(bPort), ready(gatewayPort)]);
      const roomId = 'CDEFGHJK2345',
        clientId = randomUUID(),
        sessionId = randomUUID();
      const join = {
        type: 'create-room',
        roomId,
        clientId,
        sessionId,
        name: 'Owner',
        authToken: 'integration-test-token-0123456789abcdef',
      };
      const socket = new WebSocket(`ws://127.0.0.1:${gatewayPort}/ws?room=${roomId}`);
      sockets.push(socket);
      socket.on('error', () => {});
      const initial = messageOf(socket, 'joined-room');
      await once(socket, 'open');
      socket.send(JSON.stringify(join));
      const before = await initial;
      const muted = messageOf(socket, 'mute-changed');
      socket.send(JSON.stringify({ type: 'mute-changed', muted: true }));
      await muted;
      const chat = messageOf(socket, 'room-chat-message');
      socket.send(
        JSON.stringify({
          type: 'room-chat-message',
          id: randomUUID(),
          text: 'Persisted before crash',
        }),
      );
      await chat;
      const owner = await pool.query<{ node_id: string }>(
        'SELECT node_id FROM signaling_rooms WHERE id=$1',
        [roomId],
      );
      (owner.rows[0]!.node_id === 'real-a' ? first : second).kill('SIGKILL');
      let restored: Record<string, unknown> | undefined;
      const deadline = Date.now() + 25_000;
      while (Date.now() < deadline && !restored) {
        const reconnect = new WebSocket(`ws://127.0.0.1:${gatewayPort}/ws?room=${roomId}`);
        sockets.push(reconnect);
        reconnect.on('error', () => {});
        const response = messageOf(reconnect, 'joined-room', 1_000);
        reconnect.on('open', () => reconnect.send(JSON.stringify({ ...join, type: 'join-room' })));
        try {
          restored = await response;
        } catch {
          reconnect.terminate();
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      expect(restored, logs.slice(-12).join('')).toBeDefined();
      expect(restored?.roomStartedAt).toBe(before.roomStartedAt);
      expect(restored?.participants).toEqual([
        expect.objectContaining({ id: clientId, isOwner: true, muted: true }),
      ]);
      expect(restored?.roomChatMessages).toEqual([
        expect.objectContaining({ text: 'Persisted before crash' }),
      ]);
    } finally {
      for (const socket of sockets) socket.terminate();
      for (const child of children) child.kill('SIGKILL');
      await new Promise<void>((resolve) => auth.close(() => resolve()));
    }
  }, 45_000);
});

function portOf(server: Server) {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  return address.port;
}
async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = portOf(server);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
async function ready(port: number) {
  const until = Date.now() + 10_000;
  while (Date.now() < until) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/ready`)).ok) return;
    } catch {
      /* starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Process ${port} not ready`);
}
function messageOf(
  socket: WebSocket,
  type: string,
  timeout = 5_000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', listener);
      reject(new Error(`No ${type}`));
    }, timeout);
    const listener = (data: unknown) => {
      const value = JSON.parse(String(data));
      if (value.type === type) {
        clearTimeout(timer);
        socket.off('message', listener);
        resolve(value);
      }
    };
    socket.on('message', listener);
  });
}

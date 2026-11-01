import pg from 'pg';
import { createHash } from 'node:crypto';
import type { RoomSnapshot } from './room-manager.js';

export const CLUSTER_SCHEMA = `
CREATE TABLE IF NOT EXISTS signaling_nodes (
  id text PRIMARY KEY, instance_id uuid NOT NULL, url text NOT NULL,
  capacity integer NOT NULL CHECK(capacity > 0), draining boolean NOT NULL DEFAULT false,
  seen_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS signaling_rooms (
  id text PRIMARY KEY, node_id text NOT NULL, instance_id uuid NOT NULL,
  epoch bigint NOT NULL DEFAULT 1, lease_until timestamptz NOT NULL,
  recover_until timestamptz NOT NULL, snapshot jsonb
);
CREATE INDEX IF NOT EXISTS signaling_rooms_node_idx ON signaling_rooms(node_id);
CREATE INDEX IF NOT EXISTS signaling_rooms_expiry_idx ON signaling_rooms(recover_until) WHERE snapshot IS NOT NULL;
`;

export class ClusterUnavailable extends Error {}
export interface RoomLease {
  epoch: string;
  snapshot: RoomSnapshot | null;
}
export interface NodeConfig {
  id: string;
  instanceId: string;
  url: string;
  capacity: number;
  leaseMs: number;
  recoveryMs: number;
}
export function clusterPool(url: string) {
  const pool = new pg.Pool({
    connectionString: url,
    max: 8,
    connectionTimeoutMillis: 2_000,
    query_timeout: 2_000,
    statement_timeout: 1_500,
    idle_in_transaction_session_timeout: 3_000,
    ssl:
      process.env.SIGNALING_CLUSTER_DATABASE_SSL === 'true'
        ? { rejectUnauthorized: true }
        : undefined,
  });
  pool.on('error', (error) => console.error('Cluster database connection lost', error.message));
  return pool;
}

export class ClusterStore {
  constructor(
    readonly pool: pg.Pool,
    readonly node: NodeConfig,
  ) {}

  async register() {
    const n = this.node;
    const result = await this.pool.query(
      `INSERT INTO signaling_nodes(id,instance_id,url,capacity) VALUES($1,$2,$3,$4)
       ON CONFLICT(id) DO UPDATE SET instance_id=$2,url=$3,capacity=$4,seen_at=clock_timestamp()
       WHERE signaling_nodes.instance_id=$2 OR signaling_nodes.seen_at<clock_timestamp()-interval '15 seconds'
       RETURNING id`,
      [n.id, n.instanceId, n.url, n.capacity],
    );
    if (!result.rowCount) throw new ClusterUnavailable('Node ID already used by a live process');
  }

  async heartbeat() {
    const result = await this.pool.query(
      `UPDATE signaling_nodes SET seen_at=clock_timestamp() WHERE id=$1 AND instance_id=$2 RETURNING id`,
      [this.node.id, this.node.instanceId],
    );
    if (!result.rowCount) throw new ClusterUnavailable('Node registration was replaced');
  }

  async expireSnapshots() {
    await this.pool.query(`UPDATE signaling_rooms SET snapshot=NULL
      WHERE snapshot IS NOT NULL AND recover_until<clock_timestamp()`);
  }

  async acquire(roomId: string, create: boolean): Promise<RoomLease> {
    const n = this.node;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serializes both the absent-row case and takeover. Locks are scoped to this transaction.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 7061))', [roomId]);
      const current = await client.query<{
        epoch: string;
        snapshot: RoomSnapshot | null;
        ours: boolean;
        live: boolean;
        recoverable: boolean;
      }>(
        `SELECT epoch::text,snapshot,node_id=$2 AND instance_id=$3 AS ours,
            lease_until>clock_timestamp() AS live,recover_until>clock_timestamp() AS recoverable
          FROM signaling_rooms WHERE id=$1 FOR UPDATE`,
        [roomId, n.id, n.instanceId],
      );
      const row = current.rows[0];
      if (row?.live && !row.ours)
        throw new ClusterUnavailable('Room is owned by another live node');
      const snapshot = row?.recoverable ? row.snapshot : null;
      if (!create && !snapshot) throw new ClusterUnavailable('Room recovery state is unavailable');
      if (!row?.ours || !row.live) {
        const admission = await client.query<{ draining: boolean; capacity: number }>(
          'SELECT draining,capacity FROM signaling_nodes WHERE id=$1 AND instance_id=$2 FOR UPDATE',
          [n.id, n.instanceId],
        );
        const occupancy = await client.query<{ count: string }>(
          'SELECT count(*) FROM signaling_rooms WHERE node_id=$1 AND instance_id=$2 AND lease_until>clock_timestamp() AND id<>$3',
          [n.id, n.instanceId, roomId],
        );
        if (
          !admission.rows[0] ||
          admission.rows[0].draining ||
          Number(occupancy.rows[0]!.count) >= admission.rows[0].capacity
        )
          throw new ClusterUnavailable('Node is draining or at capacity');
      }
      const acquired = await client.query<{ epoch: string }>(
        `INSERT INTO signaling_rooms(id,node_id,instance_id,lease_until,recover_until)
         VALUES($1,$2,$3,clock_timestamp()+$4*interval '1 millisecond',clock_timestamp()+$5*interval '1 millisecond')
         ON CONFLICT(id) DO UPDATE SET node_id=$2,instance_id=$3,
           epoch=signaling_rooms.epoch+CASE WHEN signaling_rooms.node_id=$2 AND signaling_rooms.instance_id=$3
             AND signaling_rooms.lease_until>clock_timestamp() THEN 0 ELSE 1 END,
           lease_until=clock_timestamp()+$4*interval '1 millisecond',
           recover_until=clock_timestamp()+$5*interval '1 millisecond'
         RETURNING epoch::text`,
        [roomId, n.id, n.instanceId, n.leaseMs, n.recoveryMs],
      );
      await client.query('COMMIT');
      return { epoch: acquired.rows[0]!.epoch, snapshot };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async save(roomId: string, epoch: string, snapshot: RoomSnapshot | null) {
    const n = this.node;
    const result = await this.pool.query(
      `UPDATE signaling_rooms SET snapshot=$5::jsonb,
         lease_until=clock_timestamp()+$6*interval '1 millisecond',
         recover_until=CASE WHEN $5::jsonb IS NULL THEN clock_timestamp() ELSE clock_timestamp()+$7*interval '1 millisecond' END
       WHERE id=$1 AND node_id=$2 AND instance_id=$3 AND epoch=$4::bigint
         AND lease_until>clock_timestamp()
         AND EXISTS(SELECT 1 FROM signaling_nodes n WHERE n.id=$2 AND n.instance_id=$3
           AND n.seen_at>clock_timestamp()-interval '15 seconds') RETURNING id`,
      [
        roomId,
        n.id,
        n.instanceId,
        epoch,
        snapshot ? JSON.stringify(snapshot) : null,
        n.leaseMs,
        n.recoveryMs,
      ],
    );
    if (!result.rowCount) throw new ClusterUnavailable('Room lease lost; stale writer fenced');
  }

  async renew(roomId: string, epoch: string) {
    const n = this.node;
    const result = await this.pool.query(
      `UPDATE signaling_rooms SET
      lease_until=clock_timestamp()+$5*interval '1 millisecond',
      recover_until=clock_timestamp()+$6*interval '1 millisecond'
      WHERE id=$1 AND node_id=$2 AND instance_id=$3 AND epoch=$4::bigint
        AND lease_until>clock_timestamp()
        AND EXISTS(SELECT 1 FROM signaling_nodes n WHERE n.id=$2 AND n.instance_id=$3
          AND n.seen_at>clock_timestamp()-interval '15 seconds') RETURNING id`,
      [roomId, n.id, n.instanceId, epoch, n.leaseMs, n.recoveryMs],
    );
    if (!result.rowCount) throw new ClusterUnavailable('Room lease lost; stale writer fenced');
  }
}

export async function routeRoom(pool: pg.Pool, roomId: string): Promise<string> {
  const existing = await pool.query<{ url: string; live: boolean }>(
    `SELECT n.url,r.lease_until>clock_timestamp() AS live FROM signaling_rooms r
     JOIN signaling_nodes n ON n.id=r.node_id AND n.instance_id=r.instance_id
     WHERE r.id=$1 AND r.snapshot IS NOT NULL AND r.recover_until>clock_timestamp()`,
    [roomId],
  );
  if (existing.rows[0]?.live) return existing.rows[0].url;
  const nodes = await pool.query<{ id: string; url: string; load: number }>(
    `SELECT n.id,n.url,count(r.id)::float/n.capacity AS load FROM signaling_nodes n
     LEFT JOIN signaling_rooms r ON r.node_id=n.id AND r.instance_id=n.instance_id
       AND r.snapshot IS NOT NULL AND r.lease_until>clock_timestamp()
     WHERE NOT n.draining AND n.seen_at>clock_timestamp()-interval '15 seconds'
     GROUP BY n.id HAVING count(r.id)<n.capacity`,
  );
  // Deterministic tie breaking sends concurrent first joins to the same node.
  nodes.rows.sort(
    (a, b) => a.load - b.load || score(roomId, b.id).localeCompare(score(roomId, a.id)),
  );
  const node = nodes.rows[0];
  if (!node) throw new ClusterUnavailable('No healthy nodes with free capacity');
  return node.url;
}
function score(roomId: string, nodeId: string) {
  return createHash('sha256').update(`${roomId}:${nodeId}`).digest('hex');
}

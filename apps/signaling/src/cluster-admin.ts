import { CLUSTER_SCHEMA, clusterPool } from './cluster-store.js';
const url = process.env.SIGNALING_CLUSTER_DATABASE_URL;
if (!url) throw new Error('SIGNALING_CLUSTER_DATABASE_URL is required');
const pool = clusterPool(url);
try {
  const [action, nodeId] = process.argv.slice(2);
  if (action === 'migrate') await pool.query(CLUSTER_SCHEMA);
  else if (action === 'status') {
    console.table(
      (
        await pool.query(`SELECT n.id,n.url,n.draining,n.seen_at,
      n.seen_at>clock_timestamp()-interval '15 seconds' AS healthy,
      n.capacity,count(r.id) AS rooms FROM signaling_nodes n
      LEFT JOIN signaling_rooms r ON r.node_id=n.id AND r.instance_id=n.instance_id
        AND r.snapshot IS NOT NULL AND r.lease_until>clock_timestamp()
      GROUP BY n.id ORDER BY n.id`)
      ).rows,
    );
  } else if (action === 'assert-empty' && nodeId && /^[a-z0-9-]{1,63}$/.test(nodeId)) {
    const rooms = await pool.query(
      `SELECT id FROM signaling_rooms WHERE node_id=$1 AND snapshot IS NOT NULL AND lease_until>clock_timestamp() LIMIT 1`,
      [nodeId],
    );
    if (rooms.rowCount)
      throw new Error('Node still owns active rooms; drain and wait before upgrading');
  } else if (
    (action === 'drain' || action === 'resume') &&
    nodeId &&
    /^[a-z0-9-]{1,63}$/.test(nodeId)
  ) {
    const changed = await pool.query(
      'UPDATE signaling_nodes SET draining=$2 WHERE id=$1 RETURNING id',
      [nodeId, action === 'drain'],
    );
    if (!changed.rowCount) throw new Error('Unknown node');
    console.info(`${nodeId}: ${action}`);
  } else
    throw new Error('Usage: cluster-admin migrate|status|drain NODE|resume NODE|assert-empty NODE');
} finally {
  await pool.end();
}

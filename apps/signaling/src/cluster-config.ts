import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ClusterStore, clusterPool } from './cluster-store.js';

export function configuredClusterStore() {
  if (!process.env.SIGNALING_CLUSTER_DATABASE_URL) return undefined;
  const config = z
    .object({
      SIGNALING_NODE_ID: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
      SIGNALING_NODE_URL: z
        .string()
        .url()
        .refine((value) => {
          const url = new URL(value);
          return (
            ['http:', 'https:'].includes(url.protocol) &&
            !url.username &&
            !url.password &&
            url.pathname === '/'
          );
        }),
      SIGNALING_NODE_CAPACITY: z.coerce.number().int().min(1).max(100_000).default(100),
      SIGNALING_LEASE_MS: z.coerce.number().int().min(5_000).max(60_000).default(15_000),
      SIGNALING_RECOVERY_MS: z.coerce.number().int().min(60_000).max(600_000).default(120_000),
    })
    .parse(process.env);
  return new ClusterStore(clusterPool(process.env.SIGNALING_CLUSTER_DATABASE_URL), {
    id: config.SIGNALING_NODE_ID,
    instanceId: randomUUID(),
    url: config.SIGNALING_NODE_URL,
    capacity: config.SIGNALING_NODE_CAPACITY,
    leaseMs: config.SIGNALING_LEASE_MS,
    recoveryMs: config.SIGNALING_RECOVERY_MS,
  });
}

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { db } from './db.js';

interface RouteBucket {
  durations: number[];
  errors: number;
}

const started = new WeakMap<FastifyRequest, number>();
let buckets = new Map<string, RouteBucket>();

function percentile(sorted: number[], ratio: number) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
}

async function flush() {
  const current = buckets;
  buckets = new Map();
  const minute = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  await Promise.all(
    [...current].map(async ([route, bucket]) => {
      bucket.durations.sort((a, b) => a - b);
      const average =
        bucket.durations.reduce((sum, value) => sum + value, 0) / bucket.durations.length;
      await db.query(
        `INSERT INTO api_metric_minutes(
           observed_minute,route,request_count,error_count,average_latency_ms,p50_latency_ms,p95_latency_ms
         ) VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(observed_minute,route) DO UPDATE SET
           average_latency_ms=(api_metric_minutes.average_latency_ms*api_metric_minutes.request_count+
             EXCLUDED.average_latency_ms*EXCLUDED.request_count)/
             NULLIF(api_metric_minutes.request_count+EXCLUDED.request_count,0),
           request_count=api_metric_minutes.request_count+EXCLUDED.request_count,
           error_count=api_metric_minutes.error_count+EXCLUDED.error_count,
           p50_latency_ms=GREATEST(api_metric_minutes.p50_latency_ms,EXCLUDED.p50_latency_ms),
           p95_latency_ms=GREATEST(api_metric_minutes.p95_latency_ms,EXCLUDED.p95_latency_ms)`,
        [
          minute,
          route,
          bucket.durations.length,
          bucket.errors,
          average,
          percentile(bucket.durations, 0.5),
          percentile(bucket.durations, 0.95),
        ],
      );
    }),
  );
}

export function registerApiMetrics(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    started.set(request, performance.now());
  });
  app.addHook('onResponse', async (request, reply) => {
    const began = started.get(request);
    if (began === undefined) return;
    const route = String(request.routeOptions.url || 'unmatched').slice(0, 160);
    const bucket = buckets.get(route) ?? { durations: [], errors: 0 };
    if (bucket.durations.length < 10_000)
      bucket.durations.push(Math.max(0, performance.now() - began));
    if (reply.statusCode >= 500) bucket.errors += 1;
    buckets.set(route, bucket);
  });
  const timer = setInterval(() => void flush().catch(() => undefined), 60_000);
  timer.unref();
}

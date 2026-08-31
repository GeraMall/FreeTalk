import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const users = Number(process.argv[2] ?? 100);
const durationSeconds = Number(process.env.LOAD_DURATION_SECONDS ?? 60);
const apiUrl = process.env.LOAD_API_URL?.replace(/\/$/, '');
const internalSecret = process.env.LOAD_INTERNAL_SECRET;
const adminToken = process.env.LOAD_ADMIN_ACCESS_TOKEN;
if (![100, 500].includes(users) || !apiUrl || !internalSecret) {
  console.error(
    'Usage: LOAD_API_URL=http://127.0.0.1:8790 LOAD_INTERNAL_SECRET=... node scripts/load/analytics-telemetry-load.mjs 100|500',
  );
  process.exit(2);
}

const clients = Array.from({ length: users }, () => randomUUID());
const counters = new Map(clients.map((client) => [client, { sent: 0, received: 0 }]));
const latencies = [];
let failures = 0;
const ticks = Math.max(1, Math.ceil(durationSeconds / 10));
const startedAt = new Date().toISOString();

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
}

async function send(client, index, tick) {
  const peer = clients[index % 2 === 0 ? Math.min(index + 1, clients.length - 1) : index - 1];
  if (!peer || peer === client) return;
  const counter = counters.get(client);
  counter.sent += 180_000 + (index % 17) * 1_000;
  counter.received += 220_000 + (index % 13) * 1_000;
  const turn = index % 10 === 0;
  const body = {
    roomId: `LOADROOM${String(Math.floor(index / 8)).padStart(8, '0')}`,
    reporterClientId: client,
    report: {
      eventVersion: 1,
      timestamp: Date.now(),
      clientVersion: 'load-test',
      platform: 'windows',
      sessionId: `load-session-${String(index).padStart(8, '0')}`,
      connections: [
        {
          peerId: peer,
          connectionType: turn ? 'turn' : 'direct',
          localCandidateType: turn ? 'relay' : 'srflx',
          remoteCandidateType: 'host',
          protocol: 'udp',
          connectionState: 'connected',
          iceState: 'completed',
          rttMs: 18 + (index % 60),
          availableOutgoingBitrate: 2_500_000,
          availableIncomingBitrate: 4_500_000,
          bytesSent: counter.sent,
          bytesReceived: counter.received,
          media: [
            {
              source: index % 5 === 0 ? 'screen' : 'camera',
              direction: 'outbound',
              width: index % 3 === 0 ? 1920 : 1280,
              height: index % 3 === 0 ? 1080 : 720,
              framesPerSecond: index % 5 === 0 ? 15 : 30,
              bitrate: 1_500_000,
              packetsLost: tick,
              packetsDelta: 900,
              packetsLostDelta: index % 20 === 0 ? 2 : 0,
              packetLossPercent: index % 20 === 0 ? 0.22 : 0,
              qualityLimitationReason: index % 12 === 0 ? 'bandwidth' : 'none',
              ...(index % 5 === 0 ? { mode: 'text' } : {}),
            },
          ],
        },
      ],
      events:
        tick === 0 && index % 50 === 0 ? [{ type: 'ice_restart', timestamp: Date.now() }] : [],
    },
  };
  const began = performance.now();
  try {
    const response = await fetch(`${apiUrl}/v1/internal/telemetry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-freetalk-internal-secret': internalSecret },
      body: JSON.stringify(body),
    });
    latencies.push(performance.now() - began);
    if (!response.ok) failures += 1;
  } catch {
    latencies.push(performance.now() - began);
    failures += 1;
  }
}

for (let tick = 0; tick < ticks; tick += 1) {
  for (let offset = 0; offset < clients.length; offset += 40)
    await Promise.all(
      clients.slice(offset, offset + 40).map((client, local) => send(client, offset + local, tick)),
    );
  if (tick < ticks - 1) await new Promise((resolve) => setTimeout(resolve, 10_000));
}

let overview;
if (adminToken) {
  const response = await fetch(`${apiUrl}/v1/admin/overview`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });
  if (response.ok) overview = await response.json();
}
const result = {
  scope: 'analytics collector only; does not claim full signaling/chat/media capacity',
  users,
  startedAt,
  finishedAt: new Date().toISOString(),
  reports: latencies.length,
  failures,
  collectorLatencyMs: {
    average: latencies.reduce((sum, value) => sum + value, 0) / Math.max(1, latencies.length),
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    maximum: Math.max(0, ...latencies),
  },
  backend: overview
    ? {
        infrastructure: overview.infrastructure?.current,
        api: overview.api,
        database: overview.database,
      }
    : 'LOAD_ADMIN_ACCESS_TOKEN not supplied; backend CPU/RAM/Admin API metrics unavailable',
};
await mkdir('output/load', { recursive: true });
await writeFile(`output/load/analytics-${users}.json`, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));

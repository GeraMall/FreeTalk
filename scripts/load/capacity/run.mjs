import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { availableParallelism, totalmem, cpus } from 'node:os';
import { requireLab, requireSignal, summary } from './common.mjs';

requireLab();
const { WebSocket } = requireSignal('ws');
const fixture = JSON.parse(await readFile(`${process.env.CAPACITY_STATE}/clients.json`, 'utf8'));
const base = 'http://127.0.0.1:18890';
const stages = [
  [100, 30],
  [500, 30],
  [1000, 45],
  [2500, 45],
  [5000, 60],
  [10000, 180],
];
const ready = new Set();
const sockets = new Map();
const authLatencies = [];
const deliveryLatencies = [];
const pendingDeliveries = new Map();
const requests = [];
const resources = [];
const results = [];
const failures = {
  authentication: 0,
  unexpectedCloses: 0,
  socketErrors: 0,
  http: 0,
  deliveryTimeouts: 0,
};
const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();
let stopping = false;
let maxOnline = 0;
let badHealth = 0;
let aborted;
let sequence = 0;
let deliveryCount = 0;
let bodyCounter = 0;
let senderCursor = 0;
let readerCursor = 0;
let listCursor = 0;
let operations = 0;
let peakOperations = 0;
let requestBudget = { send: 0, history: 0, list: 0 };
const start = performance.now();
const startedAt = new Date().toISOString();
const errorTotal = () => Object.values(failures).reduce((a, b) => a + b, 0);
const generator = { cpu: process.cpuUsage(), time: performance.now() };
const cgroup = '/sys/fs/cgroup/system.slice/trlka-capacity-lab.service';

async function resourceSnapshot() {
  const [memory, cpu, memoryEvents] = await Promise.all([
    readFile(`${cgroup}/memory.current`, 'utf8'),
    readFile(`${cgroup}/cpu.stat`, 'utf8'),
    readFile(`${cgroup}/memory.events`, 'utf8'),
  ]);
  const numeric = (text) =>
    Object.fromEntries(
      text
        .trim()
        .split('\n')
        .map((line) => line.split(/\s+/))
        .map(([key, value]) => [key, Number(value)]),
    );
  const cpuNow = process.cpuUsage();
  const now = performance.now();
  const row = {
    elapsedSeconds: Math.round((now - start) / 1000),
    online: ready.size,
    serverMemoryBytes: Number(memory),
    serverCpu: numeric(cpu),
    serverMemoryEvents: numeric(memoryEvents),
    generatorCpuPercent: Math.round(
      (100 * (cpuNow.user - generator.cpu.user + cpuNow.system - generator.cpu.system)) /
        ((now - generator.time) * 1000),
    ),
    generatorRss: process.memoryUsage().rss,
    generatorEventLoopP99Ms: loopDelay.percentile(99) / 1e6,
    outstandingHttp: operations,
  };
  generator.cpu = cpuNow;
  generator.time = now;
  resources.push(row);
  loopDelay.reset();
  if (row.serverMemoryBytes > 3.8 * 1024 ** 3 || row.serverMemoryEvents.oom_kill > 0)
    aborted = 'Server memory threshold';
  if (row.generatorEventLoopP99Ms > 2000 || operations > 500)
    aborted = 'Load generator saturation; capacity result is inconclusive';
}

function connect(index) {
  const user = fixture[index];
  const began = performance.now();
  let authenticated = false;
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/v1/chats/realtime', {
    headers: { 'x-capacity-client': String(index), origin: 'http://127.0.0.1:1420' },
    handshakeTimeout: 7000,
    perMessageDeflate: false,
  });
  sockets.set(index, socket);
  const deadline = setTimeout(() => {
    if (!authenticated && !stopping) {
      failures.authentication++;
      socket.terminate();
    }
  }, 7000);
  socket.on('open', () => socket.send(JSON.stringify({ type: 'authenticate', token: user.token })));
  socket.on('message', (data) => {
    let event;
    try {
      event = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (event.type === 'ready' && !authenticated) {
      authenticated = true;
      clearTimeout(deadline);
      ready.add(index);
      maxOnline = Math.max(maxOnline, ready.size);
      authLatencies.push(performance.now() - began);
    }
    if (event.type === 'message-created') {
      const pending = pendingDeliveries.get(event.message?.body);
      if (pending && pending.expected.has(index)) {
        pending.received.add(index);
        if (pending.received.size === pending.expected.size) {
          deliveryLatencies.push(performance.now() - pending.began);
          deliveryCount++;
          pendingDeliveries.delete(event.message.body);
        }
      }
    }
  });
  socket.on('error', () => {
    if (!stopping) failures.socketErrors++;
  });
  socket.on('close', () => {
    clearTimeout(deadline);
    if (authenticated && !stopping) failures.unexpectedCloses++;
    ready.delete(index);
  });
}

function pick(cursor, count, target) {
  const index = (cursor % Math.max(1, count)) * 10;
  return Math.min(target - 1, index);
}

async function http(index, kind) {
  const user = fixture[index];
  if (!ready.has(index)) return;
  const path = kind === 'list' ? '/v1/chats' : `/v1/chats/${user.chatId}/messages`;
  const body = kind === 'send' ? `capacity:${bodyCounter++}` : undefined;
  if (body) {
    const groupStart = Math.floor(index / 10) * 10;
    const expected = new Set(
      Array.from({ length: 10 }, (_, i) => groupStart + i).filter((id) => ready.has(id)),
    );
    pendingDeliveries.set(body, { expected, received: new Set(), began: performance.now() });
  }
  const began = performance.now();
  operations++;
  peakOperations = Math.max(peakOperations, operations);
  let status = 0;
  try {
    const response = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${user.token}`,
        'x-capacity-client': String(index),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify({ body }) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    status = response.status;
    await response.arrayBuffer();
    if (!response.ok) {
      failures.http++;
      if (body) pendingDeliveries.delete(body);
    }
  } catch {
    failures.http++;
    if (body) pendingDeliveries.delete(body);
  } finally {
    requests.push({ kind, status, ms: performance.now() - began });
    operations--;
  }
}

function workload(target) {
  // 10% of online users act once per 30 seconds; half that rate loads chat lists.
  const active = Math.max(1, Math.floor(target / 10));
  requestBudget.send += active / 30;
  requestBudget.history += active / 30;
  requestBudget.list += active / 60;
  for (const kind of ['send', 'history', 'list']) {
    while (requestBudget[kind] >= 1 && !aborted) {
      requestBudget[kind]--;
      const cursor =
        kind === 'send' ? senderCursor++ : kind === 'history' ? readerCursor++ : listCursor++;
      void http(pick(cursor, active, target), kind);
    }
  }
}

async function health() {
  try {
    const began = performance.now();
    const response = await fetch(base + '/health', {
      headers: { 'x-capacity-client': '0' },
      signal: AbortSignal.timeout(3000),
    });
    await response.arrayBuffer();
    badHealth = !response.ok || performance.now() - began > 2000 ? badHealth + 1 : 0;
  } catch {
    badHealth++;
  }
  if (badHealth >= 3) aborted = 'Three consecutive slow/failed health checks';
}

function expireDeliveries() {
  for (const [body, pending] of pendingDeliveries) {
    if (performance.now() - pending.began > 7000) {
      failures.deliveryTimeouts++;
      pendingDeliveries.delete(body);
    }
  }
}

try {
  for (const [target, seconds] of stages) {
    const before = { ...failures };
    const offset = requests.length;
    const deliveryOffset = deliveryLatencies.length;
    const resourceOffset = resources.length;
    // Open at most 100 sessions/second. This is not a login/password-hashing storm test.
    while (sequence < target && !aborted) {
      for (let i = 0; i < 100 && sequence < target; i++) connect(sequence++);
      await sleep(1000);
      await resourceSnapshot();
      if (failures.authentication > Math.max(2, sequence * 0.01))
        aborted = 'Authentication failure threshold';
    }
    const waitUntil = performance.now() + 8000;
    while (ready.size < target && performance.now() < waitUntil && !aborted) await sleep(100);
    if (ready.size < target) aborted ??= 'Could not reach requested simultaneous online count';
    const onlineAtStart = ready.size;
    for (let tick = 0; tick < seconds && !aborted; tick++) {
      const began = performance.now();
      workload(target);
      expireDeliveries();
      if (tick % 5 === 0) {
        await resourceSnapshot();
        await health();
      }
      if (tick > 10 && ready.size < target * 0.99) aborted = 'More than 1% of sessions lost';
      const currentRequests = requests.length - offset;
      if (currentRequests >= 30 && failures.http - before.http > currentRequests * 0.01)
        aborted = 'HTTP error rate above 1%';
      if (failures.deliveryTimeouts - before.deliveryTimeouts > 2)
        aborted = 'Realtime delivery timeout threshold';
      await sleep(Math.max(0, 1000 - (performance.now() - began)));
    }
    const deadline = performance.now() + 8000;
    while ((operations || pendingDeliveries.size) && performance.now() < deadline) {
      expireDeliveries();
      await sleep(100);
    }
    expireDeliveries();
    const sample = requests.slice(offset);
    const deltas = Object.fromEntries(
      Object.keys(failures).map((key) => [key, failures[key] - before[key]]),
    );
    const stage = {
      target,
      holdSeconds: seconds,
      onlineAtStart,
      onlineAtEnd: ready.size,
      passed:
        !aborted &&
        Object.values(deltas).every((value) => value === 0) &&
        (summary(sample.map((r) => r.ms)).p95 ?? Infinity) < 1000,
      failures: deltas,
      requestLatencyMs: summary(sample.map((r) => r.ms)),
      deliveryToAllOnlineGroupMembersMs: summary(deliveryLatencies.slice(deliveryOffset)),
      httpStatuses: Object.fromEntries(
        [...new Set(sample.map((r) => r.status))].map((s) => [
          s,
          sample.filter((r) => r.status === s).length,
        ]),
      ),
      peakServerMemoryBytes: Math.max(
        0,
        ...resources.slice(resourceOffset).map((r) => r.serverMemoryBytes),
      ),
    };
    results.push(stage);
    console.log(JSON.stringify(stage));
    if (aborted) break;
  }
} catch (error) {
  aborted = String(error.message);
} finally {
  stopping = true;
  for (const socket of sockets.values()) socket.terminate();
  loopDelay.disable();
  const report = {
    scope:
      'Isolated authenticated chat API + realtime. Synthetic users in 10-person groups; 20 history messages/group; 10% active. Not a production VPS capacity certificate.',
    excluded: [
      'password hashing/login bursts',
      'TLS/Caddy/DDoS protection',
      'geographic latency',
      'images/files',
      'voice/video/TURN',
      'browser UI rendering',
      'HA replication and failover',
      'future community servers',
    ],
    sourceCommit: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    startedAt,
    finishedAt: new Date().toISOString(),
    serverLimits: {
      cpuCores: 2,
      memoryBytes: 4 * 1024 ** 3,
      swapBytes: 0,
      postgresVersion: 16,
      sharedBuffersMB: 128,
    },
    generatorHost: {
      availableCpus: availableParallelism(),
      cpu: cpus()[0]?.model,
      totalMemory: totalmem(),
    },
    maxAuthenticatedSimultaneously: maxOnline,
    completedDeliveryFanouts: deliveryCount,
    peakOutstandingHttp: peakOperations,
    failures,
    aborted: aborted ?? null,
    passed10000: results.some((stage) => stage.target === 10000 && stage.passed),
    authenticationLatencyMs: summary(authLatencies),
    stages: results,
    resources,
  };
  await mkdir('output/load', { recursive: true });
  await writeFile('output/load/capacity-10000.json', JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      maxOnline,
      passed10000: report.passed10000,
      errors: errorTotal(),
      aborted: report.aborted,
    }),
  );
  if (!report.passed10000) process.exitCode = 1;
}

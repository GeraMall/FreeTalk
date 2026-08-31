import { cpus, freemem, loadavg, totalmem, uptime } from 'node:os';
import { readFile, statfs } from 'node:fs/promises';
import { db } from './db.js';

interface CpuSnapshot {
  idle: number;
  total: number;
}

let previousCpu: CpuSnapshot | undefined;

async function linuxCpuSnapshot(): Promise<CpuSnapshot | undefined> {
  if (process.platform !== 'linux') return undefined;
  try {
    const line = (await readFile('/proc/stat', 'utf8')).split('\n')[0];
    const values = line?.trim().split(/\s+/).slice(1).map(Number) ?? [];
    if (values.length < 4 || values.some((value) => !Number.isFinite(value))) return undefined;
    return {
      idle: (values[3] ?? 0) + (values[4] ?? 0),
      total: values.reduce((sum, value) => sum + value, 0),
    };
  } catch {
    return undefined;
  }
}

async function linuxNetwork() {
  if (process.platform !== 'linux') return {};
  try {
    const rows = (await readFile('/proc/net/dev', 'utf8')).split('\n').slice(2);
    let rx = 0;
    let tx = 0;
    for (const row of rows) {
      const [name, raw] = row.split(':');
      if (!raw || name?.trim() === 'lo') continue;
      const values = raw.trim().split(/\s+/).map(Number);
      rx += values[0] ?? 0;
      tx += values[8] ?? 0;
    }
    return { networkRxBytes: rx, networkTxBytes: tx };
  } catch {
    return {};
  }
}

async function diskUsage() {
  try {
    const value = await statfs(process.cwd(), { bigint: true });
    const total = value.blocks * value.bsize;
    const available = value.bavail * value.bsize;
    return { diskUsedBytes: Number(total - available), diskTotalBytes: Number(total) };
  } catch {
    return {};
  }
}

export async function readInfrastructureMetrics() {
  const currentCpu = await linuxCpuSnapshot();
  let cpuPercent: number | undefined;
  if (currentCpu && previousCpu) {
    const totalDelta = currentCpu.total - previousCpu.total;
    const idleDelta = currentCpu.idle - previousCpu.idle;
    if (totalDelta > 0) cpuPercent = Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100));
  }
  previousCpu = currentCpu;
  const [network, disk] = await Promise.all([linuxNetwork(), diskUsage()]);
  const memoryTotal = totalmem();
  return {
    observedAt: new Date(Math.floor(Date.now() / 60_000) * 60_000),
    cpuPercent,
    ramUsedBytes: memoryTotal - freemem(),
    ramTotalBytes: memoryTotal,
    ...disk,
    ...network,
    load1: loadavg()[0] ?? 0,
    cpuCount: cpus().length,
    uptimeSeconds: Math.round(uptime()),
    processRssBytes: process.memoryUsage().rss,
  };
}

export async function sampleInfrastructure() {
  const metrics = await readInfrastructureMetrics();
  let databaseOk = true;
  try {
    await db.query('SELECT 1');
  } catch {
    databaseOk = false;
  }
  await db.query(
    `INSERT INTO infrastructure_samples(
       observed_at,cpu_percent,ram_used_bytes,ram_total_bytes,disk_used_bytes,disk_total_bytes,
       network_rx_bytes,network_tx_bytes,load_1,uptime_seconds,process_rss_bytes,database_ok
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT(observed_at) DO UPDATE SET
       cpu_percent=EXCLUDED.cpu_percent,ram_used_bytes=EXCLUDED.ram_used_bytes,
       ram_total_bytes=EXCLUDED.ram_total_bytes,disk_used_bytes=EXCLUDED.disk_used_bytes,
       disk_total_bytes=EXCLUDED.disk_total_bytes,network_rx_bytes=EXCLUDED.network_rx_bytes,
       network_tx_bytes=EXCLUDED.network_tx_bytes,load_1=EXCLUDED.load_1,
       uptime_seconds=EXCLUDED.uptime_seconds,process_rss_bytes=EXCLUDED.process_rss_bytes,
       database_ok=EXCLUDED.database_ok`,
    [
      metrics.observedAt,
      metrics.cpuPercent ?? null,
      metrics.ramUsedBytes,
      metrics.ramTotalBytes,
      metrics.diskUsedBytes ?? null,
      metrics.diskTotalBytes ?? null,
      metrics.networkRxBytes ?? null,
      metrics.networkTxBytes ?? null,
      metrics.load1,
      metrics.uptimeSeconds,
      metrics.processRssBytes,
      databaseOk,
    ],
  );
  return { ...metrics, databaseOk };
}

export function startInfrastructureSampler() {
  void sampleInfrastructure().catch(() => undefined);
  const timer = setInterval(() => void sampleInfrastructure().catch(() => undefined), 60_000);
  timer.unref();
  const retention = setInterval(
    () => {
      void db
        .query(
          `WITH deleted_connections AS (
           DELETE FROM telemetry_connection_samples WHERE observed_at<now()-interval '7 days'
         ), deleted_events AS (
           DELETE FROM telemetry_events WHERE occurred_at<now()-interval '30 days'
         ), deleted_reporters AS (
           DELETE FROM telemetry_reporters WHERE observed_at<now()-interval '1 day'
         ), deleted_report_minutes AS (
           DELETE FROM telemetry_report_minutes WHERE observed_minute<now()-interval '30 days'
         ), deleted_api AS (
           DELETE FROM api_metric_minutes WHERE observed_minute<now()-interval '30 days'
         )
         DELETE FROM infrastructure_samples WHERE observed_at<now()-interval '30 days'`,
        )
        .catch(() => undefined);
    },
    6 * 60 * 60_000,
  );
  retention.unref();
}

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { telemetryReportSchema } from '@freetalk/protocol';
import { z } from 'zod';
import { authenticate, publicUser } from './auth-service.js';
import { db, transaction } from './db.js';
import { env } from './env.js';
import { sampleInfrastructure } from './infrastructure-metrics.js';
import { secureSecretEqual } from './security.js';

const internalTelemetrySchema = z
  .object({
    roomId: z.string().min(8).max(32),
    reporterClientId: z.string().uuid(),
    userId: z.string().uuid().optional(),
    anonymousUserId: z.string().uuid().optional(),
    report: telemetryReportSchema,
  })
  .refine((value) => !(value.userId && value.anonymousUserId), {
    message: 'Only one analytics identity is allowed',
  });

async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const user = await authenticate(request);
  if (!user) {
    reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Требуется вход администратора' });
    return null;
  }
  if (user.role !== 'admin') {
    reply.code(403).send({ code: 'ADMIN_REQUIRED', message: 'Недостаточно прав' });
    return null;
  }
  return user;
}

function logicalConnectionKey(roomId: string, first: string, second: string) {
  return `${roomId}:${[first, second].sort().join(':')}`;
}

function safeDelta(current: number, previous: number | undefined) {
  if (previous === undefined || current < previous) return 0;
  return current - previous;
}

async function storeTelemetry(input: z.infer<typeof internalTelemetrySchema>) {
  const observedAt = new Date(
    Math.min(Date.now() + 30_000, Math.max(Date.now() - 120_000, input.report.timestamp)),
  );
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO telemetry_reporters(
         reporter_client_id,room_id,user_id,anonymous_user_id,client_version,platform,observed_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(reporter_client_id) DO UPDATE SET
         room_id=EXCLUDED.room_id,user_id=EXCLUDED.user_id,
         anonymous_user_id=EXCLUDED.anonymous_user_id,client_version=EXCLUDED.client_version,
         platform=EXCLUDED.platform,observed_at=EXCLUDED.observed_at`,
      [
        input.reporterClientId,
        input.roomId,
        input.userId ?? null,
        input.anonymousUserId ?? null,
        input.report.clientVersion,
        input.report.platform,
        observedAt,
      ],
    );
    await client.query(
      `INSERT INTO telemetry_report_minutes(
         observed_minute,reporter_client_id,client_version,platform
       ) VALUES(date_trunc('minute',$1::timestamptz),$2,$3,$4)
       ON CONFLICT(observed_minute,reporter_client_id) DO UPDATE SET
         client_version=EXCLUDED.client_version,platform=EXCLUDED.platform`,
      [observedAt, input.reporterClientId, input.report.clientVersion, input.report.platform],
    );
    for (const connection of input.report.connections) {
      if (connection.peerId === input.reporterClientId) continue;
      const key = logicalConnectionKey(input.roomId, input.reporterClientId, connection.peerId);
      const canonicalReporter = input.reporterClientId.localeCompare(connection.peerId) < 0;
      let turnBytesDelta = 0;
      let turnBytesSentDelta = 0;
      let turnBytesReceivedDelta = 0;
      if (connection.connectionType === 'turn') {
        const previous = await client.query<{
          bytes_sent: string;
          bytes_received: string;
          connection_type: string;
        }>(
          `SELECT bytes_sent,bytes_received,connection_type FROM telemetry_connection_samples
           WHERE logical_connection_key=$1 AND reporter_client_id=$2
           ORDER BY observed_at DESC LIMIT 1`,
          [key, input.reporterClientId],
        );
        const row = previous.rows[0]?.connection_type === 'turn' ? previous.rows[0] : undefined;
        turnBytesSentDelta = safeDelta(
          connection.bytesSent,
          row ? Number(row.bytes_sent) : undefined,
        );
        turnBytesReceivedDelta = safeDelta(
          connection.bytesReceived,
          row ? Number(row.bytes_received) : undefined,
        );
        turnBytesDelta = turnBytesSentDelta + turnBytesReceivedDelta;
      }
      await client.query(
        `INSERT INTO telemetry_connection_samples(
           observed_at,event_version,client_version,platform,room_id,logical_connection_key,
           reporter_client_id,peer_client_id,canonical_reporter,connection_type,
           local_candidate_type,remote_candidate_type,protocol,connection_state,ice_state,rtt_ms,
           available_outgoing_bitrate,available_incoming_bitrate,bytes_sent,bytes_received,
           turn_bytes_delta,turn_bytes_sent_delta,turn_bytes_received_delta,media
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
         ON CONFLICT(logical_connection_key,reporter_client_id,observed_at) DO NOTHING`,
        [
          observedAt,
          input.report.eventVersion,
          input.report.clientVersion,
          input.report.platform,
          input.roomId,
          key,
          input.reporterClientId,
          connection.peerId,
          canonicalReporter,
          connection.connectionType,
          connection.localCandidateType,
          connection.remoteCandidateType,
          connection.protocol,
          connection.connectionState,
          connection.iceState,
          connection.rttMs,
          connection.availableOutgoingBitrate,
          connection.availableIncomingBitrate,
          connection.bytesSent,
          connection.bytesReceived,
          turnBytesDelta,
          turnBytesSentDelta,
          turnBytesReceivedDelta,
          JSON.stringify(connection.media),
        ],
      );
    }
    for (const event of input.report.events) {
      const occurredAt = new Date(
        Math.min(Date.now() + 30_000, Math.max(Date.now() - 120_000, event.timestamp)),
      );
      await client.query(
        `INSERT INTO telemetry_events(
           occurred_at,event_type,client_version,platform,room_id,participant_id,details
         ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          occurredAt,
          event.type,
          input.report.clientVersion,
          input.report.platform,
          input.roomId,
          input.reporterClientId,
          JSON.stringify(event.details ?? {}),
        ],
      );
    }
  });
}

function statusForForecast(forecastGb: number, allowanceGb: number) {
  if (forecastGb > allowanceGb) return 'over';
  if (forecastGb >= allowanceGb * 0.95) return 'critical';
  if (forecastGb >= allowanceGb * 0.8) return 'warning';
  return 'safe';
}

export function registerAdminRoutes(app: FastifyInstance) {
  app.post('/v1/internal/telemetry', { config: { rateLimit: false } }, async (request, reply) => {
    const secret = request.headers['x-freetalk-internal-secret'];
    if (typeof secret !== 'string' || !secureSecretEqual(secret, env.INTERNAL_SIGNALING_SECRET))
      return reply.code(401).send({ ok: false });
    const input = internalTelemetrySchema.parse(request.body);
    await storeTelemetry(input);
    return reply.code(202).send({ accepted: true });
  });

  app.get('/v1/admin/me', async (request, reply) => {
    const user = await requireAdmin(request, reply);
    return user ? { user: publicUser(user), role: 'admin' } : undefined;
  });

  app.get('/v1/admin/overview', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const [
      online,
      rooms,
      users,
      connections,
      turn,
      chat,
      quality,
      signaling,
      settingsResult,
      infrastructureHistory,
      networkHistory,
      apiMetrics,
      databaseMetrics,
      clientVersions,
      clientPlatforms,
    ] = await Promise.all([
      db.query<{ total: string; registered: string; guests: string }>(
        `WITH live_reporters AS (
           SELECT user_id,anonymous_user_id FROM telemetry_reporters
           WHERE observed_at>now()-interval '25 seconds'
         ), online_registered AS (
           SELECT user_id FROM analytics_user_presence
           WHERE status<>'offline' AND updated_at>now()-interval '90 seconds'
           UNION SELECT user_id FROM live_reporters WHERE user_id IS NOT NULL
         ), online_guests AS (
           SELECT DISTINCT anonymous_user_id FROM live_reporters
           WHERE anonymous_user_id IS NOT NULL
         )
         SELECT (SELECT count(*) FROM online_registered)+(SELECT count(*) FROM online_guests) total,
                (SELECT count(*) FROM online_registered) registered,
                (SELECT count(*) FROM online_guests) guests`,
      ),
      db.query<{
        active_rooms: string;
        active_calls: string;
        rooms_today: string;
        calls_today: string;
        average_room_size: string;
        average_duration_seconds: string;
      }>(
        `WITH live_reporters AS (
           SELECT DISTINCT reporter_client_id,room_id FROM telemetry_reporters
           WHERE observed_at>now()-interval '25 seconds'
         ), live_rooms AS (
           SELECT room_id,count(*) size FROM live_reporters GROUP BY room_id
         )
         SELECT (SELECT count(*) FROM live_rooms) active_rooms,
                (SELECT count(*) FROM live_rooms) active_calls,
                count(*) FILTER(WHERE started_at>=date_trunc('day',now())) rooms_today,
                count(*) FILTER(WHERE started_at>=date_trunc('day',now())) calls_today,
                COALESCE((SELECT avg(size) FROM live_rooms),0) average_room_size,
                COALESCE(avg(EXTRACT(epoch FROM (ended_at-started_at))) FILTER(WHERE ended_at IS NOT NULL),0) average_duration_seconds
         FROM call_sessions`,
      ),
      db.query<{
        total: string;
        today: string;
        seven_days: string;
        active_sessions: string;
        daily_active_users: string;
        weekly_active_users: string;
        guest_sessions_today: string;
        unique_anonymous_guests: string;
        average_guest_session_seconds: string;
      }>(
        `SELECT count(*) total,count(*) FILTER(WHERE created_at>=date_trunc('day',now())) today,
                count(*) FILTER(WHERE created_at>=now()-interval '7 days') seven_days,
                (SELECT count(*) FROM sessions WHERE revoked_at IS NULL AND refresh_expires_at>now()) active_sessions,
                (SELECT count(DISTINCT user_id) FROM sessions WHERE last_used_at>=date_trunc('day',now())) daily_active_users,
                (SELECT count(DISTINCT user_id) FROM sessions WHERE last_used_at>=now()-interval '7 days') weekly_active_users,
                (SELECT count(*) FROM guest_sessions WHERE created_at>=date_trunc('day',now())) guest_sessions_today,
                (SELECT count(DISTINCT anonymous_user_id) FROM guest_sessions) unique_anonymous_guests,
                COALESCE((SELECT avg(EXTRACT(epoch FROM (COALESCE(ended_at,now())-created_at)))
                  FROM guest_sessions WHERE created_at>=now()-interval '30 days'),0) average_guest_session_seconds
         FROM users WHERE deleted_at IS NULL`,
      ),
      db.query<{
        total: string;
        direct: string;
        turn: string;
        unknown: string;
        udp: string;
        tcp: string;
        tls: string;
        disconnected: string;
        failed: string;
        average_rtt_ms: string;
        p50_rtt_ms: string;
        p95_rtt_ms: string;
      }>(
        `WITH latest AS (
           SELECT DISTINCT ON(logical_connection_key) * FROM telemetry_connection_samples
           WHERE observed_at>now()-interval '25 seconds'
           ORDER BY logical_connection_key,canonical_reporter DESC,observed_at DESC
         ) SELECT count(*) total,
                  count(*) FILTER(WHERE connection_type='direct') direct,
                  count(*) FILTER(WHERE connection_type='turn') turn,
                  count(*) FILTER(WHERE connection_type='unknown') unknown,
                  count(*) FILTER(WHERE protocol='udp') udp,
                  count(*) FILTER(WHERE protocol='tcp') tcp,
                  count(*) FILTER(WHERE protocol='tls') tls,
                  count(*) FILTER(WHERE connection_state='disconnected') disconnected,
                  count(*) FILTER(WHERE connection_state='failed') failed,
                  COALESCE(avg(rtt_ms),0) average_rtt_ms,
                  COALESCE(percentile_cont(.5) WITHIN GROUP(ORDER BY rtt_ms),0) p50_rtt_ms,
                  COALESCE(percentile_cont(.95) WITHIN GROUP(ORDER BY rtt_ms),0) p95_rtt_ms
           FROM latest`,
      ),
      db.query<{
        today: string;
        seven_days: string;
        month_bytes: string;
        month_upload: string;
        month_download: string;
      }>(
        `WITH selected AS (
           SELECT sample.* FROM telemetry_connection_samples sample
           WHERE sample.connection_type='turn' AND (
             sample.canonical_reporter OR NOT EXISTS (
               SELECT 1 FROM telemetry_connection_samples canonical
               WHERE canonical.logical_connection_key=sample.logical_connection_key
                 AND canonical.canonical_reporter
                 AND canonical.observed_at BETWEEN sample.observed_at-interval '15 seconds'
                                               AND sample.observed_at+interval '15 seconds'
             )
           )
         )
         SELECT COALESCE(sum(turn_bytes_delta) FILTER(WHERE observed_at>=date_trunc('day',now())),0) today,
                COALESCE(sum(turn_bytes_delta) FILTER(WHERE observed_at>=now()-interval '7 days'),0) seven_days,
                COALESCE(sum(turn_bytes_delta) FILTER(WHERE observed_at>=date_trunc('month',now())),0) month_bytes,
                COALESCE(sum(turn_bytes_sent_delta) FILTER(WHERE observed_at>=date_trunc('month',now())),0) month_upload,
                COALESCE(sum(turn_bytes_received_delta) FILTER(WHERE observed_at>=date_trunc('month',now())),0) month_download
         FROM selected`,
      ),
      db.query<{
        active_chats: string;
        messages_today: string;
        messages_per_minute: string;
        peak_messages_per_minute: string;
        text_messages: string;
        image_messages: string;
        images_uploaded_today: string;
        images_bytes: string;
        average_image_bytes: string;
        expiring_hour: string;
        messages_stored: string;
        messages_expired_today: string;
        retention_changes_today: string;
      }>(
        `SELECT count(DISTINCT chat_id) FILTER(WHERE created_at>now()-interval '10 minutes') active_chats,
                count(*) FILTER(WHERE created_at>=date_trunc('day',now())) messages_today,
                count(*) FILTER(WHERE created_at>=now()-interval '1 minute') messages_per_minute,
                COALESCE((SELECT max(total) FROM (
                  SELECT count(*) total FROM messages
                  WHERE created_at>=date_trunc('day',now()) GROUP BY date_trunc('minute',created_at)
                ) minute_counts),0) peak_messages_per_minute,
                count(*) FILTER(WHERE kind='text' AND created_at>=date_trunc('day',now())) text_messages,
                count(*) FILTER(WHERE kind='image' AND created_at>=date_trunc('day',now())) image_messages,
                (SELECT count(*) FROM message_images WHERE created_at>=date_trunc('day',now())) images_uploaded_today,
                COALESCE((SELECT sum(octet_length(data)+COALESCE(octet_length(thumbnail_data),0)) FROM message_images),0) images_bytes,
                COALESCE((SELECT avg(octet_length(data)+COALESCE(octet_length(thumbnail_data),0)) FROM message_images),0) average_image_bytes,
                count(*) FILTER(WHERE expires_at BETWEEN now() AND now()+interval '1 hour') expiring_hour,
                count(*) messages_stored,
                COALESCE((SELECT messages_expired FROM analytics_daily_metrics WHERE metric_day=current_date),0) messages_expired_today,
                COALESCE((SELECT retention_changes FROM analytics_daily_metrics WHERE metric_day=current_date),0) retention_changes_today
         FROM messages`,
      ),
      db.query<{
        source: string;
        active: string;
        average_fps: string;
        average_bitrate: string;
        average_width: string;
        average_height: string;
        packet_loss: string;
        limited_none: string;
        limited_bandwidth: string;
        limited_cpu: string;
        limited_other: string;
        resolution_1080p: string;
        resolution_720p: string;
        resolution_below_720p: string;
        mode_text: string;
        mode_video: string;
        mode_auto: string;
      }>(
        `WITH latest_reporter AS (
           SELECT DISTINCT ON(reporter_client_id,peer_client_id) * FROM telemetry_connection_samples
           WHERE observed_at>now()-interval '25 seconds'
           ORDER BY reporter_client_id,peer_client_id,observed_at DESC
         ), media AS (
           SELECT reporter_client_id,item FROM latest_reporter CROSS JOIN LATERAL jsonb_array_elements(media) item
           WHERE item->>'direction'='outbound'
         ) SELECT item->>'source' source,count(DISTINCT reporter_client_id) active,
                  COALESCE(avg((item->>'framesPerSecond')::double precision),0) average_fps,
                  COALESCE(avg((item->>'bitrate')::double precision),0) average_bitrate,
                  COALESCE(avg((item->>'width')::double precision),0) average_width,
                  COALESCE(avg((item->>'height')::double precision),0) average_height,
                  COALESCE(avg((item->>'packetLossPercent')::double precision),0) packet_loss,
                  count(*) FILTER(WHERE item->>'qualityLimitationReason'='none') limited_none,
                  count(*) FILTER(WHERE item->>'qualityLimitationReason'='bandwidth') limited_bandwidth,
                  count(*) FILTER(WHERE item->>'qualityLimitationReason'='cpu') limited_cpu,
                  count(*) FILTER(WHERE item->>'qualityLimitationReason'='other') limited_other,
                  count(*) FILTER(WHERE (item->>'height')::int>=1080) resolution_1080p,
                  count(*) FILTER(WHERE (item->>'height')::int>=720 AND (item->>'height')::int<1080) resolution_720p,
                  count(*) FILTER(WHERE (item->>'height')::int<720) resolution_below_720p,
                  count(*) FILTER(WHERE item->>'mode'='text') mode_text,
                  count(*) FILTER(WHERE item->>'mode'='video') mode_video,
                  count(*) FILTER(WHERE item->>'mode'='auto') mode_auto
           FROM media GROUP BY item->>'source'`,
      ),
      db.query<{
        reconnects_5m: string;
        reconnects_today: string;
        ice_failures: string;
        ice_restarts: string;
      }>(
        `SELECT count(*) FILTER(WHERE event_type='signaling_reconnect' AND occurred_at>now()-interval '5 minutes') reconnects_5m,
                count(*) FILTER(WHERE event_type='signaling_reconnect' AND occurred_at>=date_trunc('day',now())) reconnects_today,
                count(*) FILTER(WHERE event_type='ice_failure' AND occurred_at>=date_trunc('day',now())) ice_failures,
                count(*) FILTER(WHERE event_type='ice_restart' AND occurred_at>=date_trunc('day',now())) ice_restarts
         FROM telemetry_events`,
      ),
      db.query('SELECT * FROM admin_settings WHERE id=1'),
      db.query(
        `SELECT observed_at,cpu_percent,ram_used_bytes,ram_total_bytes,disk_used_bytes,disk_total_bytes,
                network_rx_bytes,network_tx_bytes,load_1,uptime_seconds,process_rss_bytes,database_ok
         FROM infrastructure_samples WHERE observed_at>now()-interval '24 hours' ORDER BY observed_at`,
      ),
      db.query(
        `WITH reporters AS (
           SELECT observed_minute observed_at,
                  count(DISTINCT reporter_client_id) reporting_users
           FROM telemetry_report_minutes WHERE observed_minute>now()-interval '24 hours' GROUP BY 1
         ), connections AS (
           SELECT date_trunc('minute',observed_at) observed_at,
                  count(DISTINCT logical_connection_key) FILTER(WHERE canonical_reporter AND connection_type='direct') direct,
                  count(DISTINCT logical_connection_key) FILTER(WHERE canonical_reporter AND connection_type='turn') turn,
                  sum(turn_bytes_delta) FILTER(WHERE canonical_reporter AND connection_type='turn') turn_bytes
           FROM telemetry_connection_samples WHERE observed_at>now()-interval '24 hours' GROUP BY 1
         ), moments AS (
           SELECT observed_at FROM reporters UNION SELECT observed_at FROM connections
         )
         SELECT moments.observed_at,COALESCE(reporting_users,0) reporting_users,
                COALESCE(direct,0) direct,COALESCE(turn,0) turn,COALESCE(turn_bytes,0) turn_bytes
         FROM moments LEFT JOIN reporters USING(observed_at) LEFT JOIN connections USING(observed_at)
         ORDER BY moments.observed_at`,
      ),
      db.query<{
        requests_per_minute: string;
        error_percent: string;
        average_latency_ms: string;
        p50_latency_ms: string;
        p95_latency_ms: string;
      }>(
        `SELECT COALESCE(sum(request_count)/5.0,0) requests_per_minute,
                CASE WHEN sum(request_count)>0 THEN sum(error_count)*100.0/sum(request_count) ELSE 0 END error_percent,
                CASE WHEN sum(request_count)>0 THEN sum(average_latency_ms*request_count)/sum(request_count) ELSE 0 END average_latency_ms,
                COALESCE(max(p50_latency_ms),0) p50_latency_ms,
                COALESCE(max(p95_latency_ms),0) p95_latency_ms
         FROM api_metric_minutes WHERE observed_minute>=date_trunc('minute',now())-interval '5 minutes'`,
      ),
      db.query<{
        database_size_bytes: string;
        active_connections: string;
        users_rows: string;
        chats_rows: string;
        messages_rows: string;
        call_sessions_rows: string;
      }>(
        `SELECT pg_database_size(current_database()) database_size_bytes,
                (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()) active_connections,
                (SELECT count(*) FROM users WHERE deleted_at IS NULL) users_rows,
                (SELECT count(*) FROM chats) chats_rows,
                (SELECT count(*) FROM messages) messages_rows,
                (SELECT count(*) FROM call_sessions) call_sessions_rows`,
      ),
      db.query<{ client_version: string; clients: string }>(
        `SELECT client_version,count(*) clients FROM telemetry_reporters
         WHERE observed_at>now()-interval '25 seconds'
         GROUP BY client_version ORDER BY count(*) DESC`,
      ),
      db.query<{ platform: string; clients: string }>(
        `SELECT platform,count(*) clients FROM telemetry_reporters
         WHERE observed_at>now()-interval '25 seconds'
         GROUP BY platform ORDER BY count(*) DESC`,
      ),
    ]);
    const liveInfrastructure = await sampleInfrastructure().catch(() => null);
    const connectionRow = connections.rows[0];
    const connectionTotal = Number(connectionRow?.total ?? 0);
    const connectionCount = (type: 'direct' | 'turn' | 'unknown') =>
      Number(connectionRow?.[type] ?? 0);
    const monthBytes = Number(turn.rows[0]?.month_bytes ?? 0);
    const monthGb = monthBytes / 1_000_000_000;
    const day = new Date().getUTCDate();
    const daysInMonth = new Date(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth() + 1,
      0,
    ).getUTCDate();
    const forecastGb = day > 0 ? (monthGb / day) * daysInMonth : monthGb;
    const settings = settingsResult.rows[0] as Record<string, unknown>;
    const allowanceGb = Number(settings.turn_allowance_gb ?? 1000);
    const latestInfra = infrastructureHistory.rows.at(-1) as Record<string, unknown> | undefined;
    const alerts: Array<{ severity: 'warning' | 'critical'; code: string; message: string }> = [];
    const ramPercent = latestInfra?.ram_total_bytes
      ? (Number(latestInfra.ram_used_bytes) / Number(latestInfra.ram_total_bytes)) * 100
      : 0;
    const diskPercent = latestInfra?.disk_total_bytes
      ? (Number(latestInfra.disk_used_bytes) / Number(latestInfra.disk_total_bytes)) * 100
      : 0;
    const cpuPercent = Number(latestInfra?.cpu_percent ?? 0);
    const reportingClients = clientVersions.rows.reduce((sum, row) => sum + Number(row.clients), 0);
    if (cpuPercent >= Number(settings.cpu_critical_percent))
      alerts.push({
        severity: 'critical',
        code: 'VPS_CPU',
        message: `CPU ${cpuPercent.toFixed(0)}%`,
      });
    else if (cpuPercent >= Number(settings.cpu_warning_percent))
      alerts.push({
        severity: 'warning',
        code: 'VPS_CPU',
        message: `CPU ${cpuPercent.toFixed(0)}%`,
      });
    if (ramPercent >= Number(settings.ram_critical_percent))
      alerts.push({
        severity: 'critical',
        code: 'VPS_RAM',
        message: `RAM ${ramPercent.toFixed(0)}%`,
      });
    else if (ramPercent >= Number(settings.ram_warning_percent))
      alerts.push({
        severity: 'warning',
        code: 'VPS_RAM',
        message: `RAM ${ramPercent.toFixed(0)}%`,
      });
    if (diskPercent >= Number(settings.disk_critical_percent))
      alerts.push({
        severity: 'critical',
        code: 'VPS_DISK',
        message: `Disk ${diskPercent.toFixed(0)}%`,
      });
    else if (diskPercent >= Number(settings.disk_warning_percent))
      alerts.push({
        severity: 'warning',
        code: 'VPS_DISK',
        message: `Disk ${diskPercent.toFixed(0)}%`,
      });
    if (forecastGb >= allowanceGb * 0.95)
      alerts.push({
        severity: 'critical',
        code: 'TURN_FORECAST',
        message: `TURN forecast ${forecastGb.toFixed(0)} GB`,
      });
    else if (forecastGb >= allowanceGb * 0.8)
      alerts.push({
        severity: 'warning',
        code: 'TURN_FORECAST',
        message: `TURN forecast ${forecastGb.toFixed(0)} GB`,
      });
    await transaction(async (client) => {
      for (const alert of alerts)
        await client.query(
          `INSERT INTO analytics_alert_history(code,severity,message)
           VALUES($1,$2,$3)
           ON CONFLICT(code) WHERE resolved_at IS NULL DO UPDATE SET
             severity=EXCLUDED.severity,message=EXCLUDED.message,last_seen_at=now()`,
          [alert.code, alert.severity, alert.message],
        );
      await client.query(
        `UPDATE analytics_alert_history SET resolved_at=now()
         WHERE resolved_at IS NULL AND NOT(code=ANY($1::varchar[]))`,
        [alerts.map((alert) => alert.code)],
      );
    });
    const alertHistory = await db.query(
      `SELECT code,severity,message,started_at,last_seen_at,resolved_at,
              EXTRACT(epoch FROM (COALESCE(resolved_at,now())-started_at))::int duration_seconds
       FROM analytics_alert_history ORDER BY started_at DESC LIMIT 50`,
    );
    return {
      generatedAt: new Date().toISOString(),
      freshnessSeconds: 10,
      online: {
        total: Number(online.rows[0]?.total ?? 0),
        registered: Number(online.rows[0]?.registered ?? 0),
        guests: Number(online.rows[0]?.guests ?? 0),
      },
      rooms: {
        ...rooms.rows[0],
        active_rooms: Number(rooms.rows[0]?.active_rooms ?? 0),
        active_calls: Number(rooms.rows[0]?.active_calls ?? 0),
      },
      users: users.rows[0],
      network: {
        total: connectionTotal,
        direct: connectionCount('direct'),
        turn: connectionCount('turn'),
        unknown: connectionCount('unknown'),
        udp: Number(connectionRow?.udp ?? 0),
        tcp: Number(connectionRow?.tcp ?? 0),
        tls: Number(connectionRow?.tls ?? 0),
        disconnected: Number(connectionRow?.disconnected ?? 0),
        failed: Number(connectionRow?.failed ?? 0),
        directPercent: connectionTotal ? (connectionCount('direct') / connectionTotal) * 100 : 0,
        turnPercent: connectionTotal ? (connectionCount('turn') / connectionTotal) * 100 : 0,
        averageRttMs: Number(connectionRow?.average_rtt_ms ?? 0),
        p50RttMs: Number(connectionRow?.p50_rtt_ms ?? 0),
        p95RttMs: Number(connectionRow?.p95_rtt_ms ?? 0),
      },
      turn: {
        estimated: true,
        todayBytes: Number(turn.rows[0]?.today ?? 0),
        sevenDayBytes: Number(turn.rows[0]?.seven_days ?? 0),
        monthBytes,
        monthUploadBytes: Number(turn.rows[0]?.month_upload ?? 0),
        monthDownloadBytes: Number(turn.rows[0]?.month_download ?? 0),
        allowanceGb,
        remainingGb: Math.max(0, allowanceGb - monthGb),
        averagePerDayGb: day ? monthGb / day : 0,
        forecastGb,
        status: statusForForecast(forecastGb, allowanceGb),
      },
      chat: chat.rows[0],
      quality: quality.rows,
      signaling: signaling.rows[0],
      health: {
        signaling: reportingClients === 0 ? 'unavailable' : 'healthy',
        api: 'healthy',
        database: liveInfrastructure?.databaseOk ? 'healthy' : 'unavailable',
      },
      infrastructure: { current: liveInfrastructure, history: infrastructureHistory.rows },
      api: apiMetrics.rows[0],
      database: {
        ...databaseMetrics.rows[0],
        poolTotal: db.totalCount,
        poolIdle: db.idleCount,
        poolWaiting: db.waitingCount,
        poolMaximum: 12,
      },
      clients: { versions: clientVersions.rows, platforms: clientPlatforms.rows },
      trends: networkHistory.rows,
      settings: {
        refreshIntervalSeconds: Number(settings.refresh_interval_seconds ?? 10),
        timezone: String(settings.timezone ?? 'Europe/Moscow'),
      },
      alerts,
      alertHistory: alertHistory.rows,
      infrastructureStatus: alerts.some((alert) => alert.severity === 'critical')
        ? 'critical'
        : alerts.length
          ? 'warning'
          : 'healthy',
    };
  });

  app.patch('/v1/admin/settings', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const input = z
      .object({
        refreshIntervalSeconds: z.number().int().min(5).max(60).optional(),
        timezone: z.string().min(1).max(64).optional(),
        turnAllowanceGb: z.number().int().min(1).max(100000).optional(),
      })
      .parse(request.body);
    const result = await db.query(
      `UPDATE admin_settings SET refresh_interval_seconds=COALESCE($1,refresh_interval_seconds),
       timezone=COALESCE($2,timezone),turn_allowance_gb=COALESCE($3,turn_allowance_gb),updated_at=now()
       WHERE id=1 RETURNING *`,
      [input.refreshIntervalSeconds ?? null, input.timezone ?? null, input.turnAllowanceGb ?? null],
    );
    return { settings: result.rows[0] };
  });

  app.get('/v1/admin/export', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { format } = z
      .object({ format: z.enum(['json', 'csv']).default('json') })
      .parse(request.query);
    const rows = await db.query(
      `SELECT date_trunc('day',observed_at)::date day,
              count(DISTINCT reporter_client_id) reporting_users,
              count(DISTINCT logical_connection_key) FILTER(WHERE canonical_reporter AND connection_type='direct') direct,
              count(DISTINCT logical_connection_key) FILTER(WHERE canonical_reporter AND connection_type='turn') turn,
              COALESCE(sum(turn_bytes_delta) FILTER(WHERE canonical_reporter AND connection_type='turn'),0) turn_bytes
       FROM telemetry_connection_samples GROUP BY 1 ORDER BY 1 DESC LIMIT 90`,
    );
    if (format === 'json') return { generatedAt: new Date().toISOString(), rows: rows.rows };
    const csv = [
      'day,reporting_users,direct,turn,turn_bytes',
      ...rows.rows.map((row) =>
        [row.day, row.reporting_users, row.direct, row.turn, row.turn_bytes].join(','),
      ),
    ].join('\n');
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="freetalk-admin-summary.csv"')
      .send(csv);
  });
}

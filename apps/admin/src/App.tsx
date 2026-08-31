import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Download,
  Gauge,
  LogOut,
  MessageSquare,
  Network,
  RefreshCw,
  Server,
  ShieldCheck,
  Users,
  Video,
  Wifi,
} from 'lucide-react';
import { adminApi, type AdminUser } from './api';

type Page =
  'overview' | 'users' | 'calls' | 'network' | 'quality' | 'chat' | 'infrastructure' | 'errors';

interface OverviewData {
  generatedAt: string;
  freshnessSeconds: number;
  online: { total: number; registered: number; guests: number };
  rooms: Record<string, string | number> & { active_rooms: number; active_calls: number };
  users: Record<string, string>;
  network: {
    total: number;
    direct: number;
    turn: number;
    unknown: number;
    udp: number;
    tcp: number;
    tls: number;
    disconnected: number;
    failed: number;
    directPercent: number;
    turnPercent: number;
    averageRttMs: number;
    p50RttMs: number;
    p95RttMs: number;
  };
  turn: {
    estimated: boolean;
    todayBytes: number;
    sevenDayBytes: number;
    monthBytes: number;
    monthUploadBytes: number;
    monthDownloadBytes: number;
    allowanceGb: number;
    remainingGb: number;
    averagePerDayGb: number;
    forecastGb: number;
    status: string;
  };
  chat: Record<string, string>;
  quality: Array<Record<string, string>>;
  signaling: Record<string, string>;
  health: { signaling: string; api: string; database: string };
  infrastructure: {
    current: Record<string, number | boolean | string> | null;
    history: Array<Record<string, number | boolean | string>>;
  };
  api: Record<string, string>;
  database: Record<string, string | number>;
  clients: {
    versions: Array<{ client_version: string; clients: string }>;
    platforms: Array<{ platform: string; clients: string }>;
  };
  trends: Array<Record<string, number | string>>;
  alerts: Array<{ severity: 'warning' | 'critical'; code: string; message: string }>;
  alertHistory: Array<{
    code: string;
    severity: 'warning' | 'critical';
    message: string;
    started_at: string;
    resolved_at: string | null;
    duration_seconds: number;
  }>;
  infrastructureStatus: string;
  settings: { refreshIntervalSeconds: number; timezone: string };
}

const navigation: Array<{ id: Page; label: string; icon: typeof Activity }> = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'calls', label: 'Calls', icon: Video },
  { id: 'network', label: 'Network', icon: Network },
  { id: 'quality', label: 'Quality', icon: Gauge },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'infrastructure', label: 'Infrastructure', icon: Server },
  { id: 'errors', label: 'Errors', icon: AlertTriangle },
];

const number = (value: unknown) => Number(value ?? 0);
const compact = (value: unknown) =>
  new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(
    number(value),
  );
const percent = (value: unknown) => `${number(value).toFixed(1)}%`;
const bytes = (value: unknown) => {
  const amount = number(value);
  if (!amount) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(amount) / Math.log(1000)));
  return `${(amount / 1000 ** index).toFixed(index > 2 ? 1 : 0)} ${units[index]}`;
};

function Login({ onAuthenticated }: { onAuthenticated(user: AdminUser): void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      onAuthenticated(await adminApi.login(login, password));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось войти');
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="admin-login">
      <form onSubmit={submit}>
        <div className="admin-mark">
          <ShieldCheck />
          <span>FreeTalk</span>
          <b>Admin</b>
        </div>
        <h1>Внутренняя аналитика</h1>
        <p>Доступ разрешён только аккаунтам с серверной ролью admin.</p>
        <label>
          Логин
          <input
            autoFocus
            autoComplete="username"
            value={login}
            onChange={(event) => setLogin(event.target.value)}
          />
        </label>
        <label>
          Пароль
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && (
          <div className="login-error" role="alert">
            {error}
          </div>
        )}
        <button disabled={busy || !login || !password}>{busy ? 'Проверяем…' : 'Войти'}</button>
      </form>
    </main>
  );
}

function Metric({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  detail?: string;
  tone?: 'default' | 'cyan' | 'warning';
}) {
  return (
    <article className={`metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </article>
  );
}

function TrendChart({
  title,
  rows,
  fields,
}: {
  title: string;
  rows: Array<Record<string, number | string | boolean>>;
  fields: Array<{ key: string; label: string; color: string }>;
}) {
  const points = rows.slice(-60);
  const maximum = Math.max(
    1,
    ...points.flatMap((row) => fields.map((field) => number(row[field.key]))),
  );
  const path = (key: string) =>
    points
      .map(
        (row, index) =>
          `${index ? 'L' : 'M'} ${(index / Math.max(1, points.length - 1)) * 100} ${94 - (number(row[key]) / maximum) * 82}`,
      )
      .join(' ');
  return (
    <article className="chart-card">
      <header>
        <div>
          <span>Live trend</span>
          <h3>{title}</h3>
        </div>
        <div className="chart-legend">
          {fields.map((field) => (
            <span key={field.key}>
              <i style={{ background: field.color }} />
              {field.label}
            </span>
          ))}
        </div>
      </header>
      {points.length ? (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label={title}>
          {[25, 50, 75].map((y) => (
            <line key={y} x1="0" y1={y} x2="100" y2={y} />
          ))}
          {fields.map((field) => (
            <path key={field.key} d={path(field.key)} style={{ stroke: field.color }} />
          ))}
        </svg>
      ) : (
        <Empty />
      )}
    </article>
  );
}

function Empty() {
  return <div className="empty-state">Нет подтверждённых данных за выбранный период</div>;
}

function Overview({ data }: { data: OverviewData }) {
  const infra = data.infrastructure.current;
  const ramPercent = infra?.ramTotalBytes
    ? (number(infra.ramUsedBytes) / number(infra.ramTotalBytes)) * 100
    : 0;
  const reportingPeak = Math.max(0, ...data.trends.map((row) => number(row.reporting_users)));
  const cpuPeak = Math.max(0, ...data.infrastructure.history.map((row) => number(row.cpu_percent)));
  const ramPeak = Math.max(
    0,
    ...data.infrastructure.history.map((row) =>
      number(row.ram_total_bytes)
        ? (number(row.ram_used_bytes) / number(row.ram_total_bytes)) * 100
        : 0,
    ),
  );
  return (
    <>
      <section className="metric-grid primary">
        <Metric
          label="Online now"
          value={data.online.total}
          detail={`${data.online.registered} registered · ${data.online.guests} guests`}
          tone="cyan"
        />
        <Metric
          label="Active rooms"
          value={data.rooms.active_rooms}
          detail={`${compact(data.rooms.rooms_today)} created today`}
        />
        <Metric
          label="Active calls"
          value={data.rooms.active_calls}
          detail={`avg ${number(data.rooms.average_room_size).toFixed(1)} users`}
        />
        <Metric
          label="Active chats"
          value={compact(data.chat.active_chats)}
          detail={`${compact(data.chat.messages_today)} messages today`}
        />
        <Metric
          label="Direct P2P"
          value={data.network.total ? percent(data.network.directPercent) : 'N/A'}
          detail={`${data.network.direct} logical connections`}
          tone="cyan"
        />
        <Metric
          label="TURN"
          value={data.network.total ? percent(data.network.turnPercent) : 'N/A'}
          detail={`${data.network.turn} logical connections`}
          tone={data.network.turnPercent > 20 ? 'warning' : 'default'}
        />
        <Metric
          label="TURN this month"
          value={bytes(data.turn.monthBytes)}
          detail={`of ${data.turn.allowanceGb} GB · estimated`}
        />
        <Metric
          label="VPS CPU"
          value={infra?.cpuPercent == null ? '—' : percent(infra.cpuPercent)}
          detail="60-second sample"
        />
        <Metric
          label="VPS RAM"
          value={infra ? percent(ramPercent) : '—'}
          detail={
            infra ? `${bytes(infra.ramUsedBytes)} / ${bytes(infra.ramTotalBytes)}` : 'Unavailable'
          }
        />
      </section>
      <section className="health-row">
        {Object.entries(data.health).map(([name, status]) => (
          <article key={name} data-status={status}>
            <span>{name}</span>
            <strong>
              <i />
              {status}
            </strong>
          </article>
        ))}
      </section>
      <section className="chart-grid">
        <TrendChart
          title="Reporting users and connection paths"
          rows={data.trends}
          fields={[
            { key: 'reporting_users', label: 'Users', color: '#43e5e4' },
            { key: 'direct', label: 'Direct', color: '#6edbb9' },
            { key: 'turn', label: 'TURN', color: '#ffb45d' },
          ]}
        />
        <article className="forecast-card">
          <header>
            <span>Estimated TURN forecast</span>
            <b data-status={data.turn.status}>{data.turn.status}</b>
          </header>
          <strong>{data.turn.forecastGb.toFixed(0)} GB</strong>
          <div className="progress">
            <i
              style={{
                width: `${Math.min(100, (data.turn.forecastGb / data.turn.allowanceGb) * 100)}%`,
              }}
            />
          </div>
          <dl>
            <div>
              <dt>Upload</dt>
              <dd>{bytes(data.turn.monthUploadBytes)}</dd>
            </div>
            <div>
              <dt>Download</dt>
              <dd>{bytes(data.turn.monthDownloadBytes)}</dd>
            </div>
            <div>
              <dt>Used</dt>
              <dd>{(data.turn.monthBytes / 1e9).toFixed(1)} GB</dd>
            </div>
            <div>
              <dt>Average/day</dt>
              <dd>{data.turn.averagePerDayGb.toFixed(1)} GB</dd>
            </div>
            <div>
              <dt>Remaining</dt>
              <dd>{data.turn.remainingGb.toFixed(1)} GB</dd>
            </div>
          </dl>
          <small>ESTIMATED from selected relay connection byte deltas</small>
        </article>
      </section>
      <section className="bottom-grid">
        <article className="status-card">
          <header>
            <span>Infrastructure status</span>
            <b data-status={data.infrastructureStatus}>{data.infrastructureStatus}</b>
          </header>
          <Server />
          <div>
            <strong>
              {data.infrastructureStatus === 'healthy'
                ? 'Current infrastructure is within configured thresholds.'
                : `${data.alerts[0]?.code.replaceAll('_', ' ')}: ${data.alerts[0]?.message}`}
            </strong>
            <small>No automatic scaling or purchasing actions are performed.</small>
          </div>
        </article>
        <article className="alerts-card">
          <header>
            <span>Current alerts</span>
            <b>{data.alerts.length}</b>
          </header>
          {data.alerts.length ? (
            data.alerts.map((alert) => (
              <div key={alert.code} data-severity={alert.severity}>
                <AlertTriangle />
                <span>
                  <strong>{alert.code.replaceAll('_', ' ')}</strong>
                  <small>{alert.message}</small>
                </span>
              </div>
            ))
          ) : (
            <div className="all-clear">
              <ShieldCheck />
              No active threshold alerts
            </div>
          )}
        </article>
      </section>
      <section className="daily-summary">
        <header>
          <span>Daily summary</span>
          <small>Technical data only</small>
        </header>
        <div className="metric-grid">
          <Metric label="Peak reporting clients" value={reportingPeak} />
          <Metric label="Rooms created" value={compact(data.rooms.rooms_today)} />
          <Metric label="Calls" value={compact(data.rooms.calls_today)} />
          <Metric label="Messages" value={compact(data.chat.messages_today)} />
          <Metric label="Images" value={compact(data.chat.images_uploaded_today)} />
          <Metric
            label="Direct"
            value={data.network.total ? percent(data.network.directPercent) : 'N/A'}
          />
          <Metric label="TURN estimated" value={bytes(data.turn.todayBytes)} />
          <Metric label="Reconnects" value={compact(data.signaling.reconnects_today)} />
          <Metric label="ICE failures" value={compact(data.signaling.ice_failures)} />
          <Metric label="VPS CPU peak" value={percent(cpuPeak)} />
          <Metric label="VPS RAM peak" value={percent(ramPeak)} />
        </div>
      </section>
    </>
  );
}

function DetailPage({ page, data }: { page: Exclude<Page, 'overview'>; data: OverviewData }) {
  if (page === 'users')
    return (
      <>
        <section className="metric-grid">
          <Metric label="Online now" value={data.online.total} />
          <Metric label="Registered online" value={data.online.registered} />
          <Metric label="FreeUsers online" value={data.online.guests} />
          <Metric label="Total registered" value={compact(data.users.total)} />
          <Metric label="Registrations today" value={compact(data.users.today)} />
          <Metric label="Registrations 7d" value={compact(data.users.seven_days)} />
          <Metric label="Daily active users" value={compact(data.users.daily_active_users)} />
          <Metric label="Weekly active users" value={compact(data.users.weekly_active_users)} />
          <Metric label="Active sessions" value={compact(data.users.active_sessions)} />
          <Metric label="Guest sessions today" value={compact(data.users.guest_sessions_today)} />
          <Metric
            label="Unique anonymous guests"
            value={compact(data.users.unique_anonymous_guests)}
          />
          <Metric
            label="Average guest session"
            value={`${Math.round(number(data.users.average_guest_session_seconds) / 60)} min`}
          />
        </section>
        <TrendChart
          title="Clients reporting telemetry"
          rows={data.trends}
          fields={[{ key: 'reporting_users', label: 'Reporting users', color: '#43e5e4' }]}
        />
        <section className="metric-grid">
          {data.clients.versions.map((row) => (
            <Metric
              key={row.client_version}
              label={`Version ${row.client_version}`}
              value={row.clients}
            />
          ))}
          {data.clients.platforms.map((row) => (
            <Metric key={row.platform} label={`Platform ${row.platform}`} value={row.clients} />
          ))}
        </section>
      </>
    );
  if (page === 'calls')
    return (
      <>
        <section className="metric-grid">
          <Metric label="Active rooms" value={data.rooms.active_rooms} />
          <Metric label="Calls today" value={compact(data.rooms.calls_today)} />
          <Metric
            label="Average room size"
            value={number(data.rooms.average_room_size).toFixed(1)}
          />
          <Metric
            label="Average call duration"
            value={`${Math.round(number(data.rooms.average_duration_seconds) / 60)} min`}
          />
          <Metric
            label="Active cameras"
            value={data.quality.find((row) => row.source === 'camera')?.active ?? 0}
          />
          <Metric
            label="Active screen shares"
            value={data.quality.find((row) => row.source === 'screen')?.active ?? 0}
          />
        </section>
      </>
    );
  if (page === 'network')
    return (
      <>
        <section className="metric-grid">
          <Metric label="Active WebRTC connections" value={data.network.total} />
          <Metric
            label="Direct"
            value={`${data.network.direct} · ${data.network.total ? percent(data.network.directPercent) : 'N/A'}`}
            tone="cyan"
          />
          <Metric
            label="TURN"
            value={`${data.network.turn} · ${data.network.total ? percent(data.network.turnPercent) : 'N/A'}`}
          />
          <Metric label="Unknown" value={data.network.unknown} />
          <Metric label="UDP" value={data.network.udp} />
          <Metric label="TCP" value={data.network.tcp} />
          <Metric label="TLS" value={data.network.tls} />
          <Metric label="Disconnected" value={data.network.disconnected} />
          <Metric label="Failed" value={data.network.failed} />
          <Metric
            label="Average RTT"
            value={data.network.total ? `${data.network.averageRttMs.toFixed(0)} ms` : 'N/A'}
          />
          <Metric
            label="P95 RTT"
            value={data.network.total ? `${data.network.p95RttMs.toFixed(0)} ms` : 'N/A'}
          />
        </section>
        <TrendChart
          title="Direct vs TURN over time"
          rows={data.trends}
          fields={[
            { key: 'direct', label: 'Direct', color: '#6edbb9' },
            { key: 'turn', label: 'TURN', color: '#ffb45d' },
          ]}
        />
      </>
    );
  if (page === 'quality')
    return (
      <>
        <section className="metric-grid">
          {['camera', 'screen'].map((source) => {
            const row = data.quality.find((item) => item.source === source);
            return (
              <Metric
                key={source}
                label={`Active ${source}`}
                value={row?.active ?? 0}
                detail={
                  row
                    ? `${number(row.average_width).toFixed(0)}×${number(row.average_height).toFixed(0)} · ${number(row.average_fps).toFixed(1)} FPS · ${bytes(number(row.average_bitrate) / 8)}/s · ${percent(row.packet_loss)} loss`
                    : 'No live samples'
                }
              />
            );
          })}
          <Metric label="ICE failures today" value={compact(data.signaling.ice_failures)} />
          <Metric label="ICE restarts today" value={compact(data.signaling.ice_restarts)} />
          <Metric
            label="Bandwidth limited"
            value={compact(
              data.quality.reduce((sum, row) => sum + number(row.limited_bandwidth), 0),
            )}
          />
          <Metric
            label="CPU limited"
            value={compact(data.quality.reduce((sum, row) => sum + number(row.limited_cpu), 0))}
          />
          <Metric
            label="1080p samples"
            value={compact(
              data.quality.reduce((sum, row) => sum + number(row.resolution_1080p), 0),
            )}
          />
          <Metric
            label="720p samples"
            value={compact(data.quality.reduce((sum, row) => sum + number(row.resolution_720p), 0))}
          />
          <Metric
            label="Screen TEXT mode"
            value={compact(data.quality.find((row) => row.source === 'screen')?.mode_text)}
          />
          <Metric
            label="Screen VIDEO mode"
            value={compact(data.quality.find((row) => row.source === 'screen')?.mode_video)}
          />
        </section>
      </>
    );
  if (page === 'chat')
    return (
      <>
        <section className="metric-grid">
          <Metric label="Active chats" value={compact(data.chat.active_chats)} />
          <Metric label="Messages today" value={compact(data.chat.messages_today)} />
          <Metric label="Messages / minute" value={compact(data.chat.messages_per_minute)} />
          <Metric
            label="Peak messages / minute"
            value={compact(data.chat.peak_messages_per_minute)}
          />
          <Metric label="Text messages today" value={compact(data.chat.text_messages)} />
          <Metric label="Image messages today" value={compact(data.chat.image_messages)} />
          <Metric label="Images uploaded today" value={compact(data.chat.images_uploaded_today)} />
          <Metric label="Image storage" value={bytes(data.chat.images_bytes)} />
          <Metric label="Average image size" value={bytes(data.chat.average_image_bytes)} />
          <Metric label="Messages stored" value={compact(data.chat.messages_stored)} />
          <Metric label="Expiring next hour" value={compact(data.chat.expiring_hour)} />
          <Metric label="Expired today" value={compact(data.chat.messages_expired_today)} />
          <Metric label="Retention changes" value={compact(data.chat.retention_changes_today)} />
        </section>
      </>
    );
  if (page === 'infrastructure')
    return (
      <>
        <section className="metric-grid">
          <Metric
            label="CPU"
            value={
              data.infrastructure.current?.cpuPercent == null
                ? '—'
                : percent(data.infrastructure.current.cpuPercent)
            }
          />
          <Metric label="RAM used" value={bytes(data.infrastructure.current?.ramUsedBytes)} />
          <Metric
            label="Disk used"
            value={
              data.infrastructure.current?.diskUsedBytes == null
                ? '—'
                : bytes(data.infrastructure.current.diskUsedBytes)
            }
          />
          <Metric
            label="Network RX"
            value={
              data.infrastructure.current?.networkRxBytes == null
                ? '—'
                : bytes(data.infrastructure.current.networkRxBytes)
            }
          />
          <Metric
            label="Network TX"
            value={
              data.infrastructure.current?.networkTxBytes == null
                ? '—'
                : bytes(data.infrastructure.current.networkTxBytes)
            }
          />
          <Metric
            label="Uptime"
            value={`${Math.floor(number(data.infrastructure.current?.uptimeSeconds) / 3600)} h`}
          />
          <Metric
            label="API requests / min"
            value={number(data.api.requests_per_minute).toFixed(1)}
          />
          <Metric label="API errors" value={percent(data.api.error_percent)} />
          <Metric label="API P50" value={`${number(data.api.p50_latency_ms).toFixed(1)} ms`} />
          <Metric label="API P95" value={`${number(data.api.p95_latency_ms).toFixed(1)} ms`} />
          <Metric label="Database size" value={bytes(data.database.database_size_bytes)} />
          <Metric label="DB connections" value={compact(data.database.active_connections)} />
          <Metric
            label="DB pool usage"
            value={`${compact(data.database.poolTotal)} / ${compact(data.database.poolMaximum)}`}
          />
          <Metric label="Users rows" value={compact(data.database.users_rows)} />
          <Metric label="Chats rows" value={compact(data.database.chats_rows)} />
          <Metric label="Messages rows" value={compact(data.database.messages_rows)} />
          <Metric label="Call session rows" value={compact(data.database.call_sessions_rows)} />
        </section>
        <TrendChart
          title="VPS CPU and RAM history"
          rows={data.infrastructure.history}
          fields={[{ key: 'cpu_percent', label: 'CPU %', color: '#43e5e4' }]}
        />
      </>
    );
  return (
    <>
      <section className="metric-grid">
        <Metric label="Reconnects 5 min" value={compact(data.signaling.reconnects_5m)} />
        <Metric label="Reconnects today" value={compact(data.signaling.reconnects_today)} />
        <Metric label="ICE failures" value={compact(data.signaling.ice_failures)} />
        <Metric label="ICE restarts" value={compact(data.signaling.ice_restarts)} />
        <Metric label="Current alerts" value={data.alerts.length} />
      </section>
      {data.alertHistory.length ? (
        <div className="error-table">
          {data.alertHistory.map((alert, index) => (
            <div key={`${alert.code}-${alert.started_at}-${index}`}>
              <b>{alert.code}</b>
              <span>
                {alert.message} · {new Date(alert.started_at).toLocaleString('ru-RU')} ·{' '}
                {Math.max(1, Math.round(alert.duration_seconds / 60))} min
              </span>
              <i data-severity={alert.resolved_at ? 'resolved' : alert.severity}>
                {alert.resolved_at ? 'resolved' : alert.severity}
              </i>
            </div>
          ))}
        </div>
      ) : (
        <Empty />
      )}
    </>
  );
}

export function App() {
  const [user, setUser] = useState<AdminUser>();
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<Page>('overview');
  const [data, setData] = useState<OverviewData>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshSeconds, setRefreshSeconds] = useState(10);
  useEffect(() => {
    void adminApi.restore().then((value) => {
      if (value) setUser(value);
      setReady(true);
    });
  }, []);
  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const next = await adminApi.request<OverviewData>('/v1/admin/overview');
      setData(next);
      setRefreshSeconds(next.settings.refreshIntervalSeconds);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Admin API недоступен');
    } finally {
      setLoading(false);
    }
  }, [user]);
  useEffect(() => {
    if (!user) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), refreshSeconds * 1_000);
    return () => window.clearInterval(timer);
  }, [refresh, user, refreshSeconds]);
  const changeRefresh = async (seconds: number) => {
    setRefreshSeconds(seconds);
    await adminApi.request('/v1/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({ refreshIntervalSeconds: seconds }),
    });
  };
  const current = useMemo(() => navigation.find((item) => item.id === page)!, [page]);
  if (!ready)
    return (
      <main className="boot-screen">
        <Activity className="spin" />
        Подключение к Admin API…
      </main>
    );
  if (!user) return <Login onAuthenticated={setUser} />;
  return (
    <main className="admin-shell">
      <aside>
        <div className="brand">
          <div>
            <Wifi />
          </div>
          <span>
            FreeTalk<b>Admin</b>
          </span>
        </div>
        <nav>
          {navigation.map((item) => (
            <button
              key={item.id}
              className={page === item.id ? 'active' : ''}
              onClick={() => setPage(item.id)}
            >
              <item.icon />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="aside-bottom">
          <button onClick={() => void adminApi.logout().then(() => setUser(undefined))}>
            <LogOut />
            Logout
          </button>
          <small>v{__FREETALK_ADMIN_VERSION__}</small>
        </div>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div>
            <current.icon />
            <span>{current.label}</span>
          </div>
          <div className="top-actions">
            <span className="freshness">
              <i />
              {data
                ? `Updated ${new Date(data.generatedAt).toLocaleTimeString('ru-RU')}`
                : 'Waiting for data'}
            </span>
            <select
              aria-label="Refresh interval"
              value={refreshSeconds}
              onChange={(event) => void changeRefresh(Number(event.target.value))}
            >
              <option value={5}>5s</option>
              <option value={10}>10s</option>
            </select>
            <button onClick={() => void adminApi.downloadExport('csv')}>
              <Download />
              Export
            </button>
            <button
              aria-label="Refresh"
              onClick={() => void refresh()}
              className={loading ? 'spin-button' : ''}
            >
              <RefreshCw />
            </button>
            <div className="admin-user">
              <span>{user.displayName}</span>
              <small>@{user.username}</small>
            </div>
          </div>
        </header>
        <div className="page-content">
          {error && (
            <div className="api-error">
              <AlertTriangle />
              {error}
            </div>
          )}
          {data ? (
            page === 'overview' ? (
              <Overview data={data} />
            ) : (
              <DetailPage page={page} data={data} />
            )
          ) : (
            !error && (
              <div className="loading-grid">
                {Array.from({ length: 9 }, (_, index) => (
                  <i key={index} />
                ))}
              </div>
            )
          )}
        </div>
      </section>
    </main>
  );
}

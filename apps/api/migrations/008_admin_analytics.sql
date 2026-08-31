BEGIN;

ALTER TABLE users
  ADD COLUMN role varchar(16) NOT NULL DEFAULT 'user'
  CHECK (role IN ('user', 'admin'));

CREATE TABLE analytics_user_presence (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status varchar(16) NOT NULL CHECK (status IN ('online','away','dnd','offline')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE telemetry_connection_samples (
  id bigserial PRIMARY KEY,
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  event_version smallint NOT NULL CHECK (event_version = 1),
  client_version varchar(64) NOT NULL,
  platform varchar(32) NOT NULL,
  room_id varchar(32) NOT NULL,
  logical_connection_key varchar(128) NOT NULL,
  reporter_client_id uuid NOT NULL,
  peer_client_id uuid NOT NULL,
  canonical_reporter boolean NOT NULL,
  connection_type varchar(16) NOT NULL CHECK (connection_type IN ('direct','turn','unknown')),
  local_candidate_type varchar(16),
  remote_candidate_type varchar(16),
  protocol varchar(16),
  connection_state varchar(24) NOT NULL,
  ice_state varchar(24) NOT NULL,
  rtt_ms double precision,
  available_outgoing_bitrate bigint,
  available_incoming_bitrate bigint,
  bytes_sent bigint NOT NULL CHECK (bytes_sent >= 0),
  bytes_received bigint NOT NULL CHECK (bytes_received >= 0),
  turn_bytes_delta bigint NOT NULL DEFAULT 0 CHECK (turn_bytes_delta >= 0),
  turn_bytes_sent_delta bigint NOT NULL DEFAULT 0 CHECK (turn_bytes_sent_delta >= 0),
  turn_bytes_received_delta bigint NOT NULL DEFAULT 0 CHECK (turn_bytes_received_delta >= 0),
  media jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (logical_connection_key, reporter_client_id, observed_at)
);
CREATE INDEX telemetry_connection_active_idx
  ON telemetry_connection_samples(logical_connection_key, observed_at DESC);
CREATE INDEX telemetry_connection_time_idx
  ON telemetry_connection_samples(observed_at DESC);
CREATE INDEX telemetry_connection_turn_idx
  ON telemetry_connection_samples(observed_at DESC)
  WHERE canonical_reporter AND connection_type='turn';

CREATE TABLE telemetry_reporters (
  reporter_client_id uuid PRIMARY KEY,
  room_id varchar(32) NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  anonymous_user_id uuid,
  client_version varchar(64) NOT NULL,
  platform varchar(32) NOT NULL,
  observed_at timestamptz NOT NULL,
  CHECK (user_id IS NULL OR anonymous_user_id IS NULL)
);
CREATE INDEX telemetry_reporters_observed_idx ON telemetry_reporters(observed_at DESC);

CREATE TABLE telemetry_report_minutes (
  observed_minute timestamptz NOT NULL,
  reporter_client_id uuid NOT NULL,
  client_version varchar(64) NOT NULL,
  platform varchar(32) NOT NULL,
  PRIMARY KEY(observed_minute,reporter_client_id)
);
CREATE INDEX telemetry_report_minutes_time_idx ON telemetry_report_minutes(observed_minute DESC);

CREATE TABLE telemetry_events (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  event_type varchar(64) NOT NULL,
  client_version varchar(64) NOT NULL,
  platform varchar(32) NOT NULL,
  room_id varchar(32),
  participant_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (octet_length(details::text) <= 4096)
);
CREATE INDEX telemetry_events_type_time_idx ON telemetry_events(event_type, occurred_at DESC);

CREATE TABLE analytics_daily_metrics (
  metric_day date PRIMARY KEY,
  messages_expired bigint NOT NULL DEFAULT 0,
  image_messages_expired bigint NOT NULL DEFAULT 0,
  expired_image_bytes bigint NOT NULL DEFAULT 0,
  retention_changes bigint NOT NULL DEFAULT 0
);

CREATE TABLE infrastructure_samples (
  observed_at timestamptz PRIMARY KEY,
  cpu_percent double precision,
  ram_used_bytes bigint,
  ram_total_bytes bigint,
  disk_used_bytes bigint,
  disk_total_bytes bigint,
  network_rx_bytes bigint,
  network_tx_bytes bigint,
  load_1 double precision,
  uptime_seconds bigint,
  process_rss_bytes bigint NOT NULL,
  database_ok boolean NOT NULL,
  api_ok boolean NOT NULL DEFAULT true
);

CREATE TABLE api_metric_minutes (
  observed_minute timestamptz NOT NULL,
  route varchar(160) NOT NULL,
  request_count integer NOT NULL CHECK (request_count >= 0),
  error_count integer NOT NULL CHECK (error_count >= 0),
  average_latency_ms double precision NOT NULL CHECK (average_latency_ms >= 0),
  p50_latency_ms double precision NOT NULL CHECK (p50_latency_ms >= 0),
  p95_latency_ms double precision NOT NULL CHECK (p95_latency_ms >= 0),
  PRIMARY KEY(observed_minute,route)
);
CREATE INDEX api_metric_minutes_time_idx ON api_metric_minutes(observed_minute DESC);

CREATE TABLE analytics_alert_history (
  id bigserial PRIMARY KEY,
  code varchar(64) NOT NULL,
  severity varchar(16) NOT NULL CHECK (severity IN ('warning','critical')),
  message varchar(256) NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE UNIQUE INDEX analytics_alert_unresolved_idx ON analytics_alert_history(code)
  WHERE resolved_at IS NULL;

CREATE TABLE admin_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  refresh_interval_seconds integer NOT NULL DEFAULT 10 CHECK (refresh_interval_seconds BETWEEN 5 AND 60),
  timezone varchar(64) NOT NULL DEFAULT 'Europe/Moscow',
  turn_allowance_gb integer NOT NULL DEFAULT 1000 CHECK (turn_allowance_gb BETWEEN 1 AND 100000),
  cpu_warning_percent integer NOT NULL DEFAULT 70,
  cpu_critical_percent integer NOT NULL DEFAULT 90,
  ram_warning_percent integer NOT NULL DEFAULT 75,
  ram_critical_percent integer NOT NULL DEFAULT 90,
  disk_warning_percent integer NOT NULL DEFAULT 80,
  disk_critical_percent integer NOT NULL DEFAULT 95,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO admin_settings(id) VALUES(1) ON CONFLICT DO NOTHING;

COMMIT;

CREATE TABLE service_chat_state (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pending_kind text CHECK (pending_kind IN ('bug','idea')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE service_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author text NOT NULL CHECK (author IN ('bot','user')),
  kind text NOT NULL,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  event_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(user_id,event_key)
);
CREATE INDEX service_chat_history_idx ON service_chat_messages(user_id,created_at DESC,id DESC);

CREATE TABLE support_reports (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('bug','idea')),
  body text NOT NULL CHECK (length(body) BETWEEN 10 AND 4000),
  app_version text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','delivered','failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX support_reports_queue_idx ON support_reports(next_attempt_at)
  WHERE status IN ('pending','sending');
CREATE INDEX support_reports_user_time_idx ON support_reports(user_id,created_at DESC);
CREATE INDEX support_reports_time_idx ON support_reports(created_at);

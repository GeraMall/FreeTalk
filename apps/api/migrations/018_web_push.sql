CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  expiration_time bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS web_push_subscriptions_session_idx
  ON web_push_subscriptions(session_id);

CREATE TABLE IF NOT EXISTS web_push_deliveries (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES web_push_subscriptions(id) ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(message_id, subscription_id)
);

CREATE INDEX IF NOT EXISTS web_push_deliveries_available_idx
  ON web_push_deliveries(available_at);

CREATE OR REPLACE FUNCTION enqueue_web_push() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind IN ('text','image','file') THEN
    INSERT INTO web_push_deliveries(message_id, subscription_id)
    SELECT NEW.id, subscription.id
    FROM web_push_subscriptions subscription
    JOIN sessions session ON session.id=subscription.session_id
    JOIN chat_members member ON member.user_id=session.user_id AND member.chat_id=NEW.chat_id
    WHERE member.left_at IS NULL
      AND session.revoked_at IS NULL
      AND session.refresh_expires_at>now()
      AND session.user_id IS DISTINCT FROM NEW.sender_id
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS messages_web_push ON messages;
CREATE TRIGGER messages_web_push AFTER INSERT ON messages
FOR EACH ROW EXECUTE FUNCTION enqueue_web_push();

CREATE TABLE IF NOT EXISTS push_devices (
  session_id uuid PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  token varchar(4096) NOT NULL UNIQUE,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS push_deliveries (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES push_devices(session_id) ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(message_id,session_id)
);
CREATE INDEX IF NOT EXISTS push_deliveries_available_idx ON push_deliveries(available_at);

-- Enqueue in the message transaction, so an API crash cannot lose a notification.
CREATE OR REPLACE FUNCTION enqueue_android_push() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind IN ('text','image') THEN
    INSERT INTO push_deliveries(message_id,session_id)
    SELECT NEW.id, device.session_id FROM push_devices device
    JOIN sessions session ON session.id=device.session_id
    JOIN chat_members member ON member.user_id=session.user_id AND member.chat_id=NEW.chat_id
    WHERE member.left_at IS NULL AND session.revoked_at IS NULL
      AND session.refresh_expires_at>now() AND session.user_id IS DISTINCT FROM NEW.sender_id
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS messages_android_push ON messages;
CREATE TRIGGER messages_android_push AFTER INSERT ON messages
FOR EACH ROW EXECUTE FUNCTION enqueue_android_push();

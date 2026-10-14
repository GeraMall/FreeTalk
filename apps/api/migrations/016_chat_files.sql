ALTER TABLE messages DROP CONSTRAINT messages_kind_check;
ALTER TABLE messages
  ADD CONSTRAINT messages_kind_check CHECK (kind IN ('text','system','call','image','file'));

CREATE TABLE message_files (
  message_id uuid PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  filename varchar(255) NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 255),
  mime varchar(255) NOT NULL CHECK (char_length(mime) BETWEEN 1 AND 255),
  size integer NOT NULL CHECK (size BETWEEN 1 AND 31457280),
  data bytea NOT NULL CHECK (octet_length(data)=size AND octet_length(data)<=31457280),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION enqueue_android_push() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind IN ('text','image','file') THEN
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

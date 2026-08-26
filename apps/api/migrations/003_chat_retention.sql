ALTER TABLE chats
  ADD COLUMN retention_hours integer DEFAULT 720
  CHECK (retention_hours IS NULL OR retention_hours IN (24, 168, 720));

ALTER TABLE messages
  ALTER COLUMN expires_at DROP NOT NULL,
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '30 days');

-- Preserve existing history and move still-live chats to the new 30-day default.
UPDATE messages
SET expires_at = GREATEST(expires_at, created_at + interval '30 days')
WHERE expires_at > now();

CREATE INDEX messages_chat_created_idx ON messages(chat_id, created_at DESC);

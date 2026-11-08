ALTER TABLE chat_members ADD COLUMN IF NOT EXISTS muted_at timestamptz;
ALTER TABLE chat_members ADD COLUMN IF NOT EXISTS pinned_at timestamptz;

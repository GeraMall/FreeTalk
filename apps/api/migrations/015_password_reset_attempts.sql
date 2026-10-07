ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS password_resets_user_created_idx ON password_resets(user_id, created_at DESC);

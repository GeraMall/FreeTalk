BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE chats ADD COLUMN is_saved boolean NOT NULL DEFAULT false;
ALTER TABLE chats ADD CONSTRAINT saved_chat_is_private
  CHECK (NOT is_saved OR (type='direct' AND retention_hours IS NULL));
CREATE UNIQUE INDEX chats_saved_owner_idx ON chats(created_by) WHERE is_saved;
ALTER TABLE chat_members ADD COLUMN archived_at timestamptz;

COMMIT;

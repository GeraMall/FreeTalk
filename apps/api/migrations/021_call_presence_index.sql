CREATE INDEX IF NOT EXISTS call_participants_presence_user_idx
  ON call_participants(user_id,call_id)
  WHERE left_at IS NULL AND user_id IS NOT NULL;

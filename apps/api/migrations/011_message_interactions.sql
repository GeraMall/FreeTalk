ALTER TABLE messages
  ADD COLUMN reply_to_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN pinned_at timestamptz,
  ADD COLUMN pinned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT messages_pin_pair_check CHECK (
    (pinned_at IS NULL AND pinned_by IS NULL) OR pinned_at IS NOT NULL
  );

CREATE INDEX messages_reply_to_idx
  ON messages(reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;

CREATE INDEX messages_chat_pinned_idx
  ON messages(chat_id, pinned_at DESC)
  WHERE pinned_at IS NOT NULL;

CREATE TABLE message_reactions (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji varchar(64) NOT NULL CHECK (
    char_length(emoji) >= 1 AND octet_length(emoji) <= 64
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(message_id, user_id)
);

CREATE INDEX message_reactions_user_idx ON message_reactions(user_id);

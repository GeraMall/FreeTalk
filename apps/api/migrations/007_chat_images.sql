ALTER TABLE messages DROP CONSTRAINT messages_kind_check;
ALTER TABLE messages
  ADD CONSTRAINT messages_kind_check CHECK (kind IN ('text','system','call','image'));

CREATE TABLE message_images (
  message_id uuid PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  mime varchar(32) NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/webp')),
  data bytea NOT NULL CHECK (octet_length(data) <= 3145728),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 8192),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 8192),
  created_at timestamptz NOT NULL DEFAULT now()
);

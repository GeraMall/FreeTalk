ALTER TABLE chats
  ADD COLUMN avatar_mime varchar(32),
  ADD COLUMN avatar_data bytea,
  ADD COLUMN avatar_position_x smallint NOT NULL DEFAULT 50,
  ADD COLUMN avatar_position_y smallint NOT NULL DEFAULT 50,
  ADD COLUMN avatar_updated_at timestamptz;

ALTER TABLE chats
  ADD CONSTRAINT chats_avatar_mime_check
    CHECK (avatar_mime IS NULL OR avatar_mime IN ('image/png','image/jpeg','image/webp')),
  ADD CONSTRAINT chats_avatar_data_size_check
    CHECK (avatar_data IS NULL OR octet_length(avatar_data) <= 1572864),
  ADD CONSTRAINT chats_avatar_position_x_check
    CHECK (avatar_position_x BETWEEN 0 AND 100),
  ADD CONSTRAINT chats_avatar_position_y_check
    CHECK (avatar_position_y BETWEEN 0 AND 100),
  ADD CONSTRAINT chats_avatar_pair_check
    CHECK ((avatar_mime IS NULL) = (avatar_data IS NULL));

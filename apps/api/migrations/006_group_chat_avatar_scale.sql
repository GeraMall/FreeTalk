ALTER TABLE chats
  ADD COLUMN avatar_scale smallint NOT NULL DEFAULT 100;

ALTER TABLE chats
  ADD CONSTRAINT chats_avatar_scale_check
    CHECK (avatar_scale BETWEEN 100 AND 250);

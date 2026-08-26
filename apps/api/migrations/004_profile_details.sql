ALTER TABLE users
  ADD COLUMN bio varchar(200),
  ADD COLUMN cover_mime varchar(32),
  ADD COLUMN cover_data bytea,
  ADD CONSTRAINT users_cover_size_check
    CHECK (octet_length(COALESCE(cover_data, ''::bytea)) <= 2097152);

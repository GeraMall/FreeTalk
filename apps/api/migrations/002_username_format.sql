ALTER TABLE users
  ADD CONSTRAINT users_username_format_v2
  CHECK (username::text ~ '^[a-z0-9_]{5,24}$') NOT VALID;

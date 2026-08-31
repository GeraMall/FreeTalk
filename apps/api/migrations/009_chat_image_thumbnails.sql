ALTER TABLE message_images
  ADD COLUMN thumbnail_mime varchar(32)
    CHECK (thumbnail_mime IN ('image/jpeg','image/webp')),
  ADD COLUMN thumbnail_data bytea
    CHECK (octet_length(thumbnail_data) <= 262144),
  ADD CONSTRAINT message_images_thumbnail_pair_check CHECK (
    (thumbnail_mime IS NULL AND thumbnail_data IS NULL) OR
    (thumbnail_mime IS NOT NULL AND thumbnail_data IS NOT NULL)
  );

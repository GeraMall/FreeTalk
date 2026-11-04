ALTER TABLE users ADD COLUMN can_access_store boolean NOT NULL DEFAULT false;

UPDATE users
SET can_access_store = true
WHERE username = 'german' AND deleted_at IS NULL;

BEGIN;

CREATE TABLE gif_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  sha256 bytea NOT NULL UNIQUE CHECK (octet_length(sha256)=32),
  data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 31457280),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 4096),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 4096),
  thumbnail_mime varchar(30) NOT NULL CHECK (thumbnail_mime IN ('image/jpeg','image/webp','image/png')),
  thumbnail_data bytea NOT NULL CHECK (octet_length(thumbnail_data) BETWEEN 1 AND 65536),
  byte_size integer GENERATED ALWAYS AS (octet_length(data)+octet_length(thumbnail_data)) STORED,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE gif_favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  asset_id uuid REFERENCES gif_assets(id) ON DELETE CASCADE,
  gif jsonb NOT NULL CHECK (jsonb_typeof(gif)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,source_key)
);
CREATE INDEX gif_favorites_user_created_idx ON gif_favorites(user_id,created_at DESC);
CREATE INDEX gif_assets_owner_idx ON gif_assets(created_by);
CREATE INDEX gif_assets_cleanup_idx ON gif_assets(last_used_at);
CREATE TABLE gif_upload_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bytes integer NOT NULL DEFAULT 0 CHECK(bytes BETWEEN 0 AND 31784960),
  reserved_bytes integer NOT NULL DEFAULT 0 CHECK(reserved_bytes BETWEEN 0 AND 31784960),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gif_upload_attempts_user_time_idx ON gif_upload_attempts(user_id,created_at DESC);
CREATE INDEX gif_upload_attempts_time_idx ON gif_upload_attempts(created_at);
CREATE TABLE gif_bandwidth_usage (
  scope text NOT NULL,
  day date NOT NULL DEFAULT current_date,
  bytes bigint NOT NULL CHECK(bytes>=0),
  PRIMARY KEY(scope,day)
);
CREATE INDEX gif_messages_asset_idx ON messages((metadata->'gif'->>'assetId'))
  WHERE metadata->'gif'->>'assetId' IS NOT NULL;

COMMIT;

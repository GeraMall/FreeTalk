-- One active account API at a time. Standbys serve 503 until their lease is granted.
CREATE TABLE IF NOT EXISTS service_leases (
  service text PRIMARY KEY,
  instance_id uuid NOT NULL,
  lease_until timestamptz NOT NULL
);

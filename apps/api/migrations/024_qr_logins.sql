CREATE TABLE qr_logins (
  challenge_hash bytea PRIMARY KEY,
  poll_hash bytea UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  approved_session_id uuid REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX qr_logins_expiry_idx ON qr_logins(expires_at);

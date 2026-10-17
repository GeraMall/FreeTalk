CREATE TABLE mobile_beta_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_by uuid UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  claimed_ip_hash bytea,
  claimed_user_agent varchar(256),
  CHECK ((claimed_by IS NULL) = (claimed_at IS NULL))
);

CREATE INDEX mobile_beta_invites_available_idx
  ON mobile_beta_invites(created_at) WHERE claimed_by IS NULL;

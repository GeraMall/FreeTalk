CREATE TABLE passkeys (
    id text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key bytea NOT NULL,
    counter bigint NOT NULL,
    transports text[] NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX passkeys_user_id_idx ON passkeys (user_id);

CREATE TABLE passkey_requests (
    token_hash bytea PRIMARY KEY,
    challenge text NOT NULL,
    registration_session_id uuid REFERENCES sessions(id) ON DELETE CASCADE,
    qr_challenge_hash bytea REFERENCES qr_logins(challenge_hash) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    CHECK (registration_session_id IS NULL OR qr_challenge_hash IS NULL)
);

CREATE INDEX passkey_requests_expires_at_idx ON passkey_requests (expires_at);

ALTER TABLE qr_logins ADD COLUMN approved_passkey_id text REFERENCES passkeys(id) ON DELETE SET NULL;

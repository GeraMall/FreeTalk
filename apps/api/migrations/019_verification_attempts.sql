BEGIN;
ALTER TABLE email_verifications ADD COLUMN attempts integer NOT NULL DEFAULT 0
  CHECK (attempts >= 0);
CREATE INDEX email_verifications_user_created_idx ON email_verifications(user_id,created_at);
CREATE INDEX security_events_login_account_idx ON security_events(user_id,created_at)
  WHERE event_type IN ('login.failed','mobile_beta.login_failed');
COMMIT;

// Run on the API host with its EnvironmentFile, before deploying numeric-code support.
import { db, transaction } from '/opt/freetalk/api/dist/db.js';
try {
  await transaction(async (client) => {
    await client.query(
      'ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0',
    );
    await client.query(
      'CREATE INDEX IF NOT EXISTS password_resets_user_created_idx ON password_resets(user_id, created_at DESC)',
    );
    await client.query(
      "INSERT INTO schema_migrations(name) VALUES('015_password_reset_attempts') ON CONFLICT DO NOTHING",
    );
  });
  console.info('Password reset migration applied.');
} finally {
  await db.end();
}

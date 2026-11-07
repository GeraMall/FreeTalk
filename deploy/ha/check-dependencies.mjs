// Run from /opt/freetalk/api with Node --env-file; never print credentials.
import { createRequire } from 'node:module';
const require = createRequire('/opt/freetalk/api/package.json');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 6000,
});
const db = await pool.query(
  'SELECT pg_is_in_recovery() AS standby, (SELECT count(*)::int FROM users) AS users',
);
console.log(JSON.stringify({ database: 'ok', ...db.rows[0] }));
await pool.end();
const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
});
try {
  await transport.verify();
  console.log('SMTP_AUTH_OK_NO_EMAIL_SENT');
} finally {
  transport.close();
}
// loadEnvFile does not overwrite existing API variables or expose their values.
process.loadEnvFile('/etc/freetalk/signaling.env');
const response = await fetch(process.env.TURN_BROKER_URL, {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.TURN_BROKER_TOKEN}` },
  signal: AbortSignal.timeout(12000),
});
if (!response.ok) throw new Error(`TURN broker HTTP ${response.status}`);
const data = await response.json();
if (
  data.type !== 'ice-config' ||
  !data.iceServers?.some((s) => JSON.stringify(s.urls).includes('turn:'))
)
  throw new Error('TURN relay missing');
console.log('TURN_CREDENTIALS_OK');

import { randomBytes } from 'node:crypto';
import { db } from './db.js';
import { formatMobileBetaKey } from './mobile-beta.js';
import { tokenHash } from './security.js';

const requested = Number.parseInt(process.argv[2] ?? '30', 10);
if (!Number.isInteger(requested) || requested < 1 || requested > 500)
  throw new Error('Key count must be between 1 and 500');

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const keys: string[] = [];
while (keys.length < requested) {
  const bytes = randomBytes(16);
  let raw = '';
  for (let index = 0; index < 16; index += 1) raw += alphabet[bytes[index]! % alphabet.length];
  const inserted = await db.query(
    'INSERT INTO mobile_beta_invites(code_hash) VALUES($1) ON CONFLICT DO NOTHING RETURNING id',
    [tokenHash(raw)],
  );
  if (inserted.rowCount) keys.push(formatMobileBetaKey(raw));
}

console.log(keys.join('\n'));
await db.end();

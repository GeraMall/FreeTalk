import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { transaction } from './db.js';
import { issueSession, type UserRow } from './auth-service.js';
import { tokenHash } from './security.js';

export async function completeEmailVerification(
  input: { email: string; code: string } | { token: string },
  request: FastifyRequest,
) {
  return transaction(async (client) => {
    // Lock the active challenge before checking a guess, including failed ones.
    // IP throttling alone cannot stop a distributed attack against six digits.
    const numeric = 'code' in input;
    const result = await client.query<{
      id: string;
      user_id: string;
      token_hash: Buffer;
      attempts: number;
    }>(
      `SELECT ev.id,ev.user_id,ev.token_hash,ev.attempts FROM email_verifications ev
       JOIN users u ON u.id=ev.user_id
       WHERE ${numeric ? 'u.email=$1' : 'ev.token_hash=$1'}
         AND u.deleted_at IS NULL AND ev.used_at IS NULL AND ev.expires_at>now()
       ORDER BY ev.created_at DESC LIMIT 1 FOR UPDATE OF ev`,
      [numeric ? input.email : tokenHash(input.token)],
    );
    const row = result.rows[0];
    if (!row || row.attempts >= 5) return null;
    await client.query('UPDATE email_verifications SET attempts=attempts+1 WHERE id=$1', [row.id]);
    const token = numeric ? input.code : input.token;
    const expected = tokenHash(numeric ? `${row.id}:${token}` : token);
    // Existing emailed codes remain usable during rollout, with the same attempt cap.
    const legacy = tokenHash(token);
    const previousAccountBound = tokenHash(`${row.user_id}:${token}`);
    if (
      !timingSafeEqual(row.token_hash, expected) &&
      !timingSafeEqual(row.token_hash, legacy) &&
      !(numeric && timingSafeEqual(row.token_hash, previousAccountBound))
    )
      return null;
    await client.query(
      'UPDATE email_verifications SET used_at=now() WHERE user_id=$1 AND used_at IS NULL',
      [row.user_id],
    );
    const user = await client.query<UserRow>(
      `UPDATE users SET email_verified_at=COALESCE(email_verified_at,now()),updated_at=now()
       WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
      [row.user_id],
    );
    return { user: user.rows[0]!, session: await issueSession(client, row.user_id, request) };
  });
}

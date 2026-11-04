import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  issueSession,
  publicUser,
  recordSecurityEvent,
  type AuthenticatedUser,
  type UserRow,
} from './auth-service.js';
import { db, transaction } from './db.js';
import { randomToken, tokenHash } from './security.js';

type RequireUser = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<AuthenticatedUser | null>;

const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const ttlSeconds = 120;

export function registerQrLoginRoutes(app: FastifyInstance, requireUser: RequireUser) {
  app.post(
    '/v1/auth/qr/start',
    {
      config: { rateLimit: { max: 8, timeWindow: '1 minute' } },
    },
    async (_request, reply) => {
      const challenge = randomToken();
      const pollToken = randomToken();
      await db.query('DELETE FROM qr_logins WHERE expires_at <= now()');
      await db.query(
        `INSERT INTO qr_logins (challenge_hash, poll_hash, expires_at)
       VALUES ($1, $2, now() + $3 * interval '1 second')`,
        [tokenHash(challenge), tokenHash(pollToken), ttlSeconds],
      );
      return reply
        .header('Cache-Control', 'no-store')
        .code(201)
        .send({ challenge, pollToken, expiresIn: ttlSeconds });
    },
  );

  app.post(
    '/v1/auth/qr/approve',
    {
      config: { rateLimit: { max: 12, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const { challenge } = z.object({ challenge: token }).parse(request.body);
      const result = await db.query(
        `UPDATE qr_logins SET approved_session_id = $2
       WHERE challenge_hash = $1 AND expires_at > now() AND approved_session_id IS NULL AND approved_passkey_id IS NULL`,
        [tokenHash(challenge), user.sessionId],
      );
      if (!result.rowCount) return reply.code(409).send({ code: 'QR_UNAVAILABLE' });
      return { approved: true };
    },
  );

  app.post(
    '/v1/auth/qr/redeem',
    {
      config: { rateLimit: { max: 90, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const { pollToken } = z.object({ pollToken: token }).parse(request.body);
      const pollHash = tokenHash(pollToken);
      const result = await transaction(async (client) => {
        const login = await client.query<{
          approved_session_id: string | null;
          approved_passkey_id: string | null;
        }>(
          `SELECT approved_session_id, approved_passkey_id FROM qr_logins
         WHERE poll_hash = $1 AND expires_at > now() FOR UPDATE`,
          [pollHash],
        );
        const row = login.rows[0];
        if (!row) return { status: 'expired' } as const;
        if (!row.approved_session_id && !row.approved_passkey_id)
          return { status: 'pending' } as const;

        const { rows } = row.approved_passkey_id
          ? await client.query<UserRow>(
              `SELECT u.* FROM passkeys p JOIN users u ON u.id=p.user_id
             WHERE p.id=$1 AND u.deleted_at IS NULL AND u.email_verified_at IS NOT NULL`,
              [row.approved_passkey_id],
            )
          : await client.query<UserRow>(
              `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = $1 AND s.revoked_at IS NULL AND s.refresh_expires_at > now()
           AND u.deleted_at IS NULL AND u.email_verified_at IS NOT NULL
         FOR SHARE OF s, u`,
              [row.approved_session_id],
            );
        await client.query('DELETE FROM qr_logins WHERE poll_hash = $1', [pollHash]);
        const user = rows[0];
        if (!user) return { status: 'expired' } as const;
        const session = await issueSession(client, user.id, request);
        return { status: 'approved', user: publicUser(user), session } as const;
      });
      if (result.status === 'approved') {
        await recordSecurityEvent(request, 'login.qr_succeeded', result.user.id).catch(
          (error: unknown) => {
            request.log.error(error, 'Failed to record QR login');
          },
        );
      }
      return result;
    },
  );
}

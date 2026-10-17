import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { issueSession, publicUser, recordSecurityEvent, type UserRow } from './auth-service.js';
import { db, transaction } from './db.js';
import { hashIp, tokenHash, verifyPassword } from './security.js';

export const MOBILE_BETA_KEY_REQUIRED = 'MOBILE_BETA_KEY_REQUIRED';

export function normalizeMobileBetaKey(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/^TRLKA-/, '')
    .replace(/[^A-Z0-9]/g, '');
}

export function formatMobileBetaKey(value: string) {
  return `TRLKA-${value.match(/.{1,4}/g)?.join('-') ?? value}`;
}

export function isMobileBetaUserAgent(userAgent = '') {
  return /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(userAgent);
}

export function registerMobileBetaRoutes(app: FastifyInstance) {
  app.post(
    '/v1/mobile-beta/login',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      if (!isMobileBetaUserAgent(request.headers['user-agent']))
        return reply.code(403).send({
          code: 'MOBILE_DEVICE_REQUIRED',
          message: 'Ключи мобильной беты действуют только на телефонах и планшетах',
        });
      const input = z
        .object({
          login: z.string().trim().min(3).max(254),
          password: z.string().max(256),
          key: z.string().trim().max(64).optional(),
        })
        .parse(request.body);
      const login = input.login.replace(/^@/, '').toLowerCase();
      const found = await db.query<UserRow>(
        `SELECT * FROM users WHERE (email=$1 OR username=$1) AND deleted_at IS NULL`,
        [login],
      );
      const user = found.rows[0];
      if (!user || !(await verifyPassword(user.password_hash, input.password))) {
        await recordSecurityEvent(request, 'mobile_beta.login_failed', user?.id);
        return reply
          .code(401)
          .send({ code: 'INVALID_CREDENTIALS', message: 'Неверная почта, username или пароль' });
      }
      if (!user.email_verified_at)
        return reply.code(403).send({ code: 'EMAIL_NOT_VERIFIED', message: 'Подтвердите почту' });

      const normalizedKey = input.key ? normalizeMobileBetaKey(input.key) : '';
      const result = await transaction(async (client) => {
        const existing = await client.query<{ id: string }>(
          'SELECT id FROM mobile_beta_invites WHERE claimed_by=$1 LIMIT 1',
          [user.id],
        );
        if (!existing.rowCount) {
          if (normalizedKey.length !== 16) return { reason: MOBILE_BETA_KEY_REQUIRED } as const;
          const invite = await client.query<{ id: string; claimed_by: string | null }>(
            `SELECT id,claimed_by FROM mobile_beta_invites
             WHERE code_hash=$1 FOR UPDATE`,
            [tokenHash(normalizedKey)],
          );
          const row = invite.rows[0];
          if (!row)
            return {
              reason: 'INVALID_MOBILE_BETA_KEY',
              message: 'Ключ мобильной беты не найден',
            } as const;
          if (row.claimed_by && row.claimed_by !== user.id)
            return {
              reason: 'MOBILE_BETA_KEY_USED',
              message: 'Этот ключ уже привязан к другому аккаунту',
            } as const;
          await client.query(
            `UPDATE mobile_beta_invites
             SET claimed_by=$1,claimed_at=now(),claimed_ip_hash=$2,claimed_user_agent=$3
             WHERE id=$4`,
            [
              user.id,
              hashIp(request.ip),
              request.headers['user-agent']?.slice(0, 256) ?? null,
              row.id,
            ],
          );
        }
        const session = await issueSession(client, user.id, request);
        return { session } as const;
      });

      if ('reason' in result)
        return reply.code(403).send({
          code: result.reason,
          message:
            ('message' in result ? result.message : undefined) ??
            'Введите одноразовый ключ мобильной беты',
        });
      await recordSecurityEvent(request, 'mobile_beta.login_succeeded', user.id, {
        claimed: Boolean(normalizedKey),
      });
      return { user: publicUser(user), session: result.session };
    },
  );
}

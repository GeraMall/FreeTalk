import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { transaction } from './db.js';
import { recordSecurityEvent } from './auth-service.js';
import { sendPasswordReset } from './mailer.js';
import {
  emailSchema,
  passwordSchema,
  randomToken,
  randomVerificationCode,
  tokenHash,
  hashPassword,
} from './security.js';

export function registerPasswordResetRoutes(app: FastifyInstance) {
  app.post(
    '/v1/auth/forgot-password',
    { config: { rateLimit: { max: 4, timeWindow: '1 hour' } } },
    async (request) => {
      const input = z
        .object({ email: emailSchema, codeFormat: z.literal('numeric').optional() })
        .parse(request.body);
      const issued = await transaction(async (client) => {
        const user = (
          await client.query<{ id: string; email: string }>(
            'SELECT id,email FROM users WHERE email=$1 AND deleted_at IS NULL FOR UPDATE',
            [input.email],
          )
        ).rows[0];
        if (!user) return null;
        const count =
          (
            await client.query<{ count: number }>(
              "SELECT count(*)::int AS count FROM password_resets WHERE user_id=$1 AND created_at>now()-interval '1 hour'",
              [user.id],
            )
          ).rows[0]?.count ?? 0;
        if (count >= 4) return null;
        const id = randomUUID();
        const code = input.codeFormat === 'numeric' ? randomVerificationCode() : randomToken();
        await client.query(
          'UPDATE password_resets SET used_at=now() WHERE user_id=$1 AND used_at IS NULL',
          [user.id],
        );
        await client.query(
          "INSERT INTO password_resets(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '20 minutes')",
          [id, user.id, tokenHash(input.codeFormat === 'numeric' ? `${id}:${code}` : code)],
        );
        return { user, code };
      });
      if (issued) await sendPasswordReset(issued.user.email, issued.code);
      await recordSecurityEvent(request, 'password-reset.requested', issued?.user.id);
      return { message: 'Если такой аккаунт существует, письмо отправлено.' };
    },
  );

  app.post(
    '/v1/auth/reset-password',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const input = z
        .union([
          z.object({
            email: emailSchema,
            token: z.string().regex(/^\d{6}$/),
            password: passwordSchema,
          }),
          z.object({ token: z.string().min(32).max(256), password: passwordSchema }),
        ])
        .parse(request.body);
      const reset = await transaction(async (client) => {
        const numeric = 'email' in input;
        const row = (
          await client.query<{ id: string; user_id: string; token_hash: Buffer; attempts: number }>(
            `SELECT pr.id,pr.user_id,pr.token_hash,pr.attempts FROM password_resets pr JOIN users u ON u.id=pr.user_id
         WHERE ${numeric ? 'u.email=$1' : 'pr.token_hash=$1'} AND u.deleted_at IS NULL
         AND pr.used_at IS NULL AND pr.expires_at>now() ORDER BY pr.created_at DESC LIMIT 1 FOR UPDATE OF pr`,
            [numeric ? input.email : tokenHash(input.token)],
          )
        ).rows[0];
        if (!row || row.attempts >= 5) return false;
        await client.query('UPDATE password_resets SET attempts=attempts+1 WHERE id=$1', [row.id]);
        if (numeric && !tokenHash(`${row.id}:${input.token}`).equals(row.token_hash)) return false;
        const passwordHash = await hashPassword(input.password);
        await client.query(
          'UPDATE password_resets SET used_at=now() WHERE user_id=$1 AND used_at IS NULL',
          [row.user_id],
        );
        await client.query('UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2', [
          passwordHash,
          row.user_id,
        ]);
        await client.query(
          'UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',
          [row.user_id],
        );
        return true;
      });
      if (!reset)
        return reply.code(400).send({
          code: 'INVALID_TOKEN',
          message: 'Код неверный, истёк или исчерпаны попытки. Запросите новый код.',
        });
      return { changed: true };
    },
  );
}

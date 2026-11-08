import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from './db.js';
import type { AuthenticatedUser } from './auth-service.js';
type RequireUser = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<AuthenticatedUser | null>;
export function registerAppearance(app: FastifyInstance, requireUser: RequireUser) {
  app.get('/v1/me/appearance', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const result = await db.query(
      'SELECT theme,sync_enabled FROM user_appearance_preferences WHERE user_id=$1',
      [user.id],
    );
    const row = result.rows[0];
    return {
      appearance: { theme: row?.theme ?? 'default', syncEnabled: row?.sync_enabled ?? false },
    };
  });
  app.put(
    '/v1/me/appearance',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const input = z
        .object({ theme: z.enum(['default', 'light', 'black']), syncEnabled: z.boolean() })
        .strict()
        .safeParse(request.body);
      if (!input.success) return reply.code(400).send({ code: 'INVALID_APPEARANCE' });
      await db.query(
        `INSERT INTO user_appearance_preferences(user_id,theme,sync_enabled) VALUES($1,$2,$3)
      ON CONFLICT(user_id) DO UPDATE SET theme=excluded.theme,sync_enabled=excluded.sync_enabled,updated_at=now()`,
        [user.id, input.data.theme, input.data.syncEnabled],
      );
      return { appearance: input.data };
    },
  );
}

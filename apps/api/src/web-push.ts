import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequire } from 'node:module';
import type webPushType from 'web-push';
import { z } from 'zod';
import type { AuthenticatedUser } from './auth-service.js';
import { db, transaction } from './db.js';
import { env } from './env.js';

const bundledWebPush = createRequire(import.meta.url)('../vendor/web-push.cjs') as
  | typeof webPushType
  | { default: typeof webPushType };
const webPush = 'default' in bundledWebPush ? bundledWebPush.default : bundledWebPush;

type RequireUser = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<AuthenticatedUser | null>;

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(4096),
  expirationTime: z.number().int().nonnegative().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(20).max(1024),
    auth: z.string().min(8).max(512),
  }),
});

function configured() {
  return Boolean(env.WEB_PUSH_VAPID_PUBLIC_KEY && env.WEB_PUSH_VAPID_PRIVATE_KEY);
}

export function registerWebPush(app: FastifyInstance, requireUser: RequireUser) {
  app.get('/v1/me/web-push-key', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    if (!configured()) return reply.code(503).send({ code: 'WEB_PUSH_UNAVAILABLE' });
    return { publicKey: env.WEB_PUSH_VAPID_PUBLIC_KEY };
  });

  app.post(
    '/v1/me/web-push-subscription',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      if (!configured()) return reply.code(503).send({ code: 'WEB_PUSH_UNAVAILABLE' });
      const subscription = subscriptionSchema.parse(request.body);
      await transaction(async (client) => {
        await client.query(
          'DELETE FROM web_push_subscriptions WHERE endpoint=$1 AND session_id<>$2',
          [subscription.endpoint, user.sessionId],
        );
        await client.query(
          `INSERT INTO web_push_subscriptions(session_id,endpoint,p256dh,auth,expiration_time)
           VALUES($1,$2,$3,$4,$5)
           ON CONFLICT(endpoint) DO UPDATE SET
             session_id=EXCLUDED.session_id,
             p256dh=EXCLUDED.p256dh,
             auth=EXCLUDED.auth,
             expiration_time=EXCLUDED.expiration_time,
             updated_at=now()`,
          [
            user.sessionId,
            subscription.endpoint,
            subscription.keys.p256dh,
            subscription.keys.auth,
            subscription.expirationTime ?? null,
          ],
        );
      });
      return { ok: true };
    },
  );
}

export function startWebPush(app: FastifyInstance) {
  if (!configured()) return;
  webPush.setVapidDetails(
    env.WEB_PUSH_SUBJECT,
    env.WEB_PUSH_VAPID_PUBLIC_KEY!,
    env.WEB_PUSH_VAPID_PRIVATE_KEY!,
  );
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await db.query(
        "DELETE FROM web_push_deliveries WHERE created_at<now()-interval '1 hour' OR attempts>=8",
      );
      await db.query(
        `DELETE FROM web_push_subscriptions subscription USING sessions session
         WHERE session.id=subscription.session_id
           AND (session.revoked_at IS NOT NULL OR session.refresh_expires_at<=now())`,
      );
      const jobs = await db.query<{ message_id: string; subscription_id: string }>(
        `WITH picked AS (
           SELECT message_id,subscription_id FROM web_push_deliveries
           WHERE available_at<=now()
           ORDER BY available_at LIMIT 20 FOR UPDATE SKIP LOCKED
         )
         UPDATE web_push_deliveries delivery
         SET available_at=now()+interval '2 minutes',attempts=attempts+1
         FROM picked
         WHERE delivery.message_id=picked.message_id
           AND delivery.subscription_id=picked.subscription_id
         RETURNING delivery.message_id,delivery.subscription_id`,
      );
      await Promise.all(
        jobs.rows.map(async (job) => {
          const removeJob = () =>
            db.query('DELETE FROM web_push_deliveries WHERE message_id=$1 AND subscription_id=$2', [
              job.message_id,
              job.subscription_id,
            ]);
          const current = await db.query<{
            endpoint: string;
            p256dh: string;
            auth: string;
            chat_id: string;
            sender_id: string | null;
            kind: string;
            body: string;
            display_name: string;
            expires_at: Date | null;
          }>(
            `SELECT subscription.endpoint,subscription.p256dh,subscription.auth,
                    message.chat_id,message.sender_id,message.kind,message.body,
                    COALESCE(sender.display_name,'Trlka') display_name,message.expires_at
             FROM web_push_subscriptions subscription
             JOIN sessions session ON session.id=subscription.session_id
             JOIN messages message ON message.id=$1
             JOIN chat_members member ON member.chat_id=message.chat_id AND member.user_id=session.user_id
             LEFT JOIN users sender ON sender.id=message.sender_id
             WHERE subscription.id=$2
               AND session.revoked_at IS NULL AND session.refresh_expires_at>now()
               AND member.left_at IS NULL
               AND session.user_id IS DISTINCT FROM message.sender_id
               AND (message.expires_at IS NULL OR message.expires_at>now())
               AND NOT EXISTS(SELECT 1 FROM blocks block WHERE
                 (block.blocker_id=session.user_id AND block.blocked_id=message.sender_id) OR
                 (block.blocked_id=session.user_id AND block.blocker_id=message.sender_id))`,
            [job.message_id, job.subscription_id],
          );
          const row = current.rows[0];
          if (!row) {
            await removeJob();
            return;
          }
          const body =
            row.kind === 'image'
              ? 'Фотография'
              : row.kind === 'file'
                ? row.body || 'Файл'
                : Array.from(row.body).slice(0, 160).join('');
          try {
            await webPush.sendNotification(
              {
                endpoint: row.endpoint,
                keys: { p256dh: row.p256dh, auth: row.auth },
              },
              JSON.stringify({
                title: row.display_name,
                body,
                chatId: row.chat_id,
                url: '/app/',
                icon: '/app/icons/trlka-192.png',
                badge: '/app/icons/trlka-192.png',
              }),
              {
                TTL: Math.max(
                  0,
                  Math.min(
                    3600,
                    Math.round(
                      ((row.expires_at?.getTime() ?? Date.now() + 3600000) - Date.now()) / 1000,
                    ),
                  ),
                ),
                urgency: 'high',
                topic: `chat-${row.chat_id}`.slice(0, 32),
              },
            );
            await removeJob();
          } catch (error) {
            const statusCode =
              typeof error === 'object' && error !== null && 'statusCode' in error
                ? Number(error.statusCode)
                : 0;
            if (statusCode === 404 || statusCode === 410) {
              await db.query('DELETE FROM web_push_subscriptions WHERE id=$1', [
                job.subscription_id,
              ]);
            }
            app.log.warn({ statusCode }, 'Web push delivery failed; queued for retry');
          }
        }),
      );
    } catch {
      app.log.warn('Web push worker failed; will retry');
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), 1000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
}

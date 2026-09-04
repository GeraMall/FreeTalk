import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { z } from 'zod';
import { db, transaction } from './db.js';
import type { AuthenticatedUser } from './auth-service.js';

type RequireUser = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<AuthenticatedUser | null>;
export function registerAndroidPush(app: FastifyInstance, requireUser: RequireUser) {
  app.post(
    '/v1/me/push-token',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const { token } = z
        .object({
          token: z
            .string()
            .min(20)
            .max(4096)
            .regex(/^[A-Za-z0-9_:.-]+$/),
        })
        .parse(request.body);
      await transaction(async (client) => {
        // A device changing accounts must no longer receive the previous account's pushes.
        await client.query('DELETE FROM push_devices WHERE token=$1 AND session_id<>$2', [
          token,
          user.sessionId,
        ]);
        await client.query(
          'INSERT INTO push_devices(session_id,token) VALUES($1,$2) ON CONFLICT(session_id) DO UPDATE SET token=EXCLUDED.token,updated_at=now()',
          [user.sessionId, token],
        );
      });
      return { ok: true };
    },
  );
}

export function pushEvent(row: {
  message_id: string;
  chat_id: string;
  sender_id: string | null;
  kind: string;
  body: string;
  display_name: string;
  expires_at: Date | null;
  created_at: Date;
}) {
  return JSON.stringify({
    type: 'message-created',
    chatId: row.chat_id,
    message: {
      id: row.message_id,
      sender_id: row.sender_id,
      kind: row.kind,
      body: Array.from(row.body).slice(0, 160).join(''),
      display_name: row.display_name,
      expires_at: row.expires_at?.toISOString() ?? null,
      created_at: row.created_at.toISOString(),
    },
  });
}

export function startAndroidPush(app: FastifyInstance) {
  if (process.env.FCM_ENABLED !== 'true') return;
  const firebase = initializeApp(
    {
      credential: applicationDefault(),
      projectId: process.env.FCM_PROJECT_ID || 'trlka-b5d34',
    },
    'android-push',
  );
  const messaging = getMessaging(firebase);
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await db.query(
        "DELETE FROM push_deliveries WHERE created_at<now()-interval '1 hour' OR attempts>=8",
      );
      await db.query(
        'DELETE FROM push_devices USING sessions WHERE sessions.id=push_devices.session_id AND (sessions.revoked_at IS NOT NULL OR sessions.refresh_expires_at<=now())',
      );
      const jobs = await db.query<{ message_id: string; session_id: string }>(
        `WITH picked AS (
           SELECT message_id,session_id FROM push_deliveries WHERE available_at<=now()
           ORDER BY available_at LIMIT 20 FOR UPDATE SKIP LOCKED
         )
         UPDATE push_deliveries p SET available_at=now()+interval '2 minutes',attempts=attempts+1
         FROM picked WHERE p.message_id=picked.message_id AND p.session_id=picked.session_id
         RETURNING p.message_id,p.session_id`,
      );
      await Promise.all(
        jobs.rows.map(async (job) => {
          const remove = () =>
            db.query('DELETE FROM push_deliveries WHERE message_id=$1 AND session_id=$2', [
              job.message_id,
              job.session_id,
            ]);
          const current = await db.query<{
            token: string;
            user_id: string;
            message_id: string;
            chat_id: string;
            sender_id: string | null;
            kind: string;
            body: string;
            display_name: string;
            expires_at: Date | null;
            created_at: Date;
          }>(
            `SELECT d.token,s.user_id,m.id message_id,m.chat_id,m.sender_id,m.kind,m.body,
             COALESCE(u.display_name,'FreeTalk') display_name,m.expires_at,m.created_at
           FROM push_devices d JOIN sessions s ON s.id=d.session_id
           JOIN messages m ON m.id=$1
           JOIN chat_members c ON c.chat_id=m.chat_id AND c.user_id=s.user_id
           LEFT JOIN users u ON u.id=m.sender_id
           WHERE d.session_id=$2 AND s.revoked_at IS NULL AND s.refresh_expires_at>now()
             AND c.left_at IS NULL AND s.user_id IS DISTINCT FROM m.sender_id
             AND (m.expires_at IS NULL OR m.expires_at>now())
             AND NOT EXISTS(SELECT 1 FROM blocks b WHERE
               (b.blocker_id=s.user_id AND b.blocked_id=m.sender_id) OR
               (b.blocked_id=s.user_id AND b.blocker_id=m.sender_id))`,
            [job.message_id, job.session_id],
          );
          const row = current.rows[0];
          if (!row) {
            await remove();
            return;
          }
          try {
            await messaging.send({
              token: row.token,
              data: { recipientId: row.user_id, event: pushEvent(row) },
              android: {
                priority: 'high',
                ttl: Math.max(
                  0,
                  Math.min(
                    3600000,
                    (row.expires_at?.getTime() ?? Date.now() + 3600000) - Date.now(),
                  ),
                ),
              },
            });
            await remove();
          } catch (error) {
            const code =
              typeof error === 'object' && error !== null && 'code' in error
                ? String(error.code)
                : 'unknown';
            if (
              code === 'messaging/registration-token-not-registered' ||
              code === 'messaging/invalid-registration-token'
            ) {
              await db.query('DELETE FROM push_devices WHERE session_id=$1 AND token=$2', [
                job.session_id,
                row.token,
              ]);
            }
            // Never log tokens, credentials or message contents.
            app.log.warn({ code }, 'Android push delivery failed; queued for retry');
          }
        }),
      );
    } catch {
      app.log.warn('Android push worker failed; will retry');
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => {
    void tick();
  }, 1000);
  timer.unref();
  app.addHook('onClose', async () => {
    clearInterval(timer);
  });
}

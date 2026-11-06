import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { SERVICE_CHAT_ID } from '@freetalk/config';
import type { AuthenticatedUser } from './auth-service.js';
import { db, transaction } from './db.js';
import { env } from './env.js';
import { chatRealtimeHub } from './chat-realtime.js';
import { sendSupportReport } from './mailer.js';
import { serviceCommand, type SupportKind } from './service-chat-commands.js';

type RequireUser = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<AuthenticatedUser | null>;
interface Entry {
  id: string;
  author: 'bot' | 'user';
  kind: string;
  body: string;
  created_at: Date;
}
const HELP =
  'Я служебный бот TRLKA. Здесь появляются уведомления о звонках и обращения в поддержку.\n\n/bug — сообщить об ошибке\n/idea — предложить улучшение\n/subscription — подписка\n/cancel — отменить ввод обращения';
const PROMPT =
  'Опишите, что произошло или что вы хотите улучшить. Для ошибки укажите шаги и ожидаемый результат. Не отправляйте пароли, коды входа и личные переписки.\n\nТекст обращения и имя аккаунта будут переданы команде TRLKA по почте. /cancel — отмена.';

async function append(
  client: PoolClient,
  userId: string,
  author: Entry['author'],
  kind: string,
  body: string,
  key: string,
) {
  const row = await client.query<Entry>(
    `INSERT INTO service_chat_messages(user_id,author,kind,body,event_key)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,event_key) DO NOTHING RETURNING *`,
    [userId, author, kind, body, key],
  );
  return row.rows[0];
}

function publish(userId: string, entries: Entry[]) {
  for (const entry of entries)
    chatRealtimeHub.publish([userId], {
      type: 'message-created',
      chatId: SERVICE_CHAT_ID,
      message: {
        id: entry.id,
        body: entry.body,
        kind: entry.author === 'bot' ? 'system' : 'text',
        sender_id: entry.author === 'user' ? userId : null,
        created_at: new Date(entry.created_at).toISOString(),
        expires_at: null,
        metadata: { serviceKind: entry.kind },
      },
    });
}

export async function addServiceNotice(userId: string, kind: string, body: string, key: string) {
  const entry = await transaction(async (client) => {
    const result = await append(client, userId, 'bot', kind, body.slice(0, 4000), key);
    await client.query(
      `DELETE FROM service_chat_messages WHERE user_id=$1 AND event_key<>'welcome' AND id IN
      (SELECT id FROM service_chat_messages WHERE user_id=$1 ORDER BY created_at DESC,id DESC OFFSET 200)`,
      [userId],
    );
    return result;
  });
  if (entry) publish(userId, [entry]);
}

export function registerServiceChat(app: FastifyInstance, requireUser: RequireUser) {
  app.get('/v1/service-chat/messages', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { search } = z
      .object({ search: z.string().trim().max(200).default('') })
      .parse(request.query);
    const rows = await transaction(async (client) => {
      await append(client, user.id, 'bot', 'help', HELP, 'welcome');
      return client.query<Entry>(
        `SELECT id,author,kind,body,created_at FROM service_chat_messages
        WHERE user_id=$1 AND ($2='' OR strpos(lower(body),lower($2))>0)
        ORDER BY created_at DESC,id DESC LIMIT 100`,
        [user.id, search],
      );
    });
    return { messages: rows.rows.reverse() };
  });

  app.post(
    '/v1/service-chat/messages',
    { bodyLimit: 20 * 1024, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const input = z
        .object({
          requestId: z.string().uuid(),
          body: z.string().trim().min(1).max(4000),
          version: z.string().max(80).default(''),
        })
        .parse(request.body);
      const result = await transaction(async (client) => {
        await client.query(
          `INSERT INTO service_chat_state(user_id) VALUES($1) ON CONFLICT DO NOTHING`,
          [user.id],
        );
        const state = await client.query<{ pending_kind: SupportKind | null }>(
          `SELECT pending_kind FROM service_chat_state WHERE user_id=$1 FOR UPDATE`,
          [user.id],
        );
        const existing = await client.query(
          `SELECT 1 FROM service_chat_messages WHERE user_id=$1 AND event_key=$2
           UNION ALL SELECT 1 FROM support_reports WHERE user_id=$1 AND id=$3`,
          [user.id, `input:${input.requestId}`, input.requestId],
        );
        if (existing.rowCount) return { duplicate: true, entries: [] as Entry[] };
        const command = serviceCommand(input.body, state.rows[0]?.pending_kind);
        let response = HELP;
        let kind = 'help';
        let pending: SupportKind | null = null;
        if (command.type === 'subscription') {
          kind = 'subscription';
          response =
            'Подписка TRLKA готовится. Условия и оплата пока недоступны. Здесь появится информация, когда подписка будет запущена.';
        } else if (command.type === 'cancel')
          response = 'Ввод обращения отменён. /help — список команд.';
        else if (command.type === 'prompt') {
          pending = command.kind;
          kind = 'prompt';
          response = PROMPT;
        } else if (command.type === 'report') {
          if (!env.SUPPORT_EMAIL) return { error: 'SUPPORT_UNAVAILABLE', entries: [] as Entry[] };
          if (command.body.length < 10) {
            pending = command.kind;
            kind = 'prompt';
            response = 'Добавьте подробности: нужно хотя бы 10 символов. /cancel — отмена.';
          } else {
            await client.query(`SELECT pg_advisory_xact_lock(hashtext('trlka-support-quota'))`);
            const quota = await client.query<{ personal: number; ideas: number; global: number }>(
              `SELECT
            (SELECT count(*)::int FROM support_reports WHERE user_id=$1 AND created_at>now()-interval '24 hours') personal,
            (SELECT count(*)::int FROM support_reports WHERE user_id=$1 AND kind='idea' AND created_at>now()-interval '24 hours') ideas,
            (SELECT count(*)::int FROM support_reports WHERE created_at>now()-interval '1 hour') global`,
              [user.id],
            );
            if (command.kind === 'idea' && quota.rows[0]!.ideas >= 1)
              return { error: 'IDEA_LIMIT', entries: [] as Entry[] };
            if (quota.rows[0]!.personal >= 5 || quota.rows[0]!.global >= 100)
              return { error: 'SUPPORT_LIMIT', entries: [] as Entry[] };
            await client.query(
              `INSERT INTO support_reports(id,user_id,kind,body,app_version) VALUES($1,$2,$3,$4,$5)`,
              [input.requestId, user.id, command.kind, command.body, input.version],
            );
            kind = 'accepted';
            response = `Обращение №${input.requestId.slice(0, 8)} принято и поставлено в очередь отправки команде TRLKA. Спасибо за подробности.`;
          }
        }
        const entries: Entry[] = [];
        const inputEntry = await append(
          client,
          user.id,
          'user',
          'text',
          input.body,
          `input:${input.requestId}`,
        );
        if (inputEntry) entries.push(inputEntry);
        const answer = await append(
          client,
          user.id,
          'bot',
          kind,
          response,
          `reply:${input.requestId}`,
        );
        if (answer) entries.push(answer);
        await client.query(
          `UPDATE service_chat_state SET pending_kind=$2,updated_at=now() WHERE user_id=$1`,
          [user.id, pending],
        );
        await client.query(
          `DELETE FROM service_chat_messages WHERE user_id=$1 AND event_key<>'welcome' AND id IN
        (SELECT id FROM service_chat_messages WHERE user_id=$1 ORDER BY created_at DESC,id DESC OFFSET 200)`,
          [user.id],
        );
        return { entries };
      });
      if (result.error)
        return reply.code(result.error === 'SUPPORT_UNAVAILABLE' ? 503 : 429).send({
          code: result.error,
          message:
            result.error === 'IDEA_LIMIT'
              ? 'Предложение можно отправить один раз за 24 часа. Спасибо — предыдущее уже принято.'
              : result.error === 'SUPPORT_LIMIT'
                ? 'Лимит обращений исчерпан. Попробуйте позже.'
                : 'Отправка обращений временно недоступна. Текст не отправлен.',
        });
      publish(user.id, result.entries);
      return { ok: true };
    },
  );

  app.post(
    '/v1/service-chat/call-timeout',
    { config: { rateLimit: { max: 12, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const { eventId, roomId, userId } = z
        .object({
          eventId: z.string().uuid(),
          userId: z.string().uuid(),
          roomId: z.string().regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/),
        })
        .parse(request.body);
      if (userId !== user.id) return reply.code(403).send({ code: 'WRONG_ACCOUNT' });
      const participant = await db.query(
        `SELECT 1 FROM call_participants p JOIN call_sessions c ON c.id=p.call_id
      WHERE c.room_id=$1 AND p.user_id=$2 AND p.joined_at<=now()-interval '4 minutes'
      AND (p.left_at IS NULL OR p.left_at>now()-interval '24 hours')
      AND NOT EXISTS (SELECT 1 FROM call_participants person
        WHERE person.call_id=c.id AND person.user_id IS DISTINCT FROM $2
        AND COALESCE(person.left_at,c.ended_at,now())>now()-interval '4 minutes 55 seconds') LIMIT 1`,
        [roomId, user.id],
      );
      if (!participant.rowCount) return reply.code(404).send({ code: 'CALL_NOT_FOUND' });
      await addServiceNotice(
        user.id,
        'call-timeout',
        'Мы отключили вас от звонка, потому что вы были одни более пяти минут. Можно позвонить снова, когда собеседник будет готов.',
        `call-timeout:${eventId}`,
      );
      return { ok: true };
    },
  );
}

export function startSupportDelivery(app: FastifyInstance, deliver = sendSupportReport) {
  let running = false;
  const tick = async () => {
    if (running || !env.SUPPORT_EMAIL) return;
    running = true;
    try {
      const report = await transaction(async (client) => {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext('trlka-support-delivery'))`);
        await client.query(`UPDATE support_reports SET status='failed',lease_until=NULL
          WHERE status='sending' AND lease_until<now() AND attempts>=8`);
        await client.query(`DELETE FROM support_reports WHERE created_at<now()-interval '90 days'
          AND status IN ('delivered','failed')`);
        const count = await client.query<{
          count: number;
        }>(`SELECT count(*)::int count FROM support_reports
          WHERE delivered_at>now()-interval '1 minute' OR (status='sending' AND lease_until>now())`);
        if (count.rows[0]!.count >= 6) return undefined;
        const claimed = await client.query<{
          id: string;
          user_id: string;
          kind: string;
          body: string;
          app_version: string;
          attempts: number;
        }>(`UPDATE support_reports SET status='sending',attempts=attempts+1,lease_until=now()+interval '5 minutes'
          WHERE id=(SELECT id FROM support_reports WHERE attempts<8 AND
            ((status='pending' AND next_attempt_at<=now()) OR (status='sending' AND lease_until<now()))
            ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`);
        return claimed.rows[0];
      });
      if (!report) return;
      try {
        const account = await db.query<{ username: string }>(
          `SELECT username FROM users WHERE id=$1 AND deleted_at IS NULL`,
          [report.user_id],
        );
        if (!account.rows[0]) {
          await db.query(`DELETE FROM support_reports WHERE id=$1`, [report.id]);
          return;
        }
        await deliver({
          id: report.id,
          kind: report.kind,
          body: report.body,
          userId: report.user_id,
          username: account.rows[0].username,
          version: report.app_version,
        });
        await db.query(
          `UPDATE support_reports SET status='delivered',delivered_at=now(),lease_until=NULL WHERE id=$1`,
          [report.id],
        );
      } catch {
        await db.query(
          `UPDATE support_reports SET status=CASE WHEN attempts>=8 THEN 'failed' ELSE 'pending' END,
          next_attempt_at=now()+make_interval(secs=>LEAST(3600,30*power(2,attempts)::int)),lease_until=NULL WHERE id=$1`,
          [report.id],
        );
        if (report.attempts >= 8)
          await addServiceNotice(
            report.user_id,
            'delivery-failed',
            `Не удалось доставить обращение №${report.id.slice(0, 8)} по почте. Оно сохранено в системе. Попробуйте связаться с командой позже.`,
            `delivery-failed:${report.id}`,
          );
      }
    } catch {
      app.log.error('Support delivery queue failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 15_000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
  return tick;
}

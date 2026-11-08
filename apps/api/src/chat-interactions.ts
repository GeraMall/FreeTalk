import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from './db.js';
import { chatRealtimeHub } from './chat-realtime.js';
import { publicApiUrl } from './env.js';
import type { AuthenticatedUser } from './auth-service.js';
type RequireUser = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<AuthenticatedUser | null>;
const params = z.object({ chatId: z.string().uuid() });
async function audience(chatId: string, userId: string) {
  const result = await db.query<{ user_id: string }>(
    `SELECT member.user_id FROM chat_members member JOIN chats c ON c.id=member.chat_id
 WHERE member.chat_id=$1 AND member.left_at IS NULL
 AND EXISTS(SELECT 1 FROM chat_members self WHERE self.chat_id=c.id AND self.user_id=$2 AND self.left_at IS NULL)
 AND (c.type<>'direct' OR NOT EXISTS(SELECT 1 FROM chat_members other JOIN blocks b ON
 (b.blocker_id=$2 AND b.blocked_id=other.user_id) OR (b.blocker_id=other.user_id AND b.blocked_id=$2)
 WHERE other.chat_id=c.id AND other.left_at IS NULL AND other.user_id<>$2))`,
    [chatId, userId],
  );
  return result.rows.map((row) => row.user_id);
}
export function registerChatInteractions(app: FastifyInstance, requireUser: RequireUser) {
  app.post(
    '/v1/chats/:chatId/typing',
    { config: { rateLimit: { max: 90, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const route = params.safeParse(request.params),
        body = z.object({ active: z.boolean() }).strict().safeParse(request.body);
      if (!route.success || !body.success) return reply.code(400).send({ code: 'INVALID_INPUT' });
      const { chatId } = route.data,
        { active } = body.data;
      const members = await audience(chatId, user.id);
      if (!members.length) return reply.code(403).send({ code: 'NOT_CHAT_MEMBER' });
      chatRealtimeHub.publish(
        members.filter((id) => id !== user.id),
        {
          type: 'chat-typing',
          chatId,
          userId: user.id,
          name: user.display_name,
          expiresAt: active ? Date.now() + 5000 : 0,
        },
      );
      return { ok: true };
    },
  );
  app.post(
    '/v1/chats/:chatId/reads',
    { config: { rateLimit: { max: 90, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const route = params.safeParse(request.params),
        body = z
          .object({ ids: z.array(z.string().uuid()).min(1).max(50) })
          .strict()
          .safeParse(request.body);
      if (!route.success || !body.success) return reply.code(400).send({ code: 'INVALID_INPUT' });
      const { chatId } = route.data,
        { ids } = body.data;
      const members = await audience(chatId, user.id);
      if (!members.length) return reply.code(403).send({ code: 'NOT_CHAT_MEMBER' });
      const inserted = await db.query<{ message_id: string }>(
        `INSERT INTO message_reads(message_id,user_id)
  SELECT id,$2 FROM messages WHERE chat_id=$1 AND id=ANY($3::uuid[]) AND sender_id <> $2
  AND (expires_at IS NULL OR expires_at>now()) AND COALESCE(metadata->>'deleted','false')<>'true'
  ON CONFLICT(message_id,user_id) DO NOTHING RETURNING message_id`,
        [chatId, user.id, [...new Set(ids)]],
      );
      if (inserted.rows.length)
        chatRealtimeHub.publish(members, {
          type: 'chat-reads',
          chatId,
          messageIds: inserted.rows.map((row) => row.message_id),
        });
      return { ok: true };
    },
  );
  app.get('/v1/chats/:chatId/messages/:messageId/readers', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const route = params.extend({ messageId: z.string().uuid() }).safeParse(request.params);
    if (!route.success) return reply.code(400).send({ code: 'INVALID_INPUT' });
    const { chatId, messageId } = route.data;
    if (!(await audience(chatId, user.id)).length)
      return reply.code(403).send({ code: 'NOT_CHAT_MEMBER' });
    const message = await db.query(
      "SELECT 1 FROM messages WHERE id=$1 AND chat_id=$2 AND sender_id=$3 AND (expires_at IS NULL OR expires_at>now()) AND COALESCE(metadata->>'deleted','false')<>'true'",
      [messageId, chatId, user.id],
    );
    if (!message.rowCount) return reply.code(404).send({ code: 'MESSAGE_NOT_FOUND' });
    const readers = await db.query<{
      id: string;
      display_name: string;
      username: string;
      read_at: Date;
      has_avatar: boolean;
      updated_at: Date;
    }>(
      `SELECT u.id,u.display_name,u.username,r.read_at,u.avatar_data IS NOT NULL AS has_avatar,u.updated_at
  FROM message_reads r JOIN users u ON u.id=r.user_id WHERE r.message_id=$1 AND u.deleted_at IS NULL AND u.id<>$2 ORDER BY r.read_at,u.id`,
      [messageId, user.id],
    );
    return {
      readers: readers.rows.map((row) => ({
        id: row.id,
        name: row.display_name,
        username: row.username,
        readAt: row.read_at.toISOString(),
        avatarUrl: row.has_avatar
          ? publicApiUrl('/v1/users/' + row.id + '/avatar?v=' + row.updated_at.getTime())
          : null,
      })),
    };
  });
}

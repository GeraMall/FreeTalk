import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthenticatedUser } from './auth-service.js';
import { db, transaction } from './db.js';
import { chatRealtimeHub } from './chat-realtime.js';

type RequireUser = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<AuthenticatedUser | null>;

export function registerChatCollections(app: FastifyInstance, requireUser: RequireUser) {
  // A saved chat has exactly one member. Upsert plus the unique owner index
  // makes repeated clicks and concurrent sessions return the same notebook.
  app.post('/v1/chats/saved', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const chat = await transaction(async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO chats(type,created_by,retention_hours,is_saved)
         VALUES('direct',$1,NULL,true)
         ON CONFLICT (created_by) WHERE is_saved
         DO UPDATE SET is_saved=true RETURNING id`,
        [user.id],
      );
      const saved = result.rows[0]!;
      await client.query(
        `INSERT INTO chat_members(chat_id,user_id,role,added_by)
         VALUES($1,$2,'owner',$2)
         ON CONFLICT (chat_id,user_id) DO UPDATE SET left_at=NULL,archived_at=NULL`,
        [saved.id, user.id],
      );
      return saved;
    });
    chatRealtimeHub.publish([user.id], { type: 'chat-updated', chatId: chat.id });
    return { chat };
  });

  app.patch('/v1/chats/:chatId/archive', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { chatId } = z.object({ chatId: z.string().uuid() }).parse(request.params);
    const { archived } = z.object({ archived: z.boolean() }).parse(request.body);
    const updated = await db.query(
      `UPDATE chat_members self SET archived_at=CASE WHEN $3 THEN now() ELSE NULL END
       FROM chats chat WHERE self.chat_id=$1 AND self.user_id=$2
       AND self.left_at IS NULL AND chat.id=self.chat_id AND NOT chat.is_saved
       RETURNING self.chat_id`,
      [chatId, user.id, archived],
    );
    if (!updated.rowCount) return reply.code(404).send({ code: 'CHAT_NOT_FOUND' });
    // Archive is a personal preference, never broadcast it to the other members.
    chatRealtimeHub.publish([user.id], { type: 'chat-updated', chatId });
    return { archived };
  });
}

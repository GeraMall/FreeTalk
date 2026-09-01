import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ChatRealtimeServerMessage } from './chat-realtime.js';
import { z } from 'zod';
import type { AuthenticatedUser } from './auth-service.js';
import { db, transaction } from './db.js';
import { publicApiUrl } from './env.js';
import { chatRealtimeHub } from './chat-realtime.js';
import { randomToken, tokenHash, usernameSchema } from './security.js';
import { safeImageDimensions } from './image-dimensions.js';

type RequireUser = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<AuthenticatedUser | null>;

const uuid = z.string().uuid();
const chatIdParams = z.object({ chatId: uuid });
const avatarPositionSchema = z.object({
  positionX: z.coerce.number().int().min(0).max(100),
  positionY: z.coerce.number().int().min(0).max(100),
  scale: z.coerce.number().int().min(100).max(250),
});
type RealtimeChatMessage = Extract<
  ChatRealtimeServerMessage,
  { type: 'message-created' }
>['message'];

interface ChatMessageRow {
  id: string;
  kind: 'text' | 'system' | 'call' | 'image';
  body: string;
  metadata: Record<string, unknown>;
  sender_id: string | null;
  created_at: Date;
  expires_at: Date | null;
}

function realtimeMessage(
  row: ChatMessageRow,
  sender?: { username: string; displayName: string; avatarUrl?: string | null },
): RealtimeChatMessage {
  return {
    ...row,
    username: sender?.username ?? null,
    display_name: sender?.displayName ?? null,
    avatar_url: sender?.avatarUrl ?? null,
    created_at: row.created_at.toISOString(),
    expires_at: row.expires_at?.toISOString() ?? null,
  };
}

export async function publishChatEvent(chatId: string, event: ChatRealtimeServerMessage) {
  const members = await db.query<{ user_id: string }>(
    'SELECT user_id FROM chat_members WHERE chat_id=$1 AND left_at IS NULL',
    [chatId],
  );
  chatRealtimeHub.publish(
    members.rows.map((member) => member.user_id),
    event,
  );
}

async function isChatMember(chatId: string, userId: string) {
  const result = await db.query(
    'SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2 AND left_at IS NULL',
    [chatId, userId],
  );
  return Boolean(result.rowCount);
}

async function isChatAdmin(chatId: string, userId: string) {
  const result = await db.query<{ role: string }>(
    `SELECT role FROM chat_members WHERE chat_id=$1 AND user_id=$2 AND left_at IS NULL`,
    [chatId, userId],
  );
  return ['owner', 'admin'].includes(result.rows[0]?.role ?? '');
}

async function isChatOwner(chatId: string, userId: string) {
  const result = await db.query(
    `SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2 AND role='owner' AND left_at IS NULL`,
    [chatId, userId],
  );
  return Boolean(result.rowCount);
}

async function canInteractInChat(chatId: string, userId: string) {
  const result = await db.query<{ allowed: boolean }>(
    `SELECT CASE WHEN c.type<>'direct' THEN true ELSE NOT EXISTS (
       SELECT 1 FROM chat_members other JOIN blocks b ON
       (b.blocker_id=$2 AND b.blocked_id=other.user_id)
       OR (b.blocker_id=other.user_id AND b.blocked_id=$2)
       WHERE other.chat_id=c.id AND other.left_at IS NULL AND other.user_id<>$2
     ) END AS allowed
     FROM chats c WHERE c.id=$1`,
    [chatId, userId],
  );
  return result.rows[0]?.allowed === true;
}

async function isGroupChat(chatId: string) {
  const result = await db.query("SELECT 1 FROM chats WHERE id=$1 AND type='group'", [chatId]);
  return Boolean(result.rowCount);
}

export function registerSocialRoutes(app: FastifyInstance, requireUser: RequireUser) {
  app.get('/v1/users/search', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { username } = z.object({ username: usernameSchema }).parse(request.query);
    const result = await db.query(
      `SELECT id,username,display_name,avatar_data IS NOT NULL AS has_avatar,updated_at
       FROM users WHERE username=$1 AND id<>$2 AND deleted_at IS NULL`,
      [username, user.id],
    );
    return {
      users: result.rows.map((row) => ({
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.has_avatar
          ? publicApiUrl(`/v1/users/${row.id}/avatar?v=${row.updated_at.getTime()}`)
          : null,
        presence: chatRealtimeHub.presence(row.id),
      })),
    };
  });

  app.get('/v1/friends', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const [friends, pending, blocked] = await Promise.all([
      db.query(
        `SELECT u.id,u.username,u.display_name,u.avatar_data IS NOT NULL AS has_avatar,u.updated_at
         FROM friendships f JOIN users u ON u.id=CASE WHEN f.user_low_id=$1 THEN f.user_high_id ELSE f.user_low_id END
         WHERE (f.user_low_id=$1 OR f.user_high_id=$1) AND u.deleted_at IS NULL
         ORDER BY lower(u.display_name)`,
        [user.id],
      ),
      db.query(
        `SELECT r.id,r.sender_id,r.recipient_id,r.created_at,u.id AS profile_id,u.username,u.display_name,
         u.avatar_data IS NOT NULL AS has_avatar,u.updated_at
         FROM friend_requests r JOIN users u ON u.id=CASE WHEN r.sender_id=$1 THEN r.recipient_id ELSE r.sender_id END
         WHERE (r.sender_id=$1 OR r.recipient_id=$1) AND r.status='pending' ORDER BY r.created_at DESC`,
        [user.id],
      ),
      db.query(
        `SELECT u.id,u.username,u.display_name,b.created_at,u.avatar_data IS NOT NULL AS has_avatar,u.updated_at
         FROM blocks b JOIN users u ON u.id=b.blocked_id
         WHERE b.blocker_id=$1 ORDER BY b.created_at DESC`,
        [user.id],
      ),
    ]);
    return {
      friends: friends.rows.map((row) => ({
        ...row,
        avatarUrl: row.has_avatar
          ? publicApiUrl(`/v1/users/${row.id}/avatar?v=${row.updated_at.getTime()}`)
          : null,
        presence: chatRealtimeHub.presence(row.id),
      })),
      pending: pending.rows.map((row) => ({
        ...row,
        avatarUrl: row.has_avatar
          ? publicApiUrl(`/v1/users/${row.profile_id}/avatar?v=${row.updated_at.getTime()}`)
          : null,
        presence: chatRealtimeHub.presence(row.profile_id),
      })),
      blocked: blocked.rows.map((row) => ({
        ...row,
        avatarUrl: row.has_avatar
          ? publicApiUrl(`/v1/users/${row.id}/avatar?v=${row.updated_at.getTime()}`)
          : null,
        presence: chatRealtimeHub.presence(row.id),
      })),
    };
  });

  app.post(
    '/v1/friends/requests',
    { config: { rateLimit: { max: 12, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const { username } = z.object({ username: usernameSchema }).parse(request.body);
      const target = await db.query<{ id: string }>(
        'SELECT id FROM users WHERE username=$1 AND deleted_at IS NULL',
        [username],
      );
      const targetId = target.rows[0]?.id;
      if (!targetId) return reply.code(404).send({ code: 'USER_NOT_FOUND' });
      if (targetId === user.id) return reply.code(400).send({ code: 'SELF_REQUEST' });
      const prohibited = await db.query(
        `SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)
       UNION ALL SELECT 1 FROM friendships WHERE user_low_id=LEAST($1::uuid,$2::uuid) AND user_high_id=GREATEST($1::uuid,$2::uuid)`,
        [user.id, targetId],
      );
      if (prohibited.rowCount) return reply.code(409).send({ code: 'REQUEST_NOT_ALLOWED' });
      const result = await db.query(
        `INSERT INTO friend_requests(sender_id,recipient_id) VALUES($1,$2) RETURNING id,created_at`,
        [user.id, targetId],
      );
      return reply.code(201).send({ request: result.rows[0] });
    },
  );

  app.post('/v1/friends/requests/:id/:action', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id, action } = z
      .object({ id: uuid, action: z.enum(['accept', 'decline']) })
      .parse(request.params);
    const resolved = await transaction(async (client) => {
      const found = await client.query<{ sender_id: string; recipient_id: string }>(
        `SELECT sender_id,recipient_id FROM friend_requests
         WHERE id=$1 AND recipient_id=$2 AND status='pending' FOR UPDATE`,
        [id, user.id],
      );
      const row = found.rows[0];
      if (!row) return false;
      await client.query(`UPDATE friend_requests SET status=$1,resolved_at=now() WHERE id=$2`, [
        action === 'accept' ? 'accepted' : 'declined',
        id,
      ]);
      if (action === 'accept')
        await client.query(
          `INSERT INTO friendships(user_low_id,user_high_id)
           VALUES(LEAST($1::uuid,$2::uuid),GREATEST($1::uuid,$2::uuid)) ON CONFLICT DO NOTHING`,
          [row.sender_id, row.recipient_id],
        );
      return true;
    });
    return resolved ? { status: action } : reply.code(404).send({ code: 'REQUEST_NOT_FOUND' });
  });

  app.delete('/v1/friends/:userId', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { userId } = z.object({ userId: uuid }).parse(request.params);
    await db.query(
      `DELETE FROM friendships WHERE user_low_id=LEAST($1::uuid,$2::uuid) AND user_high_id=GREATEST($1::uuid,$2::uuid)`,
      [user.id, userId],
    );
    return reply.code(204).send();
  });

  app.post('/v1/blocks/:userId', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { userId } = z.object({ userId: uuid }).parse(request.params);
    if (userId === user.id) return reply.code(400).send({ code: 'SELF_BLOCK' });
    await transaction(async (client) => {
      await client.query(
        'INSERT INTO blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [user.id, userId],
      );
      await client.query(
        `DELETE FROM friendships WHERE user_low_id=LEAST($1::uuid,$2::uuid) AND user_high_id=GREATEST($1::uuid,$2::uuid)`,
        [user.id, userId],
      );
      await client.query(
        `UPDATE friend_requests SET status='cancelled',resolved_at=now()
         WHERE status='pending' AND ((sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1))`,
        [user.id, userId],
      );
    });
    return reply.code(204).send();
  });

  app.delete('/v1/blocks/:userId', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { userId } = z.object({ userId: uuid }).parse(request.params);
    await db.query('DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2', [user.id, userId]);
    return reply.code(204).send();
  });

  app.get('/v1/users/:userId/profile', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { userId } = z.object({ userId: uuid }).parse(request.params);
    const visible = await db.query(
      `SELECT 1 WHERE $1::uuid=$2::uuid OR EXISTS (
         SELECT 1 FROM friendships
         WHERE user_low_id=LEAST($1::uuid,$2::uuid)
           AND user_high_id=GREATEST($1::uuid,$2::uuid)
       ) OR EXISTS (
         SELECT 1 FROM chat_members mine JOIN chat_members theirs ON theirs.chat_id=mine.chat_id
         WHERE mine.user_id=$1 AND theirs.user_id=$2
           AND mine.left_at IS NULL AND theirs.left_at IS NULL
       )`,
      [user.id, userId],
    );
    if (!visible.rowCount) return reply.code(404).send({ code: 'PROFILE_NOT_FOUND' });
    const blocked = await db.query(
      `SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2)
       OR (blocker_id=$2 AND blocked_id=$1)`,
      [user.id, userId],
    );
    if (blocked.rowCount) return reply.code(403).send({ code: 'BLOCKED_RELATIONSHIP' });
    const profile = await db.query<{
      id: string;
      username: string;
      display_name: string;
      bio: string | null;
      has_avatar: boolean;
      has_cover: boolean;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id,username,display_name,bio,avatar_data IS NOT NULL AS has_avatar,
       cover_data IS NOT NULL AS has_cover,created_at,updated_at
       FROM users WHERE id=$1 AND deleted_at IS NULL`,
      [userId],
    );
    if (!profile.rows[0]) return reply.code(404).send({ code: 'PROFILE_NOT_FOUND' });
    const mutual = await db.query<{
      id: string;
      display_name: string;
      has_avatar: boolean;
      updated_at: Date;
    }>(
      `WITH my_friends AS (
         SELECT CASE WHEN user_low_id=$1 THEN user_high_id ELSE user_low_id END AS id
         FROM friendships WHERE user_low_id=$1 OR user_high_id=$1
       ), target_friends AS (
         SELECT CASE WHEN user_low_id=$2 THEN user_high_id ELSE user_low_id END AS id
         FROM friendships WHERE user_low_id=$2 OR user_high_id=$2
       )
       SELECT u.id,u.display_name,u.avatar_data IS NOT NULL AS has_avatar,u.updated_at
       FROM my_friends m JOIN target_friends t USING(id) JOIN users u ON u.id=m.id
       WHERE u.deleted_at IS NULL ORDER BY lower(u.display_name)`,
      [user.id, userId],
    );
    const row = profile.rows[0];
    return {
      profile: {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        bio: row.bio,
        avatarUrl: row.has_avatar
          ? publicApiUrl(`/v1/users/${row.id}/avatar?v=${row.updated_at.getTime()}`)
          : null,
        coverUrl: row.has_cover
          ? publicApiUrl(`/v1/users/${row.id}/cover?v=${row.updated_at.getTime()}`)
          : null,
        registeredAt: row.created_at.toISOString(),
        presence: chatRealtimeHub.presence(row.id),
        mutualFriendsCount: mutual.rowCount ?? 0,
        mutualFriends: mutual.rows.slice(0, 4).map((friend) => ({
          id: friend.id,
          displayName: friend.display_name,
          avatarUrl: friend.has_avatar
            ? publicApiUrl(`/v1/users/${friend.id}/avatar?v=${friend.updated_at.getTime()}`)
            : null,
        })),
      },
    };
  });

  app.get('/v1/chats', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const chats = await db.query(
      `SELECT c.id,c.type,c.title,c.created_at,c.retention_hours AS "retentionHours",
       c.avatar_position_x AS "avatarPositionX",c.avatar_position_y AS "avatarPositionY",
       c.avatar_scale AS "avatarScale",
       CASE WHEN c.avatar_data IS NOT NULL THEN $2::text || '/v1/chats/' || c.id ||
         '/avatar?v=' || (extract(epoch FROM c.avatar_updated_at)*1000)::bigint::text ELSE NULL END AS "avatarUrl",
       self.role AS "currentUserRole",
       latest.body AS "lastMessage",latest.created_at AS "lastMessageAt",latest.kind AS "lastMessageKind",
       COALESCE(json_agg(json_build_object('id',u.id,'username',u.username,'displayName',u.display_name,
         'role',members.role,
         'avatarUrl',CASE WHEN u.avatar_data IS NOT NULL THEN $2::text || '/v1/users/' || u.id ||
         '/avatar?v=' || (extract(epoch FROM u.updated_at)*1000)::bigint::text ELSE NULL END))
         FILTER (WHERE u.id IS NOT NULL),'[]') AS members
       FROM chat_members self JOIN chats c ON c.id=self.chat_id
       JOIN chat_members members ON members.chat_id=c.id AND members.left_at IS NULL
       JOIN users u ON u.id=members.user_id
       LEFT JOIN LATERAL (
         SELECT m.body,m.created_at,m.kind FROM messages m
         WHERE m.chat_id=c.id AND (m.expires_at IS NULL OR m.expires_at>now())
         ORDER BY m.created_at DESC LIMIT 1
       ) latest ON true
       WHERE self.user_id=$1 AND self.left_at IS NULL
       AND (c.type<>'direct' OR NOT EXISTS (
         SELECT 1 FROM chat_members other JOIN blocks b ON
         (b.blocker_id=$1 AND b.blocked_id=other.user_id)
         OR (b.blocker_id=other.user_id AND b.blocked_id=$1)
         WHERE other.chat_id=c.id AND other.left_at IS NULL AND other.user_id<>$1
       ))
       GROUP BY c.id,self.role,latest.body,latest.created_at,latest.kind
       ORDER BY COALESCE(latest.created_at,c.created_at) DESC`,
      [user.id, publicApiUrl('').replace(/\/$/, '')],
    );
    return {
      chats: chats.rows.map((chat) => ({
        ...chat,
        members: (chat.members as Array<Record<string, unknown>>).map((member) => ({
          ...member,
          presence: chatRealtimeHub.presence(String(member.id)),
        })),
      })),
    };
  });

  app.get('/v1/chats/:chatId/avatar', async (request, reply) => {
    const { chatId } = chatIdParams.parse(request.params);
    const result = await db.query<{ avatar_mime: string; avatar_data: Buffer }>(
      `SELECT avatar_mime,avatar_data FROM chats
       WHERE id=$1 AND type='group' AND avatar_data IS NOT NULL`,
      [chatId],
    );
    const avatar = result.rows[0];
    if (!avatar) return reply.code(404).send({ code: 'NOT_FOUND' });
    return reply
      .header('content-type', avatar.avatar_mime)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('referrer-policy', 'no-referrer')
      .header('cache-control', 'public,max-age=300')
      .send(avatar.avatar_data);
  });

  app.post('/v1/chats/:chatId/avatar', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { chatId } = chatIdParams.parse(request.params);
    const { positionX, positionY, scale } = avatarPositionSchema.parse(request.query);
    if (!(await isGroupChat(chatId))) return reply.code(400).send({ code: 'GROUP_CHAT_REQUIRED' });
    if (!(await isChatAdmin(chatId, user.id)))
      return reply.code(403).send({ code: 'CHAT_ADMIN_REQUIRED' });
    const file = await request.file();
    if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype))
      return reply.code(400).send({ code: 'INVALID_IMAGE', message: 'Допустимы PNG, JPEG и WebP' });
    const bytes = await file.toBuffer();
    if (bytes.length > 1_572_864)
      return reply
        .code(413)
        .send({ code: 'PAYLOAD_TOO_LARGE', message: 'Аватар должен быть не больше 1,5 МБ' });
    const signatures = [
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
      bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP',
    ];
    const dimensions = safeImageDimensions(bytes);
    if (
      !signatures.some(Boolean) ||
      !dimensions.width ||
      !dimensions.height ||
      dimensions.width < 64 ||
      dimensions.height < 64 ||
      dimensions.width > 4096 ||
      dimensions.height > 4096
    )
      return reply.code(400).send({ code: 'INVALID_IMAGE', message: 'Некорректное изображение' });
    const systemMessage = await transaction(async (client) => {
      await client.query(
        `UPDATE chats SET avatar_mime=$1,avatar_data=$2,avatar_position_x=$3,
         avatar_position_y=$4,avatar_scale=$5,avatar_updated_at=now() WHERE id=$6`,
        [file.mimetype, bytes, positionX, positionY, scale, chatId],
      );
      const created = await client.query<ChatMessageRow>(
        `INSERT INTO messages(chat_id,kind,body,metadata,expires_at)
         SELECT $1,'system',$2,$3,CASE WHEN c.retention_hours IS NULL THEN NULL
           ELSE now()+make_interval(hours=>c.retention_hours) END
         FROM chats c WHERE c.id=$1
         RETURNING id,kind,body,metadata,sender_id,created_at,expires_at`,
        [
          chatId,
          `${user.display_name} обновил(а) фотографию группы`,
          { changedBy: user.id, event: 'group-avatar-updated' },
        ],
      );
      return realtimeMessage(created.rows[0]!);
    });
    const avatarUrl = publicApiUrl(`/v1/chats/${chatId}/avatar?v=${Date.now()}`);
    await publishChatEvent(chatId, {
      type: 'chat-updated',
      chatId,
      avatarUrl,
      avatarPositionX: positionX,
      avatarPositionY: positionY,
      avatarScale: scale,
    });
    await publishChatEvent(chatId, { type: 'message-created', chatId, message: systemMessage });
    return {
      avatarUrl,
      avatarPositionX: positionX,
      avatarPositionY: positionY,
      avatarScale: scale,
    };
  });

  app.patch('/v1/chats/:chatId/avatar', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { chatId } = chatIdParams.parse(request.params);
    const { positionX, positionY, scale } = avatarPositionSchema.parse(request.body);
    if (!(await isGroupChat(chatId))) return reply.code(400).send({ code: 'GROUP_CHAT_REQUIRED' });
    if (!(await isChatAdmin(chatId, user.id)))
      return reply.code(403).send({ code: 'CHAT_ADMIN_REQUIRED' });
    const updated = await db.query<{ avatar_updated_at: Date }>(
      `UPDATE chats SET avatar_position_x=$1,avatar_position_y=$2,avatar_scale=$3
       WHERE id=$4 AND avatar_data IS NOT NULL RETURNING avatar_updated_at`,
      [positionX, positionY, scale, chatId],
    );
    if (!updated.rows[0]) return reply.code(404).send({ code: 'CHAT_AVATAR_NOT_FOUND' });
    const avatarUrl = publicApiUrl(
      `/v1/chats/${chatId}/avatar?v=${updated.rows[0].avatar_updated_at.getTime()}`,
    );
    await publishChatEvent(chatId, {
      type: 'chat-updated',
      chatId,
      avatarUrl,
      avatarPositionX: positionX,
      avatarPositionY: positionY,
      avatarScale: scale,
    });
    return {
      avatarUrl,
      avatarPositionX: positionX,
      avatarPositionY: positionY,
      avatarScale: scale,
    };
  });

  app.post('/v1/chats', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const input = z
      .object({
        type: z.enum(['direct', 'group']),
        title: z.string().trim().max(80).optional(),
        memberIds: z.array(uuid).max(49),
      })
      .parse(request.body);
    const memberIds = [...new Set([user.id, ...input.memberIds])];
    if (input.type === 'direct' && memberIds.length !== 2)
      return reply.code(400).send({ code: 'DIRECT_REQUIRES_TWO_MEMBERS' });
    if (input.type === 'direct') {
      const existing = await db.query<{ id: string }>(
        `SELECT c.id FROM chats c JOIN chat_members a ON a.chat_id=c.id AND a.user_id=$1 AND a.left_at IS NULL
         JOIN chat_members b ON b.chat_id=c.id AND b.user_id=$2 AND b.left_at IS NULL
         WHERE c.type='direct' AND (SELECT count(*) FROM chat_members m WHERE m.chat_id=c.id AND m.left_at IS NULL)=2
         LIMIT 1`,
        [memberIds[0], memberIds[1]],
      );
      if (existing.rows[0]) return reply.send({ chat: existing.rows[0], existing: true });
    }
    const requestedFriendIds = memberIds.filter((memberId) => memberId !== user.id);
    const acceptedFriends = await db.query<{ id: string }>(
      `SELECT u.id FROM friendships f
       JOIN users u ON u.id=CASE WHEN f.user_low_id=$1 THEN f.user_high_id ELSE f.user_low_id END
       WHERE (f.user_low_id=$1 OR f.user_high_id=$1)
       AND u.id=ANY($2::uuid[]) AND u.deleted_at IS NULL`,
      [user.id, requestedFriendIds],
    );
    if (acceptedFriends.rowCount !== requestedFriendIds.length)
      return reply.code(403).send({ code: 'FRIENDS_ONLY' });
    const blocked = await db.query(
      `SELECT 1 FROM blocks WHERE blocker_id=ANY($1::uuid[]) AND blocked_id=ANY($1::uuid[]) LIMIT 1`,
      [memberIds],
    );
    if (blocked.rowCount) return reply.code(403).send({ code: 'BLOCKED_RELATIONSHIP' });
    const chat = await transaction(async (client) => {
      const created = await client.query<{ id: string }>(
        'INSERT INTO chats(type,title,created_by) VALUES($1,$2,$3) RETURNING id',
        [input.type, input.type === 'group' ? (input.title ?? null) : null, user.id],
      );
      for (const memberId of memberIds)
        await client.query(
          `INSERT INTO chat_members(chat_id,user_id,role,added_by) VALUES($1,$2,$3,$4)`,
          [created.rows[0]!.id, memberId, memberId === user.id ? 'owner' : 'member', user.id],
        );
      return created.rows[0];
    });
    return reply.code(201).send({ chat });
  });

  app.get('/v1/chats/:chatId/messages', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { chatId } = chatIdParams.parse(request.params);
    const { before } = z
      .object({ before: z.string().datetime({ offset: true }).optional() })
      .parse(request.query);
    if (!(await isChatMember(chatId, user.id)))
      return reply.code(403).send({ code: 'NOT_CHAT_MEMBER' });
    if (!(await canInteractInChat(chatId, user.id)))
      return reply.code(403).send({ code: 'BLOCKED_RELATIONSHIP' });
    const messages = await db.query(
      `WITH recent AS (
         SELECT m.id,m.kind,m.body,m.metadata,m.created_at,m.expires_at,m.sender_id
         FROM messages m
         WHERE m.chat_id=$1 AND (m.expires_at IS NULL OR m.expires_at>now())
           AND ($2::timestamptz IS NULL OR m.created_at<$2)
         ORDER BY m.created_at DESC LIMIT 101
       )
       SELECT recent.*,u.username,u.display_name,u.avatar_data IS NOT NULL AS has_avatar,u.updated_at
       FROM recent LEFT JOIN users u ON u.id=recent.sender_id
       ORDER BY recent.created_at ASC`,
      [chatId, before ?? null],
    );
    const retention = await db.query<{ retention_hours: number | null }>(
      'SELECT retention_hours FROM chats WHERE id=$1',
      [chatId],
    );
    const hasMore = messages.rows.length > 100;
    const visibleMessages = hasMore ? messages.rows.slice(1) : messages.rows;
    return {
      messages: visibleMessages.map((message) => ({
        ...message,
        avatar_url: message.has_avatar
          ? publicApiUrl(`/v1/users/${message.sender_id}/avatar?v=${message.updated_at.getTime()}`)
          : null,
      })),
      hasMore,
      retentionHours: retention.rows[0]?.retention_hours ?? null,
    };
  });

  app.post(
    '/v1/chats/:chatId/messages',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const { chatId } = chatIdParams.parse(request.params);
      const { body } = z.object({ body: z.string().trim().min(1).max(4000) }).parse(request.body);
      if (!(await isChatMember(chatId, user.id)))
        return reply.code(403).send({ code: 'NOT_CHAT_MEMBER' });
      if (!(await canInteractInChat(chatId, user.id)))
        return reply.code(403).send({ code: 'BLOCKED_RELATIONSHIP' });
      const result = await db.query<ChatMessageRow>(
        `INSERT INTO messages(chat_id,sender_id,body,expires_at)
         SELECT $1,$2,$3,CASE WHEN c.retention_hours IS NULL THEN NULL
           ELSE now()+make_interval(hours=>c.retention_hours) END
         FROM chats c WHERE c.id=$1
       RETURNING id,kind,body,metadata,sender_id,created_at,expires_at`,
        [chatId, user.id, body],
      );
      const message = realtimeMessage(result.rows[0]!, {
        username: user.username,
        displayName: user.display_name,
        avatarUrl: user.avatar_data
          ? publicApiUrl(`/v1/users/${user.id}/avatar?v=${user.updated_at.getTime()}`)
          : null,
      });
      await publishChatEvent(chatId, { type: 'message-created', chatId, message });
      return reply.code(201).send({ message });
    },
  );

  app.get('/v1/messages/:messageId/image', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { messageId } = z.object({ messageId: uuid }).parse(request.params);
    const { variant } = z
      .object({ variant: z.enum(['full', 'thumbnail']).default('full') })
      .parse(request.query);
    const result = await db.query<{ mime: string; data: Buffer }>(
      `SELECT CASE WHEN $3='thumbnail' THEN COALESCE(image.thumbnail_mime,image.mime)
                   ELSE image.mime END mime,
              CASE WHEN $3='thumbnail' THEN COALESCE(image.thumbnail_data,image.data)
                   ELSE image.data END data
       FROM message_images image
       JOIN messages message ON message.id=image.message_id
       JOIN chat_members member ON member.chat_id=message.chat_id
          AND member.user_id=$2 AND member.left_at IS NULL
       WHERE image.message_id=$1 AND (message.expires_at IS NULL OR message.expires_at>now())`,
      [messageId, user.id, variant],
    );
    const image = result.rows[0];
    if (!image) return reply.code(404).send({ code: 'IMAGE_NOT_FOUND' });
    return reply
      .header('content-type', image.mime)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('referrer-policy', 'no-referrer')
      .header('cache-control', 'private,max-age=300')
      .send(image.data);
  });

  app.post(
    '/v1/chats/:chatId/images',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const { chatId } = chatIdParams.parse(request.params);
      const { caption } = z
        .object({ caption: z.string().trim().max(1000).optional() })
        .parse(request.query);
      if (!(await isChatMember(chatId, user.id)))
        return reply.code(403).send({ code: 'NOT_CHAT_MEMBER' });
      if (!(await canInteractInChat(chatId, user.id)))
        return reply.code(403).send({ code: 'BLOCKED_RELATIONSHIP' });
      let imageFile: { mime: string; bytes: Buffer } | undefined;
      let thumbnailFile: { mime: string; bytes: Buffer } | undefined;
      for await (const part of request.parts()) {
        if (part.type !== 'file') continue;
        const candidate = { mime: part.mimetype, bytes: await part.toBuffer() };
        if (part.fieldname === 'image') imageFile = candidate;
        if (part.fieldname === 'thumbnail') thumbnailFile = candidate;
      }
      if (!imageFile || !['image/png', 'image/jpeg', 'image/webp'].includes(imageFile.mime))
        return reply.code(400).send({
          code: 'INVALID_IMAGE',
          message: 'Для отправки доступны изображения PNG, JPEG и WebP',
        });
      if (
        thumbnailFile &&
        (!['image/jpeg', 'image/webp'].includes(thumbnailFile.mime) ||
          thumbnailFile.bytes.length > 256 * 1024)
      )
        return reply.code(400).send({
          code: 'INVALID_IMAGE_THUMBNAIL',
          message: 'Некорректная миниатюра изображения',
        });
      if (thumbnailFile) {
        const thumbnailDimensions = safeImageDimensions(thumbnailFile.bytes);
        if (
          !thumbnailDimensions.width ||
          !thumbnailDimensions.height ||
          thumbnailDimensions.width > 1024 ||
          thumbnailDimensions.height > 1024
        )
          return reply.code(400).send({
            code: 'INVALID_IMAGE_THUMBNAIL',
            message: 'Некорректная миниатюра изображения',
          });
      }
      const bytes = imageFile.bytes;
      const dimensions = safeImageDimensions(bytes);
      if (
        !dimensions.width ||
        !dimensions.height ||
        dimensions.width > 8192 ||
        dimensions.height > 8192
      )
        return reply.code(400).send({ code: 'INVALID_IMAGE', message: 'Некорректное изображение' });
      const created = await transaction(async (client) => {
        const message = await client.query<ChatMessageRow>(
          `INSERT INTO messages(chat_id,sender_id,kind,body,metadata,expires_at)
           SELECT $1,$2,'image',$3,$4,CASE WHEN c.retention_hours IS NULL THEN NULL
             ELSE now()+make_interval(hours=>c.retention_hours) END
           FROM chats c WHERE c.id=$1
           RETURNING id,kind,body,metadata,sender_id,created_at,expires_at`,
          [chatId, user.id, caption ?? '', { width: dimensions.width, height: dimensions.height }],
        );
        await client.query(
          `INSERT INTO message_images(
             message_id,mime,data,width,height,thumbnail_mime,thumbnail_data
           ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            message.rows[0]!.id,
            imageFile.mime,
            bytes,
            dimensions.width,
            dimensions.height,
            thumbnailFile?.mime ?? null,
            thumbnailFile?.bytes ?? null,
          ],
        );
        return realtimeMessage(message.rows[0]!, {
          username: user.username,
          displayName: user.display_name,
          avatarUrl: user.avatar_data
            ? publicApiUrl(`/v1/users/${user.id}/avatar?v=${user.updated_at.getTime()}`)
            : null,
        });
      });
      await publishChatEvent(chatId, { type: 'message-created', chatId, message: created });
      return reply.code(201).send({ message: created });
    },
  );

  app.post(
    '/v1/chats/:chatId/members',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const { chatId } = chatIdParams.parse(request.params);
      const { username } = z.object({ username: usernameSchema }).parse(request.body);
      if (!(await isChatAdmin(chatId, user.id)))
        return reply.code(403).send({ code: 'NOT_CHAT_ADMIN' });
      if (!(await isGroupChat(chatId))) return reply.code(400).send({ code: 'GROUP_MEMBERS_ONLY' });
      const added = await transaction(async (client) => {
        const target = await client.query<{ id: string; display_name: string }>(
          'SELECT id,display_name FROM users WHERE username=$1 AND deleted_at IS NULL',
          [username],
        );
        const targetUser = target.rows[0];
        if (!targetUser || targetUser.id === user.id) return null;
        const relationship = await client.query(
          `SELECT 1 FROM friendships WHERE user_low_id=LEAST($1::uuid,$2::uuid)
           AND user_high_id=GREATEST($1::uuid,$2::uuid)`,
          [user.id, targetUser.id],
        );
        const blocked = await client.query(
          `SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2)
           OR (blocker_id=$2 AND blocked_id=$1)`,
          [user.id, targetUser.id],
        );
        if (!relationship.rowCount || blocked.rowCount) return null;
        await client.query(
          `INSERT INTO chat_members(chat_id,user_id,role,added_by) VALUES($1,$2,'member',$3)
           ON CONFLICT(chat_id,user_id) DO UPDATE SET left_at=NULL,joined_at=now(),added_by=$3`,
          [chatId, targetUser.id, user.id],
        );
        const systemMessage = await client.query<ChatMessageRow>(
          `INSERT INTO messages(chat_id,kind,body,metadata,expires_at)
           SELECT $1,'system',$2,$3,CASE WHEN c.retention_hours IS NULL THEN NULL
             ELSE now()+make_interval(hours=>c.retention_hours) END
           FROM chats c WHERE c.id=$1
           RETURNING id,kind,body,metadata,sender_id,created_at,expires_at`,
          [
            chatId,
            `${user.display_name} добавил ${targetUser.display_name}`,
            { addedBy: user.id, userId: targetUser.id },
          ],
        );
        return { targetUser, message: realtimeMessage(systemMessage.rows[0]!) };
      });
      if (!added) return reply.code(403).send({ code: 'FRIEND_REQUIRED' });
      await publishChatEvent(chatId, { type: 'message-created', chatId, message: added.message });
      return reply.code(201).send({ member: added.targetUser });
    },
  );

  app.delete('/v1/chats/:chatId/members/me', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { chatId } = chatIdParams.parse(request.params);
    const membership = await db.query<{ role: string; type: string; member_count: number }>(
      `SELECT self.role,c.type,
       (SELECT count(*)::int FROM chat_members m WHERE m.chat_id=c.id AND m.left_at IS NULL) AS member_count
       FROM chats c JOIN chat_members self ON self.chat_id=c.id
       WHERE c.id=$1 AND self.user_id=$2 AND self.left_at IS NULL`,
      [chatId, user.id],
    );
    const row = membership.rows[0];
    if (!row) return reply.code(404).send({ code: 'CHAT_NOT_FOUND' });
    if (row.role === 'owner' && row.type === 'group' && row.member_count > 1)
      return reply
        .code(409)
        .send({ code: 'OWNER_TRANSFER_REQUIRED', message: 'Сначала передайте права владельца' });
    await db.query(
      'UPDATE chat_members SET left_at=now() WHERE chat_id=$1 AND user_id=$2 AND left_at IS NULL',
      [chatId, user.id],
    );
    return reply.code(204).send();
  });

  app.post(
    '/v1/chats/:chatId/invites',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const { chatId } = chatIdParams.parse(request.params);
      const input = z
        .object({
          expiresInHours: z.number().int().min(1).max(720).optional(),
          maxUses: z.number().int().min(1).max(1000).optional(),
        })
        .parse(request.body);
      if (!(await isChatAdmin(chatId, user.id)))
        return reply.code(403).send({ code: 'NOT_CHAT_ADMIN' });
      if (!(await isGroupChat(chatId))) return reply.code(400).send({ code: 'GROUP_INVITES_ONLY' });
      const token = randomToken(32);
      const result = await db.query(
        `INSERT INTO chat_invites(chat_id,token_hash,created_by,expires_at,max_uses)
       VALUES($1,$2,$3,CASE WHEN $4::int IS NULL THEN NULL ELSE now()+make_interval(hours=>$4) END,$5)
       RETURNING id,expires_at,max_uses`,
        [chatId, tokenHash(token), user.id, input.expiresInHours ?? null, input.maxUses ?? null],
      );
      return reply.code(201).send({ invite: { ...result.rows[0], token } });
    },
  );

  app.get('/v1/chat-invites/:token/preview', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { token } = z.object({ token: z.string().min(32).max(256) }).parse(request.params);
    const result = await db.query<{
      id: string;
      title: string | null;
      member_count: number;
      has_avatar: boolean;
      avatar_updated_at: Date | null;
      avatar_position_x: number;
      avatar_position_y: number;
      avatar_scale: number;
      is_member: boolean;
    }>(
      `SELECT chat.id,chat.title,chat.avatar_data IS NOT NULL AS has_avatar,
       chat.avatar_updated_at,chat.avatar_position_x,chat.avatar_position_y,chat.avatar_scale,
       count(member.user_id)::int AS member_count,
       EXISTS(SELECT 1 FROM chat_members own WHERE own.chat_id=chat.id
         AND own.user_id=$2 AND own.left_at IS NULL) AS is_member
       FROM chat_invites invite JOIN chats chat ON chat.id=invite.chat_id AND chat.type='group'
       JOIN chat_members member ON member.chat_id=chat.id AND member.left_at IS NULL
       WHERE invite.token_hash=$1 AND invite.revoked_at IS NULL
         AND (invite.expires_at IS NULL OR invite.expires_at>now())
         AND (invite.max_uses IS NULL OR invite.use_count<invite.max_uses OR EXISTS(
           SELECT 1 FROM chat_members own WHERE own.chat_id=chat.id
             AND own.user_id=$2 AND own.left_at IS NULL))
       GROUP BY chat.id
       LIMIT 1`,
      [tokenHash(token), user.id],
    );
    const preview = result.rows[0];
    if (!preview)
      return reply.code(404).send({
        code: 'INVALID_INVITE',
        message: 'Ссылка-приглашение недействительна или устарела',
      });
    return {
      chat: {
        id: preview.id,
        title: preview.title || 'Групповой чат',
        memberCount: preview.member_count,
        avatarUrl: preview.has_avatar
          ? publicApiUrl(
              `/v1/chats/${preview.id}/avatar?v=${preview.avatar_updated_at?.getTime() ?? 0}`,
            )
          : null,
        avatarPositionX: preview.avatar_position_x,
        avatarPositionY: preview.avatar_position_y,
        avatarScale: preview.avatar_scale,
        isMember: preview.is_member,
      },
    };
  });

  app.post('/v1/chat-invites/:token/join', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { token } = z.object({ token: z.string().min(32).max(256) }).parse(request.params);
    const joined = await transaction(async (client) => {
      const found = await client.query<{
        id: string;
        chat_id: string;
        max_uses: number | null;
        use_count: number;
      }>(
        `SELECT id,chat_id,max_uses,use_count FROM chat_invites WHERE token_hash=$1 AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE`,
        [tokenHash(token)],
      );
      const invite = found.rows[0];
      if (!invite) return null;
      const existingMember = await client.query(
        `SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2 AND left_at IS NULL`,
        [invite.chat_id, user.id],
      );
      if (existingMember.rowCount) return { chatId: invite.chat_id, message: null };
      if (invite.max_uses !== null && invite.use_count >= invite.max_uses) return null;
      const blocked = await client.query(
        `SELECT 1 FROM chat_members m JOIN blocks b ON
         (b.blocker_id=m.user_id AND b.blocked_id=$1) OR (b.blocker_id=$1 AND b.blocked_id=m.user_id)
         WHERE m.chat_id=$2 AND m.left_at IS NULL LIMIT 1`,
        [user.id, invite.chat_id],
      );
      if (blocked.rowCount) return null;
      await client.query(
        `INSERT INTO chat_members(chat_id,user_id,role) VALUES($1,$2,'member')
         ON CONFLICT(chat_id,user_id) DO UPDATE SET left_at=NULL,joined_at=now()`,
        [invite.chat_id, user.id],
      );
      await client.query('UPDATE chat_invites SET use_count=use_count+1 WHERE id=$1', [invite.id]);
      const systemMessage = await client.query<ChatMessageRow>(
        `INSERT INTO messages(chat_id,kind,body,metadata,expires_at)
         SELECT $1,'system',$2,$3,CASE WHEN c.retention_hours IS NULL THEN NULL
           ELSE now()+make_interval(hours=>c.retention_hours) END
         FROM chats c WHERE c.id=$1
         RETURNING id,kind,body,metadata,sender_id,created_at,expires_at`,
        [invite.chat_id, `${user.display_name} присоединился к чату`, { userId: user.id }],
      );
      return { chatId: invite.chat_id, message: realtimeMessage(systemMessage.rows[0]!) };
    });
    if (!joined) return reply.code(400).send({ code: 'INVALID_INVITE' });
    if (joined.message)
      await publishChatEvent(joined.chatId, {
        type: 'message-created',
        chatId: joined.chatId,
        message: joined.message,
      });
    return { chatId: joined.chatId };
  });

  app.delete('/v1/chats/:chatId/invites/:inviteId', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { chatId, inviteId } = z.object({ chatId: uuid, inviteId: uuid }).parse(request.params);
    if (!(await isChatAdmin(chatId, user.id)))
      return reply.code(403).send({ code: 'NOT_CHAT_ADMIN' });
    await db.query('UPDATE chat_invites SET revoked_at=now() WHERE id=$1 AND chat_id=$2', [
      inviteId,
      chatId,
    ]);
    return reply.code(204).send();
  });

  app.patch('/v1/chats/:chatId/retention', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { chatId } = chatIdParams.parse(request.params);
    const { retentionHours } = z
      .object({
        retentionHours: z.union([z.literal(24), z.literal(168), z.literal(720), z.null()]),
      })
      .parse(request.body);
    if (!(await isChatOwner(chatId, user.id)))
      return reply.code(403).send({ code: 'NOT_CHAT_OWNER' });

    await transaction(async (client) => {
      await client.query('UPDATE chats SET retention_hours=$2 WHERE id=$1', [
        chatId,
        retentionHours,
      ]);
      await client.query(
        `UPDATE messages SET expires_at=CASE WHEN $2::int IS NULL THEN NULL
           ELSE created_at+make_interval(hours=>$2) END
         WHERE chat_id=$1 AND (expires_at IS NULL OR expires_at>now())`,
        [chatId, retentionHours],
      );
      await client.query(
        `INSERT INTO analytics_daily_metrics(metric_day,retention_changes)
         VALUES(current_date,1)
         ON CONFLICT(metric_day) DO UPDATE SET retention_changes=analytics_daily_metrics.retention_changes+1`,
      );
    });
    await publishChatEvent(chatId, { type: 'retention-changed', chatId, retentionHours });
    return { retentionHours };
  });

  app.delete('/v1/chats/:chatId/messages', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { chatId } = chatIdParams.parse(request.params);
    if (!(await isChatOwner(chatId, user.id)))
      return reply.code(403).send({ code: 'NOT_CHAT_OWNER' });
    const deleted = await db.query('DELETE FROM messages WHERE chat_id=$1', [chatId]);
    await publishChatEvent(chatId, { type: 'history-cleared', chatId });
    return { deleted: deleted.rowCount ?? 0 };
  });

  app.post('/v1/chats/:chatId/history-votes', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { chatId } = chatIdParams.parse(request.params);
    if (!(await isChatMember(chatId, user.id)))
      return reply.code(403).send({ code: 'NOT_CHAT_MEMBER' });
    return reply.code(410).send({ code: 'RETENTION_SETTINGS_REQUIRED' });
  });

  app.post('/v1/chats/:chatId/calls', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { chatId } = chatIdParams.parse(request.params);
    const { roomId } = z.object({ roomId: z.string().min(8).max(32) }).parse(request.body);
    if (!(await isChatMember(chatId, user.id)))
      return reply.code(403).send({ code: 'NOT_CHAT_MEMBER' });
    if (!(await canInteractInChat(chatId, user.id)))
      return reply.code(403).send({ code: 'BLOCKED_RELATIONSHIP' });
    const callMessage = await transaction(async (client) => {
      const inserted = await client.query<ChatMessageRow>(
        `INSERT INTO messages(chat_id,sender_id,kind,body,metadata,expires_at)
         SELECT $1,$2,'call',$3,$4,CASE WHEN c.retention_hours IS NULL THEN NULL
           ELSE now()+make_interval(hours=>c.retention_hours) END
         FROM chats c WHERE c.id=$1
         RETURNING id,kind,body,metadata,sender_id,created_at,expires_at`,
        [chatId, user.id, `${user.display_name} начал звонок`, { roomId }],
      );
      return realtimeMessage(inserted.rows[0]!, {
        username: user.username,
        displayName: user.display_name,
        avatarUrl: user.avatar_data
          ? publicApiUrl(`/v1/users/${user.id}/avatar?v=${user.updated_at.getTime()}`)
          : null,
      });
    });
    await publishChatEvent(chatId, { type: 'message-created', chatId, message: callMessage });
    return reply.code(201).send({ call: { roomId } });
  });

  app.get('/v1/room-invites/:roomId/preview', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { roomId } = z
      .object({ roomId: z.string().regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/) })
      .parse(request.params);
    const result = await db.query<{
      started_at: Date;
      ended_at: Date | null;
      participant_count: number;
    }>(
      `SELECT session.started_at,session.ended_at,
       (SELECT count(*)::int FROM call_participants participant
        WHERE participant.call_id=session.id AND participant.left_at IS NULL) AS participant_count
       FROM call_sessions session
       WHERE session.room_id=$1
       ORDER BY session.started_at DESC
       LIMIT 1`,
      [roomId],
    );
    const session = result.rows[0];
    const active = Boolean(session && !session.ended_at);
    return {
      room: {
        roomId,
        active,
        startedAt: session?.started_at.toISOString() ?? null,
        participantCount: active ? (session?.participant_count ?? 0) : 0,
      },
    };
  });

  app.get('/v1/history', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const result = await db.query(
      `SELECT c.id,c.room_id,c.room_name,c.started_at,c.ended_at,
       EXTRACT(EPOCH FROM (COALESCE(c.ended_at,now())-c.started_at))::int AS duration_seconds,
       json_agg(json_build_object('displayName',p.display_name,'userId',p.user_id,
         'avatarUrl',CASE WHEN u.avatar_data IS NOT NULL THEN $2::text || '/v1/users/' || u.id ||
         '/avatar?v=' || (extract(epoch FROM u.updated_at)*1000)::bigint::text ELSE NULL END)) AS participants
       FROM call_sessions c
       JOIN LATERAL (
         SELECT DISTINCT ON (COALESCE(cp.user_id::text,cp.anonymous_user_id::text))
           cp.display_name,cp.user_id,cp.anonymous_user_id,cp.joined_at
         FROM call_participants cp WHERE cp.call_id=c.id
         ORDER BY COALESCE(cp.user_id::text,cp.anonymous_user_id::text),cp.joined_at DESC
       ) p ON true
       LEFT JOIN users u ON u.id=p.user_id
       WHERE EXISTS (
         SELECT 1 FROM call_participants self WHERE self.call_id=c.id AND self.user_id=$1
       )
       GROUP BY c.id
       HAVING COUNT(*) >= 2
       ORDER BY c.started_at DESC LIMIT 100`,
      [user.id, publicApiUrl('').replace(/\/$/, '')],
    );
    return { calls: result.rows };
  });

  // Production can call this periodically; the process also performs best-effort cleanup.
  const cleanup = setInterval(() => {
    void db
      .query(
        `WITH expired AS (
           SELECT message.id,message.kind,
                  COALESCE(octet_length(image.data),0)+
                  COALESCE(octet_length(image.thumbnail_data),0) image_bytes
           FROM messages message LEFT JOIN message_images image ON image.message_id=message.id
           WHERE message.expires_at<=now()
         ), deleted AS (
           DELETE FROM messages message USING expired
           WHERE message.id=expired.id
           RETURNING expired.kind,expired.image_bytes
         ), totals AS (
           SELECT count(*) messages_expired,
                  count(*) FILTER(WHERE kind='image') image_messages_expired,
                  COALESCE(sum(image_bytes),0) expired_image_bytes
           FROM deleted
         )
         INSERT INTO analytics_daily_metrics(
           metric_day,messages_expired,image_messages_expired,expired_image_bytes
         ) SELECT current_date,messages_expired,image_messages_expired,expired_image_bytes FROM totals
         ON CONFLICT(metric_day) DO UPDATE SET
           messages_expired=analytics_daily_metrics.messages_expired+EXCLUDED.messages_expired,
           image_messages_expired=analytics_daily_metrics.image_messages_expired+EXCLUDED.image_messages_expired,
           expired_image_bytes=analytics_daily_metrics.expired_image_bytes+EXCLUDED.expired_image_bytes`,
      )
      .catch(() => undefined);
  }, 15 * 60_000);
  cleanup.unref();
}

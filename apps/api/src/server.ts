import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { randomInt } from 'node:crypto';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { z, ZodError } from 'zod';
import {
  authenticate,
  authenticateAccessToken,
  issueSession,
  publicUser,
  recordSecurityEvent,
  rotateSession,
  type UserRow,
} from './auth-service.js';
import { db, transaction } from './db.js';
import { env, publicApiUrl, publicAvatarUrl } from './env.js';
import { sendPasswordReset, sendVerification } from './mailer.js';
import { publishChatEvent, registerSocialRoutes } from './social-routes.js';
import { registerAndroidPush, startAndroidPush } from './android-push.js';
import { chatRealtimeHub } from './chat-realtime.js';
import { safeImageDimensions } from './image-dimensions.js';
import { GUEST_SESSION_SECONDS, guestQuotaAvailable } from './policy.js';
import { registerAdminRoutes } from './admin-routes.js';
import { startInfrastructureSampler } from './infrastructure-metrics.js';
import { registerApiMetrics } from './api-metrics.js';
import { chatRealtimeClientMessageSchema } from '@freetalk/protocol';
import {
  displayNameSchema,
  emailSchema,
  hashIp,
  hashPassword,
  passwordSchema,
  randomToken,
  randomVerificationCode,
  secureSecretEqual,
  tokenHash,
  usernameSchema,
  verifyCaptcha,
  verifyPassword,
} from './security.js';

const TERMS_VERSION = '2026-08-25';
const PRIVACY_VERSION = '2026-08-25';
const app = Fastify({
  logger: {
    redact: {
      paths: ['req.remoteAddress', 'req.remotePort'],
      censor: '[REDACTED]',
    },
  },
  bodyLimit: 64 * 1024,
  trustProxy: true,
});
registerApiMetrics(app);
await app.register(websocket, {
  options: { maxPayload: 8 * 1024, perMessageDeflate: false },
});

const allowedOrigins = env.ALLOWED_ORIGIN.split(',').map((value) => value.trim());
await app.register(cors, {
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
});
await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
await app.register(multipart, {
  // The desktop client reduces the original (up to 25 MB) before upload.
  // Chat images may include a separate lightweight thumbnail.
  limits: { files: 2, fileSize: 3 * 1024 * 1024, fields: 2 },
});

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof ZodError)
    return reply.code(400).send({ code: 'INVALID_INPUT', message: error.issues[0]?.message });
  if (
    typeof error === 'object' &&
    error !== null &&
    (('code' in error && error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') ||
      ('statusCode' in error && error.statusCode === 413))
  )
    return reply
      .code(413)
      .send({ code: 'PAYLOAD_TOO_LARGE', message: 'Размер запроса превышает допустимый' });
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
    return reply.code(409).send({ code: 'ALREADY_EXISTS', message: 'Значение уже используется' });
  app.log.error(error);
  return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка' });
});

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await authenticate(request);
  if (!user) {
    reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Требуется вход' });
    return null;
  }
  if (!user.email_verified_at) {
    reply.code(403).send({ code: 'EMAIL_NOT_VERIFIED', message: 'Подтвердите почту' });
    return null;
  }
  return user;
}

async function publishProfileUpdate(userId: string) {
  const recipients = await db.query<{ user_id: string }>(
    `SELECT $1::uuid AS user_id
     UNION SELECT CASE WHEN user_low_id=$1 THEN user_high_id ELSE user_low_id END
       FROM friendships WHERE user_low_id=$1 OR user_high_id=$1
     UNION SELECT members.user_id FROM chat_members self
       JOIN chat_members members ON members.chat_id=self.chat_id AND members.left_at IS NULL
       WHERE self.user_id=$1 AND self.left_at IS NULL`,
    [userId],
  );
  chatRealtimeHub.publish(
    recipients.rows.map((recipient) => recipient.user_id),
    { type: 'profile-updated', userId },
  );
}

async function publishPresenceUpdate(
  userId: string,
  status: 'online' | 'away' | 'dnd' | 'offline',
) {
  const recipients = await db.query<{ user_id: string }>(
    `SELECT $1::uuid AS user_id
     UNION SELECT CASE WHEN user_low_id=$1 THEN user_high_id ELSE user_low_id END
       FROM friendships WHERE user_low_id=$1 OR user_high_id=$1
     UNION SELECT members.user_id FROM chat_members self
       JOIN chat_members members ON members.chat_id=self.chat_id AND members.left_at IS NULL
       WHERE self.user_id=$1 AND self.left_at IS NULL`,
    [userId],
  );
  chatRealtimeHub.publish(
    recipients.rows.map((recipient) => recipient.user_id),
    { type: 'presence-updated', userId, status },
  );
}

chatRealtimeHub.onPresenceChanged((userId, status) => {
  void db
    .query(
      `INSERT INTO analytics_user_presence(user_id,status,updated_at) VALUES($1,$2,now())
       ON CONFLICT(user_id) DO UPDATE SET status=EXCLUDED.status,updated_at=now()`,
      [userId, status],
    )
    .catch((error) => app.log.warn({ err: error, userId }, 'Failed to persist presence'));
  void publishPresenceUpdate(userId, status).catch((error) =>
    app.log.warn({ err: error, userId }, 'Failed to publish presence update'),
  );
});

app.get('/v1/chats/realtime', { websocket: true }, (socket, request) => {
  const origin = request.headers.origin;
  if (origin && !allowedOrigins.includes(origin)) {
    socket.close(4403, 'Origin is not allowed');
    return;
  }

  let authenticated = false;
  let authenticationStarted = false;
  let authenticatedUserId: string | undefined;
  let removeFromHub: (() => void) | undefined;
  let heartbeatAlive = true;
  const authenticationTimeout = setTimeout(() => {
    if (!authenticated) socket.close(4401, 'Authentication timeout');
  }, 5_000);
  authenticationTimeout.unref();

  const heartbeat = setInterval(() => {
    if (!heartbeatAlive) {
      socket.terminate();
      return;
    }
    heartbeatAlive = false;
    socket.ping();
  }, 30_000);
  heartbeat.unref();
  socket.on('pong', () => {
    heartbeatAlive = true;
  });

  socket.on('message', (data, isBinary) => {
    if (isBinary) {
      socket.close(1008, 'Unexpected message');
      return;
    }
    if (authenticated) {
      try {
        const input = chatRealtimeClientMessageSchema.parse(JSON.parse(data.toString()));
        if (input.type !== 'presence' || !authenticatedUserId)
          throw new Error('Unexpected message');
        chatRealtimeHub.setPresence(authenticatedUserId, socket, input.status);
      } catch {
        socket.close(1008, 'Invalid message');
      }
      return;
    }
    if (authenticationStarted) {
      socket.close(1008, 'Unexpected message');
      return;
    }
    authenticationStarted = true;
    void (async () => {
      try {
        const input = chatRealtimeClientMessageSchema.parse(JSON.parse(data.toString()));
        if (input.type !== 'authenticate') throw new Error('Authentication required');
        const user = await authenticateAccessToken(input.token);
        if (!user || !user.email_verified_at) {
          socket.close(4401, 'Unauthorized');
          return;
        }
        if (socket.readyState !== 1) return;
        authenticated = true;
        authenticatedUserId = user.id;
        clearTimeout(authenticationTimeout);
        removeFromHub = chatRealtimeHub.add(user.id, socket);
        try {
          socket.send(JSON.stringify({ type: 'ready' }));
        } catch {
          removeFromHub();
          removeFromHub = undefined;
          authenticated = false;
          authenticatedUserId = undefined;
          socket.close(1011, 'Ready message failed');
        }
      } catch {
        socket.close(1008, 'Invalid authentication');
      }
    })();
  });

  socket.once('close', () => {
    clearTimeout(authenticationTimeout);
    clearInterval(heartbeat);
    removeFromHub?.();
  });
  socket.once('error', (error) => {
    app.log.warn({ err: error }, 'Chat realtime socket error');
  });
});

app.get('/health', async () => {
  await db.query('SELECT 1');
  return { ok: true, service: 'freetalk-api', version: '0.4.0-beta.21' };
});

app.post(
  '/v1/auth/register',
  { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
  async (request, reply) => {
    const input = z
      .object({
        email: emailSchema,
        username: usernameSchema,
        displayName: displayNameSchema,
        password: passwordSchema,
        acceptedTerms: z.literal(true),
        acceptedPrivacy: z.literal(true),
        captchaToken: z.string().max(4096).optional(),
      })
      .parse(request.body);
    const recent = await db.query<{ count: string }>(
      `SELECT count(*) FROM security_events
       WHERE event_type='registration.created' AND ip_hash=$1 AND created_at > now()-interval '1 hour'`,
      [hashIp(request.ip)],
    );
    if (Number(recent.rows[0]?.count ?? 0) >= 2) {
      if (!input.captchaToken || !(await verifyCaptcha(input.captchaToken, request.ip)))
        return reply.code(403).send({ code: 'CAPTCHA_REQUIRED', message: 'Пройдите CAPTCHA' });
    }
    const passwordHash = await hashPassword(input.password);
    const verificationToken = randomVerificationCode();
    const user = await transaction(async (client) => {
      const created = await client.query<UserRow>(
        `INSERT INTO users(email,username,display_name,password_hash)
         VALUES($1,$2,$3,$4) RETURNING *`,
        [input.email, input.username, input.displayName, passwordHash],
      );
      const row = created.rows[0]!;
      await client.query(
        `INSERT INTO terms_acceptance(user_id,terms_version,privacy_version) VALUES($1,$2,$3)`,
        [row.id, TERMS_VERSION, PRIVACY_VERSION],
      );
      await client.query(
        `INSERT INTO email_verifications(user_id,token_hash,expires_at)
         VALUES($1,$2,now()+interval '30 minutes')`,
        [row.id, tokenHash(verificationToken)],
      );
      return row;
    });
    await recordSecurityEvent(request, 'registration.created', user.id);
    await sendVerification(user.email, verificationToken);
    return reply.code(201).send({ user: publicUser(user), verificationRequired: true });
  },
);

app.post(
  '/v1/auth/login',
  { config: { rateLimit: { max: 15, timeWindow: '15 minutes' } } },
  async (request, reply) => {
    const input = z
      .object({
        login: z.string().trim().min(3).max(254),
        password: z.string().max(256),
        captchaToken: z.string().max(4096).optional(),
      })
      .parse(request.body);
    const login = input.login.replace(/^@/, '').toLowerCase();
    const failed = await db.query<{ count: string }>(
      `SELECT count(*) FROM security_events
       WHERE event_type='login.failed' AND ip_hash=$1 AND created_at > now()-interval '15 minutes'`,
      [hashIp(request.ip)],
    );
    const failedCount = Number(failed.rows[0]?.count ?? 0);
    if (failedCount >= 10)
      return reply.code(429).send({ code: 'LOGIN_RATE_LIMITED', message: 'Попробуйте позже' });
    if (
      failedCount >= 3 &&
      (!input.captchaToken || !(await verifyCaptcha(input.captchaToken, request.ip)))
    )
      return reply.code(403).send({ code: 'CAPTCHA_REQUIRED', message: 'Пройдите CAPTCHA' });
    const found = await db.query<UserRow>(
      `SELECT * FROM users WHERE (email=$1 OR username=$1) AND deleted_at IS NULL`,
      [login],
    );
    const user = found.rows[0];
    if (!user || !(await verifyPassword(user.password_hash, input.password))) {
      await recordSecurityEvent(request, 'login.failed', user?.id);
      return reply.code(401).send({ code: 'INVALID_CREDENTIALS', message: 'Неверные данные' });
    }
    if (!user.email_verified_at)
      return reply.code(403).send({ code: 'EMAIL_NOT_VERIFIED', message: 'Подтвердите почту' });
    const session = await transaction((client) => issueSession(client, user.id, request));
    await recordSecurityEvent(request, 'login.succeeded', user.id);
    return { user: publicUser(user), session };
  },
);

app.post('/v1/auth/refresh', async (request, reply) => {
  const { refreshToken } = z
    .object({ refreshToken: z.string().min(32).max(256) })
    .parse(request.body);
  const session = await rotateSession(refreshToken, request);
  if (!session)
    return reply.code(401).send({ code: 'INVALID_SESSION', message: 'Сессия завершена' });
  return { session };
});

app.post(
  '/v1/auth/resend-verification',
  { config: { rateLimit: { max: 3, timeWindow: '1 hour' } } },
  async (request) => {
    const { email } = z.object({ email: emailSchema }).parse(request.body);
    const result = await db.query<UserRow>(
      'SELECT * FROM users WHERE email=$1 AND email_verified_at IS NULL AND deleted_at IS NULL',
      [email],
    );
    const user = result.rows[0];
    if (user) {
      const token = randomVerificationCode();
      await transaction(async (client) => {
        await client.query(
          `UPDATE email_verifications SET used_at=now()
           WHERE user_id=$1 AND used_at IS NULL`,
          [user.id],
        );
        await client.query(
          `INSERT INTO email_verifications(user_id,token_hash,expires_at)
           VALUES($1,$2,now()+interval '30 minutes')`,
          [user.id, tokenHash(token)],
        );
      });
      await sendVerification(user.email, token);
    }
    return { message: 'Если подтверждение требуется, новое письмо отправлено.' };
  },
);

app.post('/v1/auth/logout', async (request, reply) => {
  const user = await authenticate(request);
  if (user) await db.query('UPDATE sessions SET revoked_at=now() WHERE id=$1', [user.sessionId]);
  return reply.code(204).send();
});

app.post(
  '/v1/auth/verify-email',
  { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
  async (request, reply) => {
    const input = z
      .union([
        z.object({ email: emailSchema, code: z.string().regex(/^\d{6}$/) }),
        z.object({ token: z.string().min(32).max(256) }),
      ])
      .parse(request.body);
    const token = 'code' in input ? input.code : input.token;
    const verified = await transaction(async (client) => {
      const parameters: unknown[] = [tokenHash(token)];
      const emailFilter = 'email' in input ? 'AND u.email=$2' : '';
      if ('email' in input) parameters.push(input.email);
      const result = await client.query<{ id: string; user_id: string }>(
        `SELECT ev.id,ev.user_id FROM email_verifications ev
         JOIN users u ON u.id=ev.user_id
         WHERE ev.token_hash=$1 ${emailFilter}
         AND ev.used_at IS NULL AND ev.expires_at > now() FOR UPDATE OF ev`,
        parameters,
      );
      const row = result.rows[0];
      if (!row) return null;
      await client.query('UPDATE email_verifications SET used_at=now() WHERE id=$1', [row.id]);
      const user = await client.query<UserRow>(
        `UPDATE users SET email_verified_at=COALESCE(email_verified_at,now()),updated_at=now()
         WHERE id=$1 RETURNING *`,
        [row.user_id],
      );
      const session = await issueSession(client, row.user_id, request);
      return { user: user.rows[0]!, session };
    });
    if (!verified)
      return reply.code(400).send({ code: 'INVALID_TOKEN', message: 'Код неверный или истёк' });
    return { verified: true, user: publicUser(verified.user), session: verified.session };
  },
);

app.post(
  '/v1/auth/forgot-password',
  { config: { rateLimit: { max: 4, timeWindow: '1 hour' } } },
  async (request) => {
    const { email } = z.object({ email: emailSchema }).parse(request.body);
    const result = await db.query<UserRow>(
      'SELECT * FROM users WHERE email=$1 AND deleted_at IS NULL',
      [email],
    );
    const user = result.rows[0];
    if (user) {
      const token = randomToken();
      await db.query(
        `INSERT INTO password_resets(user_id,token_hash,expires_at)
         VALUES($1,$2,now()+interval '20 minutes')`,
        [user.id, tokenHash(token)],
      );
      await sendPasswordReset(user.email, token);
    }
    await recordSecurityEvent(request, 'password-reset.requested', user?.id);
    return { message: 'Если такой аккаунт существует, письмо отправлено.' };
  },
);

app.post('/v1/auth/reset-password', async (request, reply) => {
  const input = z
    .object({ token: z.string().min(32).max(256), password: passwordSchema })
    .parse(request.body);
  const passwordHash = await hashPassword(input.password);
  const reset = await transaction(async (client) => {
    const result = await client.query<{ id: string; user_id: string }>(
      `SELECT id,user_id FROM password_resets
       WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`,
      [tokenHash(input.token)],
    );
    const row = result.rows[0];
    if (!row) return false;
    await client.query('UPDATE password_resets SET used_at=now() WHERE id=$1', [row.id]);
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
  if (!reset) return reply.code(400).send({ code: 'INVALID_TOKEN', message: 'Код недействителен' });
  return { changed: true };
});

app.get('/v1/me', async (request, reply) => {
  const user = await requireUser(request, reply);
  return user ? { user: publicUser(user) } : undefined;
});

app.get('/v1/me/sessions', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const result = await db.query<{
    id: string;
    user_agent: string | null;
    created_at: Date;
    last_used_at: Date;
    refresh_expires_at: Date;
  }>(
    `SELECT id,user_agent,created_at,last_used_at,refresh_expires_at
     FROM sessions
     WHERE user_id=$1 AND revoked_at IS NULL AND refresh_expires_at>now()
     ORDER BY (id=$2) DESC,last_used_at DESC`,
    [user.id, user.sessionId],
  );
  return {
    sessions: result.rows.map((session) => ({
      id: session.id,
      current: session.id === user.sessionId,
      userAgent: session.user_agent ?? '',
      createdAt: session.created_at.toISOString(),
      lastActiveAt: session.last_used_at.toISOString(),
      expiresAt: session.refresh_expires_at.toISOString(),
    })),
  };
});

app.patch('/v1/me', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const input = z
    .object({
      displayName: displayNameSchema.optional(),
      username: usernameSchema.optional(),
      bio: z.string().trim().max(200).nullable().optional(),
    })
    .parse(request.body);
  if (input.username && input.username !== user.username) {
    if (
      user.username_changed_at &&
      Date.now() - user.username_changed_at.getTime() < 30 * 86400_000
    )
      return reply
        .code(429)
        .send({ code: 'USERNAME_RATE_LIMITED', message: 'Имя можно менять раз в 30 дней' });
  }
  const result = await db.query<UserRow>(
    `UPDATE users SET display_name=COALESCE($1,display_name), username=COALESCE($2,username),
     bio=CASE WHEN $3::boolean THEN $4 ELSE bio END,
     username_changed_at=CASE WHEN $2 IS NULL THEN username_changed_at ELSE now() END, updated_at=now()
     WHERE id=$5 RETURNING *`,
    [
      input.displayName ?? null,
      input.username ?? null,
      input.bio !== undefined,
      input.bio ?? null,
      user.id,
    ],
  );
  await publishProfileUpdate(user.id);
  return { user: publicUser(result.rows[0]!) };
});

app.post('/v1/me/change-password', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const input = z
    .object({ currentPassword: z.string().max(256), newPassword: passwordSchema })
    .parse(request.body);
  if (!(await verifyPassword(user.password_hash, input.currentPassword)))
    return reply.code(403).send({ code: 'INVALID_PASSWORD', message: 'Неверный пароль' });
  await transaction(async (client) => {
    await client.query('UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2', [
      await hashPassword(input.newPassword),
      user.id,
    ]);
    await client.query(
      'UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL',
      [user.id, user.sessionId],
    );
  });
  return { changed: true };
});

app.delete('/v1/me', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const { password } = z
    .object({ password: z.string().max(256), confirmation: z.literal('УДАЛИТЬ') })
    .parse(request.body);
  if (!(await verifyPassword(user.password_hash, password)))
    return reply.code(403).send({ code: 'INVALID_PASSWORD', message: 'Неверный пароль' });
  await transaction(async (client) => {
    await client.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1', [user.id]);
    await client.query('DELETE FROM friendships WHERE user_low_id=$1 OR user_high_id=$1', [
      user.id,
    ]);
    await client.query('DELETE FROM friend_requests WHERE sender_id=$1 OR recipient_id=$1', [
      user.id,
    ]);
    await client.query('DELETE FROM blocks WHERE blocker_id=$1 OR blocked_id=$1', [user.id]);
    await client.query(
      `UPDATE users SET email=$1,username=$2,display_name='Удалённый пользователь',avatar_data=NULL,
       avatar_mime=NULL,cover_data=NULL,cover_mime=NULL,bio=NULL,password_hash='deleted',
       deleted_at=now(),updated_at=now() WHERE id=$3`,
      [`deleted-${user.id}@invalid.local`, `deleted-${user.id}`, user.id],
    );
  });
  return reply.code(204).send();
});

app.get('/v1/users/:id/avatar', async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const result = await db.query<{ avatar_mime: string; avatar_data: Buffer }>(
    'SELECT avatar_mime,avatar_data FROM users WHERE id=$1 AND avatar_data IS NOT NULL AND deleted_at IS NULL',
    [id],
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

app.post('/v1/me/avatar', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const file = await request.file();
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype))
    return reply.code(400).send({ code: 'INVALID_IMAGE', message: 'Допустимы PNG, JPEG и WebP' });
  const bytes = await file.toBuffer();
  const signatures = [
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP',
  ];
  if (!signatures.some(Boolean))
    return reply.code(400).send({ code: 'INVALID_IMAGE', message: 'Некорректный файл' });
  const dimensions = safeImageDimensions(bytes);
  if (
    !dimensions.width ||
    !dimensions.height ||
    dimensions.width > 4096 ||
    dimensions.height > 4096 ||
    dimensions.width < 64 ||
    dimensions.height < 64
  )
    return reply
      .code(400)
      .send({ code: 'INVALID_IMAGE_SIZE', message: 'Размер изображения: от 64×64 до 4096×4096' });
  await db.query('UPDATE users SET avatar_mime=$1,avatar_data=$2,updated_at=now() WHERE id=$3', [
    file.mimetype,
    bytes,
    user.id,
  ]);
  await publishProfileUpdate(user.id);
  return { avatarUrl: publicApiUrl(`/v1/users/${user.id}/avatar`) };
});

app.delete('/v1/me/avatar', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  await db.query(
    'UPDATE users SET avatar_mime=NULL,avatar_data=NULL,updated_at=now() WHERE id=$1',
    [user.id],
  );
  await publishProfileUpdate(user.id);
  return reply.code(204).send();
});

app.get('/v1/users/:id/cover', async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const result = await db.query<{ cover_mime: string; cover_data: Buffer }>(
    'SELECT cover_mime,cover_data FROM users WHERE id=$1 AND cover_data IS NOT NULL AND deleted_at IS NULL',
    [id],
  );
  const cover = result.rows[0];
  if (!cover) return reply.code(404).send({ code: 'NOT_FOUND' });
  return reply
    .header('content-type', cover.cover_mime)
    .header('x-content-type-options', 'nosniff')
    .header('content-security-policy', "default-src 'none'; sandbox")
    .header('referrer-policy', 'no-referrer')
    .header('cache-control', 'public,max-age=300')
    .send(cover.cover_data);
});

app.post('/v1/me/cover', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const file = await request.file();
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype))
    return reply.code(400).send({ code: 'INVALID_IMAGE', message: 'Допустимы PNG, JPEG и WebP' });
  const bytes = await file.toBuffer();
  const signatures = [
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP',
  ];
  if (!signatures.some(Boolean))
    return reply.code(400).send({ code: 'INVALID_IMAGE', message: 'Некорректный файл' });
  const dimensions = safeImageDimensions(bytes);
  if (
    !dimensions.width ||
    !dimensions.height ||
    dimensions.width > 4096 ||
    dimensions.height > 4096 ||
    dimensions.width < 320 ||
    dimensions.height < 120
  )
    return reply
      .code(400)
      .send({ code: 'INVALID_IMAGE_SIZE', message: 'Обложка: от 320×120 до 4096×4096' });
  await db.query('UPDATE users SET cover_mime=$1,cover_data=$2,updated_at=now() WHERE id=$3', [
    file.mimetype,
    bytes,
    user.id,
  ]);
  await publishProfileUpdate(user.id);
  return { coverUrl: publicApiUrl(`/v1/users/${user.id}/cover`) };
});

app.delete('/v1/me/cover', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  await db.query('UPDATE users SET cover_mime=NULL,cover_data=NULL,updated_at=now() WHERE id=$1', [
    user.id,
  ]);
  await publishProfileUpdate(user.id);
  return reply.code(204).send();
});

// Signaling calls this endpoint over the private server network. Clients cannot assert roles.
app.post(
  '/v1/internal/room-authorize',
  { config: { rateLimit: false } },
  async (request, reply) => {
    const secret = request.headers['x-freetalk-internal-secret'];
    if (typeof secret !== 'string' || !secureSecretEqual(secret, env.INTERNAL_SIGNALING_SECRET))
      return reply.code(401).send({ allowed: false });
    const input = z
      .object({
        action: z.enum(['create', 'join']),
        roomId: z.string().min(8).max(32),
        token: z.string().min(32).max(256),
      })
      .parse(request.body);
    const registered = await transaction(async (client) => {
      const session = await client.query<{
        user_id: string;
        display_name: string;
        has_avatar: boolean;
      }>(
        `SELECT s.user_id,u.display_name,u.avatar_data IS NOT NULL AS has_avatar
         FROM sessions s JOIN users u ON u.id=s.user_id
         WHERE s.access_token_hash=$1 AND s.revoked_at IS NULL
         AND s.access_expires_at>now() AND u.deleted_at IS NULL`,
        [tokenHash(input.token)],
      );
      const user = session.rows[0];
      if (!user) return null;
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [user.user_id]);
      const eventType =
        input.action === 'create' ? 'room.create.authorized' : 'room.join.authorized';
      const window = input.action === 'create' ? '1 hour' : '1 hour';
      const maximum = input.action === 'create' ? 20 : 120;
      const recent = await client.query<{ count: string }>(
        `SELECT count(*) FROM security_events
         WHERE user_id=$1 AND event_type=$2 AND created_at>now()-$3::interval`,
        [user.user_id, eventType, window],
      );
      if (Number(recent.rows[0]?.count ?? 0) >= maximum) return { limited: true, user } as const;
      await client.query('INSERT INTO security_events(user_id,event_type) VALUES($1,$2)', [
        user.user_id,
        eventType,
      ]);
      return { limited: false, user } as const;
    });
    if (registered?.limited)
      return reply.code(429).send({ allowed: false, reason: 'RATE_LIMITED' });
    if (registered)
      return {
        allowed: true,
        kind: 'registered',
        userId: registered.user.user_id,
        displayName: registered.user.display_name,
        avatar: publicAvatarUrl(registered.user.user_id, registered.user.has_avatar),
      };
    if (input.action === 'create')
      return reply.code(403).send({ allowed: false, reason: 'REGISTERED_ONLY' });
    const guest = await transaction(async (client) => {
      const found = await client.query<{
        id: string;
        anonymous_user_id: string;
        display_name: string;
        room_id: string;
        expires_at: Date;
      }>(
        `SELECT id,anonymous_user_id,display_name,room_id,expires_at FROM guest_sessions
       WHERE join_token_hash=$1 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE`,
        [tokenHash(input.token)],
      );
      const row = found.rows[0];
      if (!row || row.room_id !== input.roomId) return null;
      await client.query(
        `INSERT INTO guest_usage_daily(anonymous_user_id,usage_day,join_count)
       VALUES($1,(now() AT TIME ZONE 'UTC')::date,0) ON CONFLICT DO NOTHING`,
        [row.anonymous_user_id],
      );
      const usage = await client.query<{ join_count: number }>(
        `SELECT join_count FROM guest_usage_daily WHERE anonymous_user_id=$1
       AND usage_day=(now() AT TIME ZONE 'UTC')::date FOR UPDATE`,
        [row.anonymous_user_id],
      );
      if (!guestQuotaAvailable(usage.rows[0]?.join_count ?? 0)) return { limited: true } as const;
      await client.query(
        `UPDATE guest_usage_daily SET join_count=join_count+1 WHERE anonymous_user_id=$1
       AND usage_day=(now() AT TIME ZONE 'UTC')::date`,
        [row.anonymous_user_id],
      );
      await client.query('UPDATE guest_sessions SET consumed_at=now() WHERE id=$1', [row.id]);
      return { limited: false, row } as const;
    });
    if (!guest) return reply.code(403).send({ allowed: false, reason: 'INVALID_GUEST_TOKEN' });
    if (guest.limited) return reply.code(429).send({ allowed: false, reason: 'GUEST_DAILY_LIMIT' });
    return {
      allowed: true,
      kind: 'guest',
      anonymousUserId: guest.row.anonymous_user_id,
      displayName: guest.row.display_name,
      disconnectAt: guest.row.expires_at.toISOString(),
    };
  },
);

async function refreshCallMessage(roomId: string) {
  const call = await db.query<{
    id: string;
    started_at: Date;
    ended_at: Date | null;
  }>(
    `SELECT id,started_at,ended_at FROM call_sessions
     WHERE room_id=$1 ORDER BY started_at DESC LIMIT 1`,
    [roomId],
  );
  const session = call.rows[0];
  if (!session) return;

  const participants = await db.query<{
    user_id: string | null;
    display_name: string;
    has_avatar: boolean;
  }>(
    `SELECT participant.user_id,participant.display_name,
            COALESCE(users.avatar_data IS NOT NULL,false) AS has_avatar
     FROM (
       SELECT DISTINCT ON (COALESCE(user_id::text,anonymous_user_id::text))
              user_id,anonymous_user_id,display_name,joined_at
       FROM call_participants
       WHERE call_id=$1 AND ($2::boolean OR left_at IS NULL)
       ORDER BY COALESCE(user_id::text,anonymous_user_id::text),joined_at
     ) participant
     LEFT JOIN users ON users.id=participant.user_id
     ORDER BY participant.joined_at`,
    [session.id, session.ended_at !== null],
  );
  const metadata = {
    ended: session.ended_at !== null,
    startedAt: new Date(session.started_at).toISOString(),
    endedAt: session.ended_at ? new Date(session.ended_at).toISOString() : null,
    participants: participants.rows.map((participant) => ({
      userId: participant.user_id,
      displayName: participant.display_name,
      avatarUrl: participant.user_id
        ? (publicAvatarUrl(participant.user_id, participant.has_avatar) ?? null)
        : null,
    })),
  };
  const messages = await db.query<{
    id: string;
    chat_id: string;
    metadata: Record<string, unknown>;
  }>(
    `UPDATE messages SET metadata=metadata || $2::jsonb
     WHERE kind='call' AND metadata->>'roomId'=$1
     RETURNING id,chat_id,metadata`,
    [roomId, JSON.stringify(metadata)],
  );
  await Promise.all(
    messages.rows.map((message) =>
      publishChatEvent(message.chat_id, {
        type: 'message-updated',
        chatId: message.chat_id,
        messageId: message.id,
        metadata: message.metadata,
      }),
    ),
  );
}

app.post('/v1/internal/call-event', { config: { rateLimit: false } }, async (request, reply) => {
  const secret = request.headers['x-freetalk-internal-secret'];
  if (typeof secret !== 'string' || !secureSecretEqual(secret, env.INTERNAL_SIGNALING_SECRET))
    return reply.code(401).send({ ok: false });
  const input = z
    .object({
      event: z.enum(['start', 'join', 'leave', 'end']),
      roomId: z.string().min(8).max(32),
      displayName: displayNameSchema.optional(),
      userId: z.string().uuid().optional(),
      anonymousUserId: z.string().uuid().optional(),
    })
    .parse(request.body);
  if (input.event === 'start') {
    if (!input.userId || !input.displayName) return reply.code(400).send({ ok: false });
    await transaction(async (client) => {
      const call = await client.query<{ id: string }>(
        `INSERT INTO call_sessions(room_id,created_by,chat_id)
         VALUES($1::text,$2,(SELECT chat_id FROM messages WHERE kind='call'
           AND metadata->>'roomId'=$1::text ORDER BY created_at DESC LIMIT 1)) RETURNING id`,
        [input.roomId, input.userId],
      );
      await client.query(
        `INSERT INTO call_participants(call_id,user_id,display_name) VALUES($1,$2,$3)`,
        [call.rows[0]!.id, input.userId, input.displayName],
      );
    });
    await refreshCallMessage(input.roomId);
  } else if (input.event === 'join') {
    if ((!input.userId && !input.anonymousUserId) || !input.displayName)
      return reply.code(400).send({ ok: false });
    await db.query(
      `INSERT INTO call_participants(call_id,user_id,anonymous_user_id,display_name)
       SELECT id,$2,$3,$4 FROM call_sessions WHERE room_id=$1 AND ended_at IS NULL
       ORDER BY started_at DESC LIMIT 1`,
      [input.roomId, input.userId ?? null, input.anonymousUserId ?? null, input.displayName],
    );
    await refreshCallMessage(input.roomId);
  } else if (input.event === 'leave') {
    await db.query(
      `UPDATE call_participants SET left_at=now() WHERE call_id=(SELECT id FROM call_sessions
       WHERE room_id=$1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1)
       AND (($2::uuid IS NOT NULL AND user_id=$2) OR ($3::uuid IS NOT NULL AND anonymous_user_id=$3))
       AND left_at IS NULL`,
      [input.roomId, input.userId ?? null, input.anonymousUserId ?? null],
    );
    await refreshCallMessage(input.roomId);
  } else {
    await db.query(
      `UPDATE call_sessions SET ended_at=now() WHERE room_id=$1 AND ended_at IS NULL`,
      [input.roomId],
    );
    await refreshCallMessage(input.roomId);
  }
  return { ok: true };
});

app.get(
  '/v1/internal/users/:id/profile',
  { config: { rateLimit: false } },
  async (request, reply) => {
    const secret = request.headers['x-freetalk-internal-secret'];
    if (typeof secret !== 'string' || !secureSecretEqual(secret, env.INTERNAL_SIGNALING_SECRET))
      return reply.code(401).send({ ok: false });
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await db.query<{
      display_name: string;
      has_avatar: boolean;
    }>(
      `SELECT display_name,avatar_data IS NOT NULL AS has_avatar
       FROM users WHERE id=$1 AND deleted_at IS NULL`,
      [id],
    );
    if (!result.rows[0]) return reply.code(404).send({ ok: false });
    return {
      displayName: result.rows[0].display_name,
      avatar: publicAvatarUrl(id, result.rows[0].has_avatar),
    };
  },
);

app.post(
  '/v1/guest/join-token',
  { config: { rateLimit: { max: 8, timeWindow: '1 hour' } } },
  async (request, reply) => {
    const input = z
      .object({
        anonymousUserId: z.string().uuid(),
        roomId: z.string().min(8).max(32),
        captchaToken: z.string().min(1).max(4096),
      })
      .parse(request.body);
    if (!(await verifyCaptcha(input.captchaToken, request.ip)))
      return reply.code(403).send({ code: 'CAPTCHA_FAILED', message: 'CAPTCHA не пройдена' });
    const token = randomToken(48);
    const guestDisplayName = `FreeUser-${randomInt(0, 1_000_000).toString().padStart(6, '0')}`;
    await db.query(
      `INSERT INTO guest_sessions(anonymous_user_id,display_name,room_id,join_token_hash,expires_at)
     VALUES($1,$2,$3,$4,now()+make_interval(secs=>$5))`,
      [
        input.anonymousUserId,
        guestDisplayName,
        input.roomId,
        tokenHash(token),
        GUEST_SESSION_SECONDS,
      ],
    );
    return {
      guestJoinToken: token,
      displayName: guestDisplayName,
      expiresInSeconds: GUEST_SESSION_SECONDS,
    };
  },
);

app.get('/v1/legal/terms', async () => ({
  version: TERMS_VERSION,
  title: 'Пользовательское соглашение',
  status: 'draft',
  content: 'Документ будет опубликован до production-релиза.',
}));
app.get('/v1/legal/privacy', async () => ({
  version: PRIVACY_VERSION,
  title: 'Политика конфиденциальности',
  status: 'draft',
  content: 'Документ будет опубликован до production-релиза.',
}));

registerSocialRoutes(app, requireUser);
registerAndroidPush(app, requireUser);
startAndroidPush(app);
registerAdminRoutes(app);
startInfrastructureSampler();

await app.listen({ host: env.API_HOST, port: env.API_PORT });

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from '@simplewebauthn/server';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { issueSession, publicUser, type AuthenticatedUser, type UserRow } from './auth-service.js';
import { db, transaction } from './db.js';
import { randomToken, tokenHash, verifyPassword } from './security.js';

const rpID = 'trlka.com';
const origin = 'https://trlka.com';
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const credentialId = z.string().regex(/^[A-Za-z0-9_-]{1,2048}$/);
const finish = z.object({
  state: token,
  response: z.looseObject({
    id: credentialId,
    type: z.literal('public-key'),
    response: z.object({}).loose(),
  }),
});
type RequireUser = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<AuthenticatedUser | null>;
type Passkey = {
  id: string;
  user_id: string;
  public_key: Buffer;
  counter: string;
  transports: NonNullable<WebAuthnCredential['transports']>;
};

const unavailable = (reply: FastifyReply) =>
  reply
    .code(400)
    .send({ code: 'PASSKEY_UNAVAILABLE', message: 'Не удалось подтвердить ключ доступа' });

async function saveRequest(
  challenge: string,
  registrationSessionId?: string,
  qrChallengeHash?: Buffer,
) {
  const state = randomToken();
  await db.query('DELETE FROM passkey_requests WHERE expires_at <= now()');
  await db.query(
    `INSERT INTO passkey_requests
     (token_hash, challenge, registration_session_id, qr_challenge_hash, expires_at)
     VALUES ($1,$2,$3,$4,now()+interval '2 minutes')`,
    [tokenHash(state), challenge, registrationSessionId, qrChallengeHash],
  );
  return state;
}

export function registerPasskeyRoutes(app: FastifyInstance, requireUser: RequireUser) {
  const sensitive = {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    async preHandler(request: FastifyRequest, reply: FastifyReply) {
      reply.header('Cache-Control', 'no-store');
      if (request.headers.origin !== origin) {
        return reply
          .code(403)
          .send({ code: 'PASSKEY_ORIGIN', message: 'Откройте trlka.com для входа по ключу' });
      }
    },
  };

  app.get('/v1/me/passkeys', sensitive, async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { rows } = await db.query<{ id: string; createdAt: Date }>(
      'SELECT id, created_at AS "createdAt" FROM passkeys WHERE user_id=$1 ORDER BY created_at DESC',
      [user.id],
    );
    return { keys: rows };
  });

  app.delete('/v1/me/passkeys/:id', sensitive, async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = z.object({ id: credentialId }).parse(request.params);
    await db.query('DELETE FROM passkeys WHERE id=$1 AND user_id=$2', [id, user.id]);
    return { deleted: true };
  });

  app.post(
    '/v1/me/passkeys/start',
    {
      ...sensitive,
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const { password } = z.object({ password: z.string().min(1).max(256) }).parse(request.body);
      if (!(await verifyPassword(user.password_hash, password))) {
        return reply.code(403).send({ code: 'INVALID_PASSWORD', message: 'Неверный пароль' });
      }
      const { rows } = await db.query<Passkey>(
        'SELECT id, transports FROM passkeys WHERE user_id=$1',
        [user.id],
      );
      if (rows.length >= 10) return unavailable(reply);
      const options = await generateRegistrationOptions({
        rpName: 'TRLKA',
        rpID,
        userID: new TextEncoder().encode(user.id),
        userName: user.username,
        userDisplayName: user.display_name,
        attestationType: 'none',
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        excludeCredentials: rows.map(({ id, transports }) => ({ id, transports })),
      });
      return { options, state: await saveRequest(options.challenge, user.sessionId) };
    },
  );

  app.post('/v1/me/passkeys/finish', sensitive, async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { state, response } = finish.parse(request.body);
    const { rows } = await db.query<{ challenge: string }>(
      `DELETE FROM passkey_requests WHERE token_hash=$1 AND registration_session_id=$2
        AND expires_at>now() RETURNING challenge`,
      [tokenHash(state), user.sessionId],
    );
    if (!rows[0]) return unavailable(reply);
    const result = await verifyRegistrationResponse({
      response: response as unknown as RegistrationResponseJSON,
      expectedChallenge: rows[0].challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    }).catch(() => null);
    if (!result?.verified) return unavailable(reply);
    const { id, publicKey, counter, transports = [] } = result.registrationInfo.credential;
    const created = await transaction(async (client) => {
      const current = await client.query(
        'SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',
        [user.id],
      );
      if (!current.rowCount) return false;
      const keys = await client.query('SELECT id FROM passkeys WHERE user_id=$1 LIMIT 10', [
        user.id,
      ]);
      if (keys.rowCount === 10) return false;
      const inserted = await client.query(
        `INSERT INTO passkeys (id,user_id,public_key,counter,transports) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO NOTHING`,
        [id, user.id, Buffer.from(publicKey), counter, transports],
      );
      return Boolean(inserted.rowCount);
    });
    if (!created) return unavailable(reply);
    return reply.code(201).send({ created: true });
  });

  app.post('/v1/auth/passkey/start', sensitive, async (request, reply) => {
    const { desktopChallenge } = z
      .object({ desktopChallenge: token.optional() })
      .parse(request.body);
    const qrHash = desktopChallenge ? tokenHash(desktopChallenge) : undefined;
    if (qrHash) {
      const login = await db.query(
        `SELECT 1 FROM qr_logins WHERE challenge_hash=$1 AND expires_at>now()
         AND approved_session_id IS NULL AND approved_passkey_id IS NULL`,
        [qrHash],
      );
      if (!login.rowCount) return unavailable(reply);
    }
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
    return { options, state: await saveRequest(options.challenge, undefined, qrHash) };
  });

  app.post('/v1/auth/passkey/finish', sensitive, async (request, reply) => {
    const { state, response } = finish.parse(request.body);
    const { rows } = await db.query<{ challenge: string; qr_challenge_hash: Buffer | null }>(
      `DELETE FROM passkey_requests WHERE token_hash=$1 AND registration_session_id IS NULL
       AND expires_at>now() RETURNING challenge, qr_challenge_hash`,
      [tokenHash(state)],
    );
    const attempt = rows[0];
    if (!attempt) return unavailable(reply);
    const result = await transaction(async (client) => {
      const credentials = await client.query<Passkey>(
        'SELECT * FROM passkeys WHERE id=$1 FOR UPDATE',
        [response.id],
      );
      const key = credentials.rows[0];
      if (!key) return null;
      const assertion = response as unknown as AuthenticationResponseJSON;
      if (assertion.response.userHandle !== Buffer.from(key.user_id).toString('base64url'))
        return null;
      const verified = await verifyAuthenticationResponse({
        response: assertion,
        expectedChallenge: attempt.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: key.id,
          publicKey: new Uint8Array(key.public_key),
          counter: Number(key.counter),
          transports: key.transports,
        },
      }).catch(() => null);
      if (!verified?.verified) return null;
      const users = await client.query<UserRow>(
        'SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL AND email_verified_at IS NOT NULL FOR SHARE',
        [key.user_id],
      );
      const user = users.rows[0];
      if (!user) return null;
      await client.query('UPDATE passkeys SET counter=$2 WHERE id=$1', [
        key.id,
        verified.authenticationInfo.newCounter,
      ]);
      if (attempt.qr_challenge_hash) {
        const approved = await client.query(
          `UPDATE qr_logins SET approved_passkey_id=$2 WHERE challenge_hash=$1 AND expires_at>now()
           AND approved_session_id IS NULL AND approved_passkey_id IS NULL`,
          [attempt.qr_challenge_hash, key.id],
        );
        return approved.rowCount ? ({ approved: true } as const) : null;
      }
      return { user: publicUser(user), session: await issueSession(client, user.id, request) };
    });
    return result ?? unavailable(reply);
  });
}

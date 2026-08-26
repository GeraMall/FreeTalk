import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import { db, transaction } from './db.js';
import { publicApiUrl } from './env.js';
import { bearerToken, hashIp, randomToken, tokenHash } from './security.js';

const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface UserRow {
  id: string;
  email: string;
  username: string;
  display_name: string;
  password_hash: string;
  email_verified_at: Date | null;
  avatar_mime: string | null;
  avatar_data: Buffer | null;
  bio: string | null;
  cover_mime: string | null;
  cover_data: Buffer | null;
  username_changed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface AuthenticatedUser extends UserRow {
  sessionId: string;
}

export function publicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.display_name,
    emailVerified: Boolean(user.email_verified_at),
    avatarUrl: user.avatar_data
      ? publicApiUrl(`/v1/users/${user.id}/avatar?v=${user.updated_at.getTime()}`)
      : null,
    coverUrl: user.cover_data
      ? publicApiUrl(`/v1/users/${user.id}/cover?v=${user.updated_at.getTime()}`)
      : null,
    bio: user.bio,
    registeredAt: user.created_at.toISOString(),
  };
}

export async function issueSession(client: pg.PoolClient, userId: string, request: FastifyRequest) {
  const accessToken = randomToken();
  const refreshToken = randomToken(48);
  const accessExpiresAt = new Date(Date.now() + ACCESS_TTL_MS);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  const result = await client.query<{ id: string }>(
    `INSERT INTO sessions
       (user_id, access_token_hash, refresh_token_hash, access_expires_at, refresh_expires_at, user_agent, ip_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [
      userId,
      tokenHash(accessToken),
      tokenHash(refreshToken),
      accessExpiresAt,
      refreshExpiresAt,
      request.headers['user-agent']?.slice(0, 256),
      hashIp(request.ip),
    ],
  );
  return {
    sessionId: result.rows[0]!.id,
    accessToken,
    refreshToken,
    accessExpiresAt: accessExpiresAt.toISOString(),
    refreshExpiresAt: refreshExpiresAt.toISOString(),
  };
}

export async function rotateSession(refreshToken: string, request: FastifyRequest) {
  return transaction(async (client) => {
    const current = await client.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM sessions
       WHERE refresh_token_hash=$1 AND revoked_at IS NULL AND refresh_expires_at > now()
       FOR UPDATE`,
      [tokenHash(refreshToken)],
    );
    if (!current.rowCount) return null;
    const accessToken = randomToken();
    const nextRefreshToken = randomToken(48);
    const accessExpiresAt = new Date(Date.now() + ACCESS_TTL_MS);
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    await client.query(
      `UPDATE sessions SET access_token_hash=$1, refresh_token_hash=$2,
       access_expires_at=$3, refresh_expires_at=$4, last_used_at=now(), ip_hash=$5
       WHERE id=$6`,
      [
        tokenHash(accessToken),
        tokenHash(nextRefreshToken),
        accessExpiresAt,
        refreshExpiresAt,
        hashIp(request.ip),
        current.rows[0]!.id,
      ],
    );
    return {
      accessToken,
      refreshToken: nextRefreshToken,
      accessExpiresAt: accessExpiresAt.toISOString(),
      refreshExpiresAt: refreshExpiresAt.toISOString(),
    };
  });
}

export async function authenticate(request: FastifyRequest): Promise<AuthenticatedUser | null> {
  const token = bearerToken(request.headers.authorization);
  if (!token) return null;
  return authenticateAccessToken(token);
}

export async function authenticateAccessToken(token: string): Promise<AuthenticatedUser | null> {
  const result = await db.query<UserRow & { session_id: string }>(
    `SELECT u.*, s.id AS session_id FROM sessions s
     JOIN users u ON u.id=s.user_id
     WHERE s.access_token_hash=$1 AND s.revoked_at IS NULL
       AND s.access_expires_at > now() AND u.deleted_at IS NULL`,
    [tokenHash(token)],
  );
  const row = result.rows[0];
  if (!row) return null;
  void db.query('UPDATE sessions SET last_used_at=now() WHERE id=$1', [row.session_id]);
  return { ...row, sessionId: row.session_id };
}

export async function recordSecurityEvent(
  request: FastifyRequest,
  eventType: string,
  userId?: string,
  details: Record<string, unknown> = {},
) {
  await db.query(
    `INSERT INTO security_events(user_id,event_type,ip_hash,details) VALUES($1,$2,$3,$4)`,
    [userId ?? null, eventType, hashIp(request.ip), details],
  );
}

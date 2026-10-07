import Fastify from 'fastify';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { z, ZodError } from 'zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), send: vi.fn(), hashPassword: vi.fn() }));
vi.mock('../src/db.js', () => ({
  transaction: (work: (client: unknown) => unknown) => work({ query: mocks.query }),
}));
vi.mock('../src/auth-service.js', () => ({ recordSecurityEvent: vi.fn() }));
vi.mock('../src/mailer.js', () => ({ sendPasswordReset: mocks.send }));
vi.mock('../src/security.js', () => ({
  emailSchema: z.string().trim().toLowerCase().email(),
  passwordSchema: z.string().min(10),
  randomVerificationCode: () => '012345',
  randomToken: () => 'a'.repeat(43),
  tokenHash: (token: string) => createHash('sha256').update(token).digest(),
  hashPassword: mocks.hashPassword,
}));
import { registerPasswordResetRoutes } from '../src/password-reset.js';
let app: ReturnType<typeof Fastify>;
const result = (rows: object[] = []) => ({ rows, rowCount: rows.length });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.hashPassword.mockResolvedValue('hashed-password');
  mocks.query.mockResolvedValue(result());
  app = Fastify();
  app.setErrorHandler((error: FastifyError, _request: FastifyRequest, reply: FastifyReply) =>
    reply.code(error instanceof ZodError ? 400 : 500).send({ error: 'invalid' }),
  );
  registerPasswordResetRoutes(app);
});
afterEach(() => app.close());

describe('password reset', () => {
  it('sends six digits, keeps leading zero and hashes the code with a unique reset ID', async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT id,email'))
        return result([{ id: 'user-1', email: 'test@example.com' }]);
      return result();
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/forgot-password',
      payload: { email: 'TEST@example.com', codeFormat: 'numeric' },
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.send).toHaveBeenCalledWith('test@example.com', '012345');
    const insert = mocks.query.mock.calls.find(([sql]) =>
      sql.startsWith('INSERT INTO password_resets'),
    )!;
    expect(insert[1][2]).toEqual(createHash('sha256').update(`${insert[1][0]}:012345`).digest());
    expect(
      mocks.query.mock.calls.some(([sql]) => sql.includes('SET used_at=now() WHERE user_id=$1')),
    ).toBe(true);
    expect(insert[0]).toContain("interval '20 minutes'");
  });

  it('applies account-wide issuance limit without revealing whether an account exists', async () => {
    const payload = { email: 'test@example.com', codeFormat: 'numeric' };
    const absent = await app.inject({ method: 'POST', url: '/v1/auth/forgot-password', payload });
    mocks.query.mockImplementation(async (sql: string) =>
      sql.startsWith('SELECT id,email')
        ? result([{ id: 'user-1', email: payload.email }])
        : result([{ count: 4 }]),
    );
    const limited = await app.inject({ method: 'POST', url: '/v1/auth/forgot-password', payload });
    expect(limited.json()).toEqual(absent.json());
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('requires the email for a short code', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/reset-password',
      payload: { token: '012345', password: 'NewPassword123' },
    });
    expect(response.statusCode).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('checks email, expiry and single use, then consumes resets and revokes sessions', async () => {
    mocks.query.mockImplementation(async (sql: string) =>
      sql.startsWith('SELECT pr.id')
        ? result([
            {
              id: 'reset-1',
              user_id: 'user-1',
              attempts: 0,
              token_hash: createHash('sha256').update('reset-1:012345').digest(),
            },
          ])
        : result(),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/reset-password',
      payload: { email: 'test@example.com', token: '012345', password: 'NewPassword123' },
    });
    expect(response.json()).toEqual({ changed: true });
    const lookup = mocks.query.mock.calls[0]!;
    expect(lookup[0]).toContain('u.email=$1');
    expect(lookup[0]).toContain('pr.expires_at>now()');
    expect(lookup[0]).toContain('pr.used_at IS NULL');
    expect(lookup[0]).toContain('FOR UPDATE OF pr');
    expect(lookup[1]).toEqual(['test@example.com']);
    expect(
      mocks.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE sessions SET revoked_at')),
    ).toBe(true);
  });

  it('counts wrong guesses without changing the password', async () => {
    mocks.query.mockResolvedValue(
      result([
        { id: 'reset-1', user_id: 'user-1', attempts: 0, token_hash: Buffer.from('different') },
      ]),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/reset-password',
      payload: { email: 'test@example.com', token: '012345', password: 'NewPassword123' },
    });
    expect(response.statusCode).toBe(400);
    expect(mocks.query.mock.calls[1]![0]).toContain('attempts=attempts+1');
    expect(mocks.hashPassword).not.toHaveBeenCalled();
  });

  it('blocks an exhausted challenge even with the right code', async () => {
    mocks.query.mockResolvedValue(
      result([
        {
          id: 'reset-1',
          attempts: 5,
          token_hash: createHash('sha256').update('reset-1:012345').digest(),
        },
      ]),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/reset-password',
      payload: { email: 'test@example.com', token: '012345', password: 'NewPassword123' },
    });
    expect(response.statusCode).toBe(400);
    expect(mocks.hashPassword).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it('rejects absent, expired or already consumed challenges', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/reset-password',
      payload: { email: 'wrong@example.com', token: '012345', password: 'NewPassword123' },
    });
    expect(response.statusCode).toBe(400);
    expect(mocks.hashPassword).not.toHaveBeenCalled();
  });

  it('keeps legacy long-token clients working', async () => {
    mocks.query.mockResolvedValue(result([{ id: 'reset-old', user_id: 'user-1', attempts: 0 }]));
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/reset-password',
      payload: { token: 'a'.repeat(43), password: 'NewPassword123' },
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.query.mock.calls[0]![0]).toContain('pr.token_hash=$1');
  });
});

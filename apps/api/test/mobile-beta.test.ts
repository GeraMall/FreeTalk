import Fastify from 'fastify';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  issueSession: vi.fn(),
  recordSecurityEvent: vi.fn(),
  verifyPassword: vi.fn(),
}));

vi.mock('../src/db.js', () => ({
  db: { query: mocks.query },
  transaction: (work: (client: unknown) => unknown) => work({ query: mocks.query }),
}));
vi.mock('../src/auth-service.js', () => ({
  issueSession: mocks.issueSession,
  recordSecurityEvent: mocks.recordSecurityEvent,
  publicUser: (user: { id: string; email: string; username: string }) => ({
    id: user.id,
    email: user.email,
    username: user.username,
  }),
}));
vi.mock('../src/security.js', () => ({
  hashIp: () => Buffer.from('ip'),
  tokenHash: (value: string) => createHash('sha256').update(value).digest(),
  verifyPassword: mocks.verifyPassword,
}));

import { normalizeMobileBetaKey, registerMobileBetaRoutes } from '../src/mobile-beta.js';

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'mobile@example.com',
  username: 'mobile_user',
  password_hash: 'password-hash',
  email_verified_at: new Date(),
};
const rows = (values: object[] = []) => ({ rows: values, rowCount: values.length });
const mobileHeaders = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile' };

describe('mobile beta access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.issueSession.mockResolvedValue({ accessToken: 'a', refreshToken: 'b' });
  });

  it('normalizes a readable invitation key', () => {
    expect(normalizeMobileBetaKey(' trlka-abcd-2345-efgh-6789 ')).toBe('ABCD2345EFGH6789');
  });

  it('claims a valid key once and issues a session for the account', async () => {
    mocks.query
      .mockResolvedValueOnce(rows([user]))
      .mockResolvedValueOnce(rows())
      .mockResolvedValueOnce(
        rows([{ id: '10000000-0000-4000-8000-000000000001', claimed_by: null }]),
      )
      .mockResolvedValueOnce(rows());
    const app = Fastify();
    registerMobileBetaRoutes(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/mobile-beta/login',
      headers: mobileHeaders,
      payload: {
        login: user.email,
        password: 'Password123',
        key: 'TRLKA-ABCD-2345-EFGH-6789',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.issueSession).toHaveBeenCalledOnce();
    expect(mocks.query.mock.calls[2]![1][0]).toEqual(
      createHash('sha256').update('ABCD2345EFGH6789').digest(),
    );
    expect(mocks.query.mock.calls[3]![0]).toContain('SET claimed_by=$1');
    await app.close();
  });

  it('allows an entitled account to use another phone without another key', async () => {
    mocks.query
      .mockResolvedValueOnce(rows([user]))
      .mockResolvedValueOnce(rows([{ id: 'invite-1' }]));
    const app = Fastify();
    registerMobileBetaRoutes(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/mobile-beta/login',
      headers: mobileHeaders,
      payload: { login: user.username, password: 'Password123' },
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.issueSession).toHaveBeenCalledOnce();
    await app.close();
  });

  it('does not issue a session without an entitlement or key', async () => {
    mocks.query.mockResolvedValueOnce(rows([user])).mockResolvedValueOnce(rows());
    const app = Fastify();
    registerMobileBetaRoutes(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/mobile-beta/login',
      headers: mobileHeaders,
      payload: { login: user.email, password: 'Password123' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('MOBILE_BETA_KEY_REQUIRED');
    expect(mocks.issueSession).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects a key already claimed by another account', async () => {
    mocks.query
      .mockResolvedValueOnce(rows([user]))
      .mockResolvedValueOnce(rows())
      .mockResolvedValueOnce(rows([{ id: 'invite-1', claimed_by: 'another-user' }]));
    const app = Fastify();
    registerMobileBetaRoutes(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/mobile-beta/login',
      headers: mobileHeaders,
      payload: {
        login: user.email,
        password: 'Password123',
        key: 'TRLKA-ABCD-2345-EFGH-6789',
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('MOBILE_BETA_KEY_USED');
    expect(mocks.issueSession).not.toHaveBeenCalled();
    await app.close();
  });

  it('does not accept mobile beta keys from a desktop browser', async () => {
    const app = Fastify();
    registerMobileBetaRoutes(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/mobile-beta/login',
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      payload: {
        login: user.email,
        password: 'Password123',
        key: 'TRLKA-ABCD-2345-EFGH-6789',
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('MOBILE_DEVICE_REQUIRED');
    expect(mocks.query).not.toHaveBeenCalled();
    await app.close();
  });
});

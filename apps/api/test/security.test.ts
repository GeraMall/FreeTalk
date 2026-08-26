import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test',
    TOKEN_PEPPER: 'test-token-pepper-at-least-32-characters',
    INTERNAL_SIGNALING_SECRET: 'test-internal-secret-at-least-32-chars',
    TURNSTILE_SECRET_KEY: 'test-secret',
    IP_HASH_SALT: 'test-ip-hash-salt-long-enough',
  });
});

describe('account security primitives', () => {
  it('normalizes usernames and rejects reserved or unsafe names', async () => {
    const { usernameSchema } = await import('../src/security.js');
    expect(usernameSchema.parse('  Gera_User  ')).toBe('gera_user');
    expect(() => usernameSchema.parse('gera')).toThrow();
    expect(() => usernameSchema.parse('гера_25')).toThrow();
    expect(() => usernameSchema.parse('gera.user')).toThrow();
    expect(() => usernameSchema.parse('gera-user')).toThrow();
    expect(() => usernameSchema.parse('admin')).toThrow();
    expect(() => usernameSchema.parse('<script>')).toThrow();
  });

  it('hashes passwords with Argon2id and verifies without retaining plaintext', async () => {
    const { hashPassword, verifyPassword } = await import('../src/security.js');
    const hash = await hashPassword('SafePassword123');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('SafePassword123');
    await expect(verifyPassword(hash, 'SafePassword123')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'WrongPassword123')).resolves.toBe(false);
  });

  it('uses deterministic opaque token hashes and server-side CAPTCHA validation', async () => {
    const { randomVerificationCode, tokenHash, verifyCaptcha } = await import('../src/security.js');
    expect(tokenHash('secret-token').equals(tokenHash('secret-token'))).toBe(true);
    expect(tokenHash('secret-token').toString('hex')).not.toContain('secret-token');
    expect(randomVerificationCode()).toMatch(/^\d{6}$/);
    await expect(verifyCaptcha('test-captcha-pass')).resolves.toBe(true);
  });

  it('builds avatar URLs inside the configured API prefix', async () => {
    const { publicApiUrl } = await import('../src/env.js');
    expect(publicApiUrl('/v1/users/id/avatar')).toBe('http://127.0.0.1:8790/v1/users/id/avatar');
  });
});

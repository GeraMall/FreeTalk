import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), issue: vi.fn() }));
vi.mock('../src/db.js', () => ({
  transaction: (work: (client: unknown) => unknown) => work({ query: mocks.query }),
}));
vi.mock('../src/auth-service.js', () => ({ issueSession: mocks.issue }));
vi.mock('../src/security.js', () => ({
  tokenHash: (value: string) => createHash('sha256').update(value).digest(),
}));
import { completeEmailVerification } from '../src/email-verification.js';

const hash = (value: string) => createHash('sha256').update(value).digest();
const request = {} as FastifyRequest;
let challenge: { id: string; user_id: string; attempts: number; token_hash: Buffer };
beforeEach(() => {
  vi.clearAllMocks();
  challenge = {
    id: 'challenge',
    user_id: 'account',
    attempts: 0,
    token_hash: hash('challenge:012345'),
  };
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith('SELECT ev.')) return { rows: [{ ...challenge }] };
    if (sql.includes('SET attempts=attempts+1')) challenge.attempts++;
    return { rows: [{ id: 'account' }] };
  });
  mocks.issue.mockResolvedValue({ accessToken: 'session' });
});
describe('email verification challenge', () => {
  it('counts wrong guesses and rejects even the correct code after five failures', async () => {
    for (let index = 0; index < 5; index++) {
      await expect(
        completeEmailVerification({ email: 'person@example.com', code: '999999' }, request),
      ).resolves.toBeNull();
    }
    await expect(
      completeEmailVerification({ email: 'person@example.com', code: '012345' }, request),
    ).resolves.toBeNull();
    expect(challenge.attempts).toBe(5);
    expect(mocks.issue).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls[0]![0]).toContain('FOR UPDATE OF ev');
    expect(mocks.query.mock.calls[0]![1]).toEqual(['person@example.com']);
  });
  it('accepts an account-bound code and consumes all outstanding challenges', async () => {
    expect(
      await completeEmailVerification({ email: 'person@example.com', code: '012345' }, request),
    ).not.toBeNull();
    expect(mocks.issue).toHaveBeenCalledOnce();
    expect(
      mocks.query.mock.calls.some(([sql]) => sql.includes('SET used_at=now() WHERE user_id=$1')),
    ).toBe(true);
  });
  it('does not accept another account’s identical numeric code hash', async () => {
    challenge.token_hash = hash('another-account:012345');
    await expect(
      completeEmailVerification({ email: 'person@example.com', code: '012345' }, request),
    ).resolves.toBeNull();
  });
  it('keeps already emailed legacy codes usable during deployment', async () => {
    challenge.token_hash = hash('012345');
    expect(
      await completeEmailVerification({ email: 'person@example.com', code: '012345' }, request),
    ).not.toBeNull();
  });
});

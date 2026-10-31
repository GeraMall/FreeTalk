import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../src/db.js', () => ({ db: { query: mocks.query } }));
import { accountLoginLimited } from '../src/login-throttle.js';
describe('shared account login throttling', () => {
  it('combines browser and mobile failures across source IPs', async () => {
    mocks.query.mockResolvedValue({ rows: [{ count: '20' }] });
    expect(await accountLoginLimited('account')).toBe(true);
    const [sql, parameters] = mocks.query.mock.calls[0]!;
    expect(sql).toContain("'login.failed','mobile_beta.login_failed'");
    expect(sql).not.toContain('ip_hash');
    expect(parameters).toEqual(['account']);
    mocks.query.mockResolvedValue({ rows: [{ count: '19' }] });
    expect(await accountLoginLimited('account')).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
const query = vi.hoisted(() => vi.fn());
vi.mock('../src/db.js', () => ({
  db: { query },
  transaction: async (work: (client: { query: typeof query }) => unknown) => work({ query }),
}));
import {
  GifTransferBudget,
  beginGifUpload,
  enforceGifStorage,
  chargeGifDownload,
} from '../src/gif-limits.js';
import type { PoolClient } from 'pg';
beforeEach(() => query.mockReset());
describe('GIF resource protection', () => {
  it('bounds simultaneous response memory and releases each reservation only once', () => {
    const budget = new GifTransferBudget(64, 2);
    const a = budget.acquire(30)!,
      b = budget.acquire(30)!;
    expect(budget.acquire(1)).toBeUndefined();
    a();
    a();
    expect(budget.acquire(34)).toBeTypeOf('function');
    expect(budget.acquire(1)).toBeUndefined();
    b();
    expect(budget.acquire(0)).toBeUndefined();
    expect(budget.acquire(NaN)).toBeUndefined();
  });
  it('refuses an upload before reading a body when its account has exhausted its request allowance', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ attempts: 12, bytes: '0' }] });
    await expect(beginGifUpload('user')).rejects.toMatchObject({
      code: 'GIF_UPLOAD_RATE_LIMIT',
      status: 429,
    });
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('enforces both per-account and global storage budgets', async () => {
    const client = { query } as unknown as PoolClient;
    query.mockResolvedValueOnce({ rows: [{ owned: String(128 * 1024 * 1024), total: '0' }] });
    await expect(enforceGifStorage(client, 'user', 1)).rejects.toMatchObject({
      code: 'GIF_ACCOUNT_STORAGE_FULL',
    });
    query.mockResolvedValueOnce({ rows: [{ owned: '0', total: String(512 * 1024 * 1024) }] });
    await expect(enforceGifStorage(client, 'user', 1)).rejects.toMatchObject({
      code: 'GIF_STORAGE_FULL',
    });
  });
  it('does not read a large binary when a bandwidth allowance has already been exhausted', async () => {
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(chargeGifDownload('user', 100)).rejects.toMatchObject({
      code: 'GIF_DOWNLOAD_LIMIT',
      status: 429,
    });
    expect(query).toHaveBeenCalledOnce();
  });
});

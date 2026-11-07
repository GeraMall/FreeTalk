import { expect, it, vi } from 'vitest';
import { ServerEndpoints } from './server-endpoints';

const health = () => new Response(JSON.stringify({ ok: true, service: 'freetalk-api' }));
it('selects the reserve when the primary is unreachable without sending credentials to probes', async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce(health());
  const pool = new ServerEndpoints(['https://main.test/api', 'https://reserve.test/api'], fetcher);
  expect(await pool.ready()).toBe('https://reserve.test/api');
  expect(fetcher.mock.calls.every(([, init]) => !init.headers)).toBe(true);
  expect(fetcher.mock.calls[1][1]).toMatchObject({ credentials: 'omit', redirect: 'error' });
});
it('rejects empty or unrelated 200 pages and reuses a recent successful health check', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('')).mockResolvedValueOnce(health());
  const pool = new ServerEndpoints(['https://main.test/api', 'https://reserve.test/api'], fetcher);
  await Promise.all([pool.ready(), pool.ready(), pool.ready()]);
  await pool.ready();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('retries a failed GET once on the alternate endpoint', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(health())
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce(health())
    .mockResolvedValueOnce(new Response('messages'));
  const pool = new ServerEndpoints(['https://main.test/api', 'https://reserve.test/api'], fetcher);
  expect(await (await pool.fetch('/v1/chats')).text()).toBe('messages');
  expect(fetcher.mock.calls.at(-1)?.[0]).toBe('https://reserve.test/api/v1/chats');
});
it.each(['POST', 'PATCH', 'DELETE'])('does not replay an ambiguous %s request', async (method) => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(health())
    .mockRejectedValueOnce(new TypeError('lost response'));
  const pool = new ServerEndpoints(['https://main.test/api', 'https://reserve.test/api'], fetcher);
  await expect(pool.fetch('/v1/messages', { method, body: 'hello' })).rejects.toThrow(
    'lost response',
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('preserves HTTP errors and does not treat authentication failure as node failure', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(health())
    .mockResolvedValueOnce(new Response('', { status: 401 }));
  const pool = new ServerEndpoints(['https://main.test/api', 'https://reserve.test/api'], fetcher);
  expect((await pool.fetch('/v1/me')).status).toBe(401);
  expect(pool.current).toBe('https://main.test/api');
});

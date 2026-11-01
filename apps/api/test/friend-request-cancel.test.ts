import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const query = vi.hoisted(() => vi.fn());
vi.mock('../src/db.js', () => ({
  db: { query },
  transaction: async (work: (client: { query: typeof query }) => unknown) => work({ query }),
}));
vi.mock('../src/env.js', () => ({
  env: {},
  publicApiUrl: (path: string) => `https://api.example.test${path}`,
}));
import { registerSocialRoutes } from '../src/social-routes.js';
import { chatRealtimeHub } from '../src/chat-realtime.js';
const self = '11111111-1111-4111-8111-111111111111',
  peer = '22222222-2222-4222-8222-222222222222',
  requestId = '33333333-3333-4333-8333-333333333333';
let app: ReturnType<typeof Fastify>;
beforeEach(() => {
  query.mockReset();
  app = Fastify();
  registerSocialRoutes(app, async () => ({ id: self }) as never);
});
afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
});
describe('outgoing friend request cancellation', () => {
  it('cancels an outgoing request and notifies both accounts after the write succeeds', async () => {
    query.mockImplementation(async (sql: string) =>
      sql.startsWith('UPDATE friend_requests')
        ? { rows: [{ recipient_id: peer }], rowCount: 1 }
        : { rows: [], rowCount: 0 },
    );
    const publish = vi.spyOn(chatRealtimeHub, 'publish');
    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/friends/requests/${requestId}`,
    });
    expect(response.statusCode).toBe(204);
    expect(
      query.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE friend_requests'))![1],
    ).toEqual([requestId, self]);
    expect(publish).toHaveBeenCalledWith([self, peer], { type: 'friends-updated' });
  });
  it('does not announce a cancellation when the request no longer belongs to the sender or is already resolved', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    const publish = vi.spyOn(chatRealtimeHub, 'publish');
    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/friends/requests/${requestId}`,
    });
    expect(response.statusCode).toBe(404);
    expect(publish).not.toHaveBeenCalled();
  });
});

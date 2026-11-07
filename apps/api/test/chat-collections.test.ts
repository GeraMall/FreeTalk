import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const query = vi.hoisted(() => vi.fn());
vi.mock('../src/db.js', () => ({
  db: { query },
  transaction: async (work: (client: { query: typeof query }) => unknown) => work({ query }),
}));
vi.mock('../src/env.js', () => ({ env: {}, publicApiUrl: (path: string) => path }));
import { registerSocialRoutes } from '../src/social-routes.js';
import { chatRealtimeHub } from '../src/chat-realtime.js';

const userId = '11111111-1111-4111-8111-111111111111';
const chatId = '22222222-2222-4222-8222-222222222222';
const result = (rows: object[] = []) => ({ rows, rowCount: rows.length });
let app: ReturnType<typeof Fastify>;
beforeEach(() => {
  query.mockReset().mockResolvedValue(result());
  app = Fastify();
  registerSocialRoutes(app, async () => ({ id: userId }) as never);
});
afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
});

describe('personal chat collections', () => {
  it.each([undefined, '1'])(
    'keeps saved chats out of legacy client lists: capability %s',
    async (capability) => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/chats',
        headers: capability ? { 'x-trlka-chat-collections': capability } : {},
      });
      expect(response.statusCode).toBe(200);
      const listing = query.mock.calls.find(([sql]) => sql.includes('NOT c.is_saved OR'));
      expect(listing?.[1]).toEqual([userId, '', capability === '1']);
    },
  );
  it('returns the same private notebook on repeated opens without inserting welcome messages', async () => {
    query.mockImplementation(async (sql: string) =>
      sql.startsWith('INSERT INTO chats') ? result([{ id: chatId }]) : result(),
    );
    const publish = vi.spyOn(chatRealtimeHub, 'publish');
    for (let index = 0; index < 2; index++) {
      const response = await app.inject({ method: 'POST', url: '/v1/chats/saved' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ chat: { id: chatId } });
    }
    expect(query.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO chat_members'))).toEqual([
      expect.arrayContaining([expect.any(String), [chatId, userId]]),
      expect.arrayContaining([expect.any(String), [chatId, userId]]),
    ]);
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO messages'))).toBe(false);
    expect(publish).toHaveBeenCalledWith([userId], { type: 'chat-updated', chatId });
  });

  it.each([true, false])(
    'changes only the signed-in member archive preference: %s',
    async (archived) => {
      query.mockResolvedValue(result([{ chat_id: chatId }]));
      const publish = vi.spyOn(chatRealtimeHub, 'publish');
      const response = await app.inject({
        method: 'PATCH',
        url: `/v1/chats/${chatId}/archive`,
        payload: { archived },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ archived });
      expect(query).toHaveBeenCalledWith(expect.stringContaining('self.user_id=$2'), [
        chatId,
        userId,
        archived,
      ]);
      expect(publish).toHaveBeenCalledExactlyOnceWith([userId], { type: 'chat-updated', chatId });
    },
  );

  it('does not publish a change for an inaccessible or saved chat', async () => {
    const publish = vi.spyOn(chatRealtimeHub, 'publish');
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/chats/${chatId}/archive`,
      payload: { archived: true },
    });
    expect(response.statusCode).toBe(404);
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not expose notebook messages to an account without membership', async () => {
    const response = await app.inject({ method: 'GET', url: `/v1/chats/${chatId}/messages` });
    expect(response.statusCode).toBe(403);
    expect(query.mock.calls.some(([sql]) => sql.includes('FROM messages'))).toBe(false);
  });

  it('rejects calls from saved messages even for its owner', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT 1 FROM chat_members')) return result([{}]);
      if (sql.includes('END AS allowed')) return result([{ allowed: true }]);
      if (sql.includes('AND is_saved')) return result([{}]);
      return result();
    });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/chats/${chatId}/calls`,
      payload: { roomId: 'ABCDEFGHJKLM' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('SAVED_CHAT_CANNOT_CALL');
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO messages'))).toBe(false);
  });
});

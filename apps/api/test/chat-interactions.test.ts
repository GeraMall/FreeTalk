import Fastify from 'fastify';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { query, publish } = vi.hoisted(() => ({ query: vi.fn(), publish: vi.fn() }));
vi.mock('../src/db.js', () => ({ db: { query } }));
vi.mock('../src/chat-realtime.js', () => ({ chatRealtimeHub: { publish } }));
vi.mock('../src/env.js', () => ({ publicApiUrl: (path: string) => `https://test.invalid${path}` }));
import { registerChatInteractions } from '../src/chat-interactions.js';
const self = '00000000-0000-4000-8000-000000000001',
  other = '00000000-0000-4000-8000-000000000002',
  chat = '00000000-0000-4000-8000-000000000003',
  message = '00000000-0000-4000-8000-000000000004';
let app: ReturnType<typeof Fastify>;
beforeEach(() => {
  query
    .mockReset()
    .mockResolvedValue({ rows: [{ user_id: self }, { user_id: other }], rowCount: 2 });
  publish.mockReset();
  app = Fastify();
  registerChatInteractions(app, async () => ({ id: self, display_name: 'Гера' }) as never);
});
afterEach(async () => {
  await app.close();
});
it('broadcasts only the authenticated identity and expires typing without storing drafts', async () => {
  const before = Date.now();
  const result = await app.inject({
    method: 'POST',
    url: `/v1/chats/${chat}/typing`,
    payload: { active: true },
  });
  expect(result.statusCode).toBe(200);
  expect(publish).toHaveBeenCalledWith([other], {
    type: 'chat-typing',
    chatId: chat,
    userId: self,
    name: 'Гера',
    expiresAt: expect.any(Number),
  });
  expect(publish.mock.calls[0][1].expiresAt).toBeGreaterThanOrEqual(before + 5000);
  await app.inject({ method: 'POST', url: `/v1/chats/${chat}/typing`, payload: { active: false } });
  expect(publish.mock.calls.at(-1)![1].expiresAt).toBe(0);
  expect(query.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true);
});
it('rejects forged fields and requires membership for every action', async () => {
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/v1/chats/${chat}/typing`,
        payload: { active: true, userId: other },
      })
    ).statusCode,
  ).toBe(400);
  expect(query).not.toHaveBeenCalled();
  query.mockResolvedValue({ rows: [] });
  for (const [method, path, payload] of [
    ['POST', 'typing', { active: true }],
    ['POST', 'reads', { ids: [message] }],
    ['GET', `messages/${message}/readers`, undefined],
  ] as const) {
    expect(
      (await app.inject({ method, url: `/v1/chats/${chat}/${path}`, payload })).statusCode,
    ).toBe(403);
  }
  expect(publish).not.toHaveBeenCalled();
  expect(query.mock.calls[0][0]).toContain('blocks');
});
it('deduplicates read batches and preserves first read time with author/deletion/expiry constraints', async () => {
  query
    .mockResolvedValueOnce({ rows: [{ user_id: self }, { user_id: other }] })
    .mockResolvedValueOnce({ rows: [{ message_id: message }] });
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/v1/chats/${chat}/reads`,
        payload: { ids: [message, message] },
      })
    ).statusCode,
  ).toBe(200);
  const [sql, values] = query.mock.calls[1];
  expect(values).toEqual([chat, self, [message]]);
  for (const clause of [
    'sender_id <> $2',
    'expires_at>now()',
    "metadata->>'deleted'",
    'DO NOTHING',
  ])
    expect(sql).toContain(clause);
  expect(publish).toHaveBeenCalledWith([self, other], {
    type: 'chat-reads',
    chatId: chat,
    messageIds: [message],
  });
});
it('does not broadcast duplicate reads and bounds batch size', async () => {
  query.mockResolvedValueOnce({ rows: [{ user_id: self }] }).mockResolvedValueOnce({ rows: [] });
  await app.inject({ method: 'POST', url: `/v1/chats/${chat}/reads`, payload: { ids: [message] } });
  expect(publish).not.toHaveBeenCalled();
  for (const ids of [[], Array(51).fill(message), ['invalid']])
    expect(
      (await app.inject({ method: 'POST', url: `/v1/chats/${chat}/reads`, payload: { ids } }))
        .statusCode,
    ).toBe(400);
});
it('never exposes another author’s readers and returns actual first timestamps', async () => {
  query
    .mockResolvedValueOnce({ rows: [{ user_id: self }] })
    .mockResolvedValueOnce({ rows: [], rowCount: 0 });
  expect(
    (await app.inject({ method: 'GET', url: `/v1/chats/${chat}/messages/${message}/readers` }))
      .statusCode,
  ).toBe(404);
  expect(query.mock.calls[1][1]).toEqual([message, chat, self]);
  query
    .mockResolvedValueOnce({ rows: [{ user_id: self }] })
    .mockResolvedValueOnce({ rows: [{}], rowCount: 1 })
    .mockResolvedValueOnce({
      rows: [
        {
          id: other,
          display_name: 'Alex',
          username: 'alex',
          read_at: new Date('2026-11-08T12:00:00Z'),
          has_avatar: false,
        },
      ],
    });
  const response = await app.inject({
    method: 'GET',
    url: `/v1/chats/${chat}/messages/${message}/readers`,
  });
  expect(response.json()).toEqual({
    readers: [
      {
        id: other,
        name: 'Alex',
        username: 'alex',
        readAt: '2026-11-08T12:00:00.000Z',
        avatarUrl: null,
      },
    ],
  });
});

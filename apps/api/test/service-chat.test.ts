import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const query = vi.hoisted(() => vi.fn());
const publish = vi.hoisted(() => vi.fn());
const config = vi.hoisted(() => ({ SUPPORT_EMAIL: 'support@example.invalid' }));
vi.mock('../src/db.js', () => ({
  db: { query },
  transaction: async (work: (client: { query: typeof query }) => unknown) => work({ query }),
}));
vi.mock('../src/env.js', () => ({ env: config }));
vi.mock('../src/chat-realtime.js', () => ({ chatRealtimeHub: { publish } }));
vi.mock('../src/mailer.js', () => ({ sendSupportReport: vi.fn() }));
import { registerServiceChat } from '../src/service-chat.js';
const userId = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222';
const result = (rows: unknown[] = []) => ({ rows, rowCount: rows.length });
let authenticated = true;
let app: ReturnType<typeof Fastify>;
beforeEach(async () => {
  authenticated = true;
  query.mockReset();
  publish.mockReset();
  config.SUPPORT_EMAIL = 'support@example.invalid';
  query.mockImplementation(async (sql: string, args: unknown[]) => {
    if (sql.includes('SELECT pending_kind')) return result([{ pending_kind: null }]);
    if (sql.includes('personal,')) return result([{ personal: 0, ideas: 0, global: 0 }]);
    if (sql.startsWith('INSERT INTO service_chat_messages'))
      return result([
        {
          id: crypto.randomUUID(),
          author: args[1],
          kind: args[2],
          body: args[3],
          created_at: new Date(),
        },
      ]);
    if (sql.includes('FROM call_participants')) return result([{ ok: 1 }]);
    return result();
  });
  app = Fastify();
  registerServiceChat(app, async (_req, reply) => {
    if (!authenticated) {
      reply.code(401).send();
      return null;
    }
    return { id: userId, username: 'tester' } as never;
  });
  await app.ready();
});
afterEach(async () => {
  await app.close();
});
describe('private service chat', () => {
  it('rejects unauthenticated history and sending', async () => {
    authenticated = false;
    expect((await app.inject('/v1/service-chat/messages')).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/service-chat/messages',
          payload: { body: '/help' },
        })
      ).statusCode,
    ).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
  it('uses the session owner for history even when another ID is in the query', async () => {
    await app.inject(`/v1/service-chat/messages?userId=${other}`);
    const reads = query.mock.calls.filter(([sql]) =>
      String(sql).includes('ORDER BY created_at DESC,id DESC LIMIT 100'),
    );
    expect(reads[0]?.[1]).toEqual([userId, '']);
  });
  it('searches only the session owner history with a parameterized substring', async () => {
    await app.inject(`/v1/service-chat/messages?search=котята&userId=${other}`);
    const reads = query.mock.calls.filter(([sql]) =>
      String(sql).includes('strpos(lower(body),lower($2))'),
    );
    expect(reads[0]?.[1]).toEqual([userId, 'котята']);
  });
  it('limits ideas separately to one per rolling 24 hours without blocking bug reports', async () => {
    query.mockImplementation(async (sql: string) =>
      sql.includes('SELECT pending_kind')
        ? result([{ pending_kind: null }])
        : sql.includes('personal,')
          ? result([{ personal: 1, ideas: 1, global: 1 }])
          : result(),
    );
    const idea = await app.inject({
      method: 'POST',
      url: '/v1/service-chat/messages',
      payload: { requestId: crypto.randomUUID(), body: '/idea Добавить полезное улучшение' },
    });
    expect(idea.statusCode).toBe(429);
    expect(idea.json().code).toBe('IDEA_LIMIT');
    const bug = await app.inject({
      method: 'POST',
      url: '/v1/service-chat/messages',
      payload: { requestId: crypto.randomUUID(), body: '/bug Не работает кнопка камеры' },
    });
    expect(bug.statusCode).toBe(200);
  });
  it('queues one accepted report and publishes only to its owner', async () => {
    const id = crypto.randomUUID();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/service-chat/messages',
      payload: { requestId: id, body: '/bug Не включается камера в звонке', version: 'test' },
    });
    expect(response.statusCode).toBe(200);
    expect(
      query.mock.calls.some(
        ([sql, args]) =>
          String(sql).startsWith('INSERT INTO support_reports') &&
          args[0] === id &&
          args[1] === userId,
      ),
    ).toBe(true);
    expect(
      publish.mock.calls.every(
        ([recipients]) => JSON.stringify(recipients) === JSON.stringify([userId]),
      ),
    ).toBe(true);
  });
  it('does not promise submission when mail delivery is unconfigured', async () => {
    config.SUPPORT_EMAIL = '';
    const r = await app.inject({
      method: 'POST',
      url: '/v1/service-chat/messages',
      payload: { requestId: crypto.randomUUID(), body: '/bug Сломалась кнопка входа' },
    });
    expect(r.statusCode).toBe(503);
    expect(
      query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT INTO support_reports')),
    ).toBe(false);
  });
  it('enforces the per-account daily quota before writing a report', async () => {
    query.mockImplementation(async (sql: string) =>
      sql.includes('SELECT pending_kind')
        ? result([{ pending_kind: null }])
        : sql.includes('personal,')
          ? result([{ personal: 5, global: 5 }])
          : result(),
    );
    const r = await app.inject({
      method: 'POST',
      url: '/v1/service-chat/messages',
      payload: { requestId: crypto.randomUUID(), body: '/idea Добавить новую настройку' },
    });
    expect(r.statusCode).toBe(429);
    expect(
      query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT INTO support_reports')),
    ).toBe(false);
  });
  it('does not replay a request already accepted by this account', async () => {
    query.mockImplementation(async (sql: string) =>
      sql.includes('SELECT pending_kind')
        ? result([{ pending_kind: null }])
        : sql.includes('event_key=$2')
          ? result([{ ok: 1 }])
          : result(),
    );
    const r = await app.inject({
      method: 'POST',
      url: '/v1/service-chat/messages',
      payload: { requestId: crypto.randomUUID(), body: '/bug Проблема с камерой' },
    });
    expect(r.statusCode).toBe(200);
    expect(publish).not.toHaveBeenCalled();
    expect(
      query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT INTO support_reports')),
    ).toBe(false);
  });
  it('rejects a timeout event left over from a different account', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/service-chat/call-timeout',
      payload: { userId: other, eventId: crypto.randomUUID(), roomId: 'ABCDEFGHJKLM' },
    });
    expect(r.statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });
});

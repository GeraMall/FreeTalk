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
  it('captures only the sender missing birthday and privately refreshes age access without mailing support', async () => {
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string, args: unknown[]) => {
      if (sql.startsWith('SELECT birth_date')) return result([{ birth_date: null }]);
      if (sql.startsWith('UPDATE users SET birth_date')) return result([{ id: userId }]);
      return original(sql, args);
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/service-chat/messages',
      payload: { requestId: crypto.randomUUID(), body: '25.12.2000', userId: other },
    });
    expect(response.statusCode).toBe(200);
    const update = query.mock.calls.find(([sql]) =>
      String(sql).startsWith('UPDATE users SET birth_date'),
    );
    expect(update?.[1]).toEqual([userId, '2000-12-25']);
    expect(update?.[0]).toContain('birth_date IS NULL');
    expect(publish).toHaveBeenCalledWith([userId], { type: 'profile-updated', userId });
    expect(
      query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT INTO support_reports')),
    ).toBe(false);
  });
  it('does not overwrite a saved birthday or store an impossible date', async () => {
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string, args: unknown[]) =>
      sql.startsWith('SELECT birth_date')
        ? result([{ birth_date: '2010-01-01' }])
        : original(sql, args),
    );
    await app.inject({
      method: 'POST',
      url: '/v1/service-chat/messages',
      payload: { requestId: crypto.randomUUID(), body: '01.01.1990' },
    });
    expect(
      query.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE users SET birth_date')),
    ).toBe(false);
    query.mockImplementation(async (sql: string, args: unknown[]) =>
      sql.startsWith('SELECT birth_date') ? result([{ birth_date: null }]) : original(sql, args),
    );
    await app.inject({
      method: 'POST',
      url: '/v1/service-chat/messages',
      payload: { requestId: crypto.randomUUID(), body: '31.02.2000' },
    });
    expect(
      query.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE users SET birth_date')),
    ).toBe(false);
  });
  it('targets birthday reminders only at the account missing its date, with a deduplication key', async () => {
    await app.inject('/v1/service-chat/messages');
    const reminder = query.mock.calls.find(([sql]) => String(sql).includes("'birth-date-request'"));
    expect(reminder?.[0]).toContain('birth_date IS NULL');
    expect(reminder?.[0]).toContain('ON CONFLICT(user_id,event_key) DO NOTHING');
    expect(reminder?.[1][0]).toBe(userId);
  });
  it('notifies a verified solo caller and checks that nobody else was present during the timeout', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/service-chat/call-timeout',
      payload: { userId, eventId: crypto.randomUUID(), roomId: 'ABCDEFGHJKLM' },
    });
    expect(response.statusCode).toBe(200);
    const validation = query.mock.calls.find(([sql]) =>
      String(sql).includes('FROM call_participants p JOIN call_sessions'),
    );
    expect(validation?.[1]).toEqual(['ABCDEFGHJKLM', userId]);
    expect(validation?.[0]).toContain('NOT EXISTS');
    expect(validation?.[0]).toContain('person.user_id IS DISTINCT FROM $2');
    expect(validation?.[0]).not.toContain('count(DISTINCT');
    expect(
      query.mock.calls.find(([sql]) =>
        String(sql).startsWith('INSERT INTO service_chat_messages'),
      )?.[1][3],
    ).toContain('одни более пяти минут');
  });
  it('does not send a solo timeout notice when the server cannot verify the waiting interval', async () => {
    query.mockResolvedValue(result());
    const response = await app.inject({
      method: 'POST',
      url: '/v1/service-chat/call-timeout',
      payload: { userId, eventId: crypto.randomUUID(), roomId: 'ABCDEFGHJKLM' },
    });
    expect(response.statusCode).toBe(404);
    expect(publish).not.toHaveBeenCalled();
  });

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

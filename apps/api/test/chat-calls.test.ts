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

const self = '11111111-1111-4111-8111-111111111111';
const peer = '22222222-2222-4222-8222-222222222222';
const friend = '33333333-3333-4333-8333-333333333333';
const chat = '44444444-4444-4444-8444-444444444444';
const group = '55555555-5555-4555-8555-555555555555';
const room = 'ABCDEFGHJKLM';
const result = (rows: object[] = []) => ({ rows, rowCount: rows.length });
let app: ReturnType<typeof Fastify>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  query.mockReset();
  query.mockResolvedValue(result());
  app = Fastify();
  registerSocialRoutes(
    app,
    async () =>
      ({ id: self, display_name: 'Гера', avatar_data: null, updated_at: new Date() }) as never,
  );
});
afterEach(async () => {
  await app.close();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('conversation calls', () => {
  it('does not reveal active calls to non-members', async () => {
    const response = await app.inject({ method: 'GET', url: `/v1/chats/${chat}/active-call` });
    expect(response.statusCode).toBe(403);
    expect(query.mock.calls.some(([sql]) => sql.includes('SELECT room_id'))).toBe(false);
  });
  it('returns no waiting panel for an ended call', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT 1 FROM chat_members')) return result([{}]);
      if (sql.includes('END AS allowed')) return result([{ allowed: true }]);
      return result();
    });
    const response = await app.inject({ method: 'GET', url: `/v1/chats/${chat}/active-call` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ call: null });
  });
  it('returns current participants to chat members after the ringing invitation expires', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT 1 FROM chat_members')) return result([{}]);
      if (sql.includes('END AS allowed')) return result([{ allowed: true }]);
      if (sql.startsWith('SELECT room_id')) return result([{ room_id: room }]);
      if (sql.includes('SELECT session.id,session.room_id'))
        return result([{ id: 'session', room_id: room, chat_id: chat, title: null }]);
      if (sql.includes('SELECT DISTINCT p.user_id'))
        return result([{ user_id: peer, display_name: 'Алексей', has_avatar: false }]);
      if (sql.includes('SELECT m.user_id,u.display_name'))
        return result([
          { user_id: self, display_name: 'Гера' },
          { user_id: peer, display_name: 'Алексей' },
        ]);
      return result();
    });
    const response = await app.inject({ method: 'GET', url: `/v1/chats/${chat}/active-call` });
    expect(response.statusCode).toBe(200);
    expect(response.json().call.participants).toEqual([
      { userId: peer, displayName: 'Алексей', avatarUrl: null },
    ]);
  });
  it('moves a direct call into a new named group while retaining the same media room', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT session.id,session.chat_id'))
        return result([{ id: 'session', chat_id: chat }]);
      if (sql.includes('participant_count'))
        return result([
          { user_id: self, participant_count: 2 },
          { user_id: peer, participant_count: 2 },
        ]);
      if (sql.includes('SELECT target.id')) return result([{ id: friend }]);
      if (sql.startsWith('SELECT type FROM chats')) return result([{ type: 'direct' }]);
      if (sql.startsWith('SELECT user_id FROM chat_members'))
        return result([{ user_id: self }, { user_id: peer }]);
      if (sql.startsWith('SELECT display_name FROM users'))
        return result([
          { display_name: 'Гера' },
          { display_name: 'Алексей' },
          { display_name: 'Мария' },
        ]);
      if (sql.includes('INSERT INTO chats')) return result([{ id: group }]);
      if (sql.includes('INSERT INTO call_invitations'))
        return result([{ id: 'invite', expires_at: new Date(Date.now() + 30000) }]);
      return result();
    });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/calls/${room}/invitations`,
      payload: { userIds: [friend] },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().chatId).toBe(group);
    expect(query.mock.calls).toEqual(
      expect.arrayContaining([
        [expect.stringContaining('INSERT INTO chats'), ['Гера, Алексей, Мария', self]],
        ['UPDATE call_sessions SET chat_id=$1 WHERE id=$2', [group, 'session']],
        [
          expect.stringContaining('INSERT INTO call_invitations'),
          ['session', room, self, friend, group],
        ],
      ]),
    );
    expect(
      query.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO chat_members')),
    ).toHaveLength(3);
    expect(query.mock.calls.some(([sql]) => sql.includes('DELETE FROM chats'))).toBe(false);
  });
  it('rejects inviting a non-friend before creating a group', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT session.id,session.chat_id'))
        return result([{ id: 'session', chat_id: chat }]);
      if (sql.includes('participant_count'))
        return result([{ user_id: self, participant_count: 1 }]);
      return result();
    });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/calls/${room}/invitations`,
      payload: { userIds: [friend] },
    });
    expect(response.statusCode).toBe(403);
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO chats'))).toBe(false);
  });
});

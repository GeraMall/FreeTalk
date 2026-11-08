import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const query = vi.hoisted(() => vi.fn());
vi.mock('../src/db.js', () => ({ db: { query } }));
import { registerAppearance } from '../src/appearance.js';
let app: ReturnType<typeof Fastify>;
beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] });
  app = Fastify();
  registerAppearance(app, async () => ({ id: 'self' }) as never);
});
afterEach(async () => {
  await app.close();
});
describe('appearance preferences', () => {
  it('starts with sync disabled and reads only the authenticated account', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/me/appearance' });
    expect(response.json()).toEqual({ appearance: { theme: 'default', syncEnabled: false } });
    expect(query.mock.calls[0][1]).toEqual(['self']);
  });
  it('stores an explicit opt-in with the selected theme and allows disabling it', async () => {
    for (const syncEnabled of [true, false]) {
      const response = await app.inject({
        method: 'PUT',
        url: '/v1/me/appearance',
        payload: { theme: 'light', syncEnabled },
      });
      expect(response.statusCode).toBe(200);
      expect(query.mock.calls.at(-1)![1]).toEqual(['self', 'light', syncEnabled]);
    }
  });
  it('rejects unsupported themes, arbitrary fields, and missing opt-in', async () => {
    for (const payload of [
      { theme: 'pink', syncEnabled: true },
      { theme: 'light', syncEnabled: true, userId: 'other' },
      { theme: 'light' },
    ])
      expect(
        (await app.inject({ method: 'PUT', url: '/v1/me/appearance', payload })).statusCode,
      ).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
  it('requires authentication for reads and writes', async () => {
    const locked = Fastify();
    registerAppearance(locked, async (_req, reply) => {
      reply.code(401).send();
      return null;
    });
    for (const method of ['GET', 'PUT'] as const)
      expect((await locked.inject({ method, url: '/v1/me/appearance' })).statusCode).toBe(401);
    expect(query).not.toHaveBeenCalled();
    await locked.close();
  });
});

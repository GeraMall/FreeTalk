import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminApi } from './api';

const session = {
  accessToken: 'a'.repeat(48),
  refreshToken: 'r'.repeat(48),
  accessExpiresAt: new Date(Date.now() + 60_000).toISOString(),
};
const user = { id: 'user-id', email: 'user@example.test', username: 'user_1', displayName: 'User' };

describe('Admin API session boundary', () => {
  afterEach(async () => {
    await adminApi.logout().catch(() => undefined);
    vi.unstubAllGlobals();
  });

  it('clears a newly issued session when the server rejects the admin role', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ user, session }))
        .mockResolvedValueOnce(Response.json({ message: 'Недостаточно прав' }, { status: 403 })),
    );

    await expect(adminApi.login('user_1', 'password')).rejects.toThrow('Недостаточно прав');
    await expect(adminApi.request('/v1/admin/overview')).rejects.toThrow('Требуется вход');
  });

  it('accepts the session only after server-side admin validation', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ user, session }))
        .mockResolvedValueOnce(Response.json({ user, role: 'admin' }))
        .mockResolvedValueOnce(Response.json({ generatedAt: new Date().toISOString() })),
    );

    await expect(adminApi.login('user_1', 'password')).resolves.toEqual(user);
    await expect(adminApi.request('/v1/admin/overview')).resolves.toHaveProperty('generatedAt');
  });
});

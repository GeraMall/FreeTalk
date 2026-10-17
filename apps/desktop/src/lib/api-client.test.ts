// @vitest-environment jsdom

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountClient } from './api-client';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => vi.unstubAllGlobals());

it('persists a browser refresh token across client restarts', async () => {
  const user = {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'mobile@example.com',
    username: 'mobile',
    displayName: 'Mobile',
    emailVerified: true,
    avatarUrl: null,
    registeredAt: new Date().toISOString(),
  };
  const session = {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    accessExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ user, session }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          session: { ...session, accessToken: 'access-2', refreshToken: 'refresh-2' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ user }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  vi.stubGlobal('fetch', fetchMock);

  await new AccountClient().mobileBetaLogin(user.email, 'Password123', 'TRLKA-TEST');
  expect(localStorage.getItem('trlka.browser.refresh-token')).toBe('refresh-1');
  expect(sessionStorage.getItem('trlka.browser.refresh-token')).toBeNull();

  await expect(new AccountClient().restore()).resolves.toMatchObject({ id: user.id });
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ refreshToken: 'refresh-1' });
  expect(localStorage.getItem('trlka.browser.refresh-token')).toBe('refresh-2');
});

it('requests a numeric reset code and supplies email after a fresh client is created', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ message: 'sent' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  await new AccountClient().forgotPassword('test@example.com');
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    email: 'test@example.com',
    codeFormat: 'numeric',
  });
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ changed: true }), { status: 200 }));
  await new AccountClient().resetPassword('012345', 'Password12345', ' TEST@example.com ');
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
    email: 'test@example.com',
    token: '012345',
    password: 'Password12345',
  });
});

import { afterEach, expect, it, vi } from 'vitest';
import { AccountClient } from './api-client';

afterEach(() => vi.unstubAllGlobals());

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

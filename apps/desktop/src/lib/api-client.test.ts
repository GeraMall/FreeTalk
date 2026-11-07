// @vitest-environment jsdom

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountClient } from './api-client';

// These tests exercise account/session behavior with a single mocked API.
// CI also supplies production build URLs; do not let those enable health probes
// and consume the responses intended for account requests in this suite.
vi.hoisted(() => vi.stubEnv('VITE_API_URL', 'http://127.0.0.1:8790'));

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

it.each(['network', 'server'])(
  'keeps the saved login after a temporary %s failure and can restore it later',
  async (failure) => {
    localStorage.setItem('trlka.browser.refresh-token', 'keep-me');
    const fetchMock = vi.fn();
    if (failure === 'network') fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    else
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Unavailable' }), { status: 503 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new AccountClient();
    await expect(client.restore()).rejects.toThrow();
    expect(localStorage.getItem('trlka.browser.refresh-token')).toBe('keep-me');
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            session: {
              accessToken: 'restored-access',
              refreshToken: 'rotated-refresh',
              accessExpiresAt: new Date(Date.now() + 60_000).toISOString(),
              refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user: { id: 'restored-user' } }), { status: 200 }),
      );
    await expect(client.restore()).resolves.toMatchObject({ id: 'restored-user' });
    expect(localStorage.getItem('trlka.browser.refresh-token')).toBe('rotated-refresh');
  },
);

it('retains the rotated refresh token if profile loading fails after rotation', async () => {
  localStorage.setItem('trlka.browser.refresh-token', 'old-refresh');
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            session: {
              accessToken: 'new-access',
              refreshToken: 'new-refresh',
              accessExpiresAt: new Date(Date.now() + 60_000).toISOString(),
              refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
            },
          }),
          { status: 200 },
        ),
      )
      .mockRejectedValueOnce(new TypeError('Connection lost')),
  );
  await expect(new AccountClient().restore()).rejects.toThrow('Connection lost');
  expect(localStorage.getItem('trlka.browser.refresh-token')).toBe('new-refresh');
});

it.each([401, 403])('removes a session explicitly rejected with HTTP %s', async (status) => {
  localStorage.setItem('trlka.browser.refresh-token', 'revoked-refresh');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), { status })),
  );
  await expect(new AccountClient().restore()).resolves.toBeNull();
  expect(localStorage.getItem('trlka.browser.refresh-token')).toBeNull();
});

it('bounds a stalled session restore and keeps the login available for retry', async () => {
  vi.useFakeTimers();
  try {
    localStorage.setItem('trlka.browser.refresh-token', 'stalled-refresh');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('Timeout', 'AbortError')),
            );
          }),
      ),
    );
    const attempt = new AccountClient().restore();
    const rejected = expect(attempt).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(localStorage.getItem('trlka.browser.refresh-token')).toBe('stalled-refresh');
  } finally {
    vi.useRealTimers();
  }
});

it('shares an in-flight chat history request and waits before retrying a rate limit', async () => {
  vi.useFakeTimers();
  try {
    const user = {
      id: '00000000-0000-4000-8000-000000000001',
      email: 'mac@example.com',
      username: 'mac_user',
      displayName: 'Mac user',
      emailVerified: true,
      registeredAt: new Date().toISOString(),
    };
    const session = {
      accessToken: 'access',
      refreshToken: 'refresh',
      accessExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ user, session })))
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '7' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [] })));
    vi.stubGlobal('fetch', fetchMock);
    const client = new AccountClient();
    await client.mobileBetaLogin(user.email, 'Password123', 'TRLKA-TEST');

    const first = client.chatHistory('test-chat');
    const second = client.chatHistory('test-chat');
    await vi.advanceTimersByTimeAsync(6999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(Promise.all([first, second])).resolves.toEqual([
      { messages: [] },
      { messages: [] },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  } finally {
    vi.useRealTimers();
  }
});

it('streams file progress and coalesces concurrent downloads without slowing the transfer', async () => {
  const client = new AccountClient();
  const user = {
    id: 'download-user',
    email: 'qa@example.com',
    username: 'qa',
    displayName: 'QA',
    emailVerified: true,
    avatarUrl: null,
    registeredAt: new Date().toISOString(),
  };
  const session = {
    accessToken: 'access',
    refreshToken: 'refresh',
    accessExpiresAt: new Date(Date.now() + 60000).toISOString(),
    refreshExpiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      stream = controller;
    },
  });
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ user, session })))
    .mockResolvedValueOnce(
      new Response(body, {
        headers: { 'content-length': '6', 'content-type': 'application/octet-stream' },
      }),
    );
  vi.stubGlobal('fetch', fetchMock);
  await client.mobileBetaLogin(user.email, 'Password123', 'TRLKA-TEST');
  const first = vi.fn(),
    second = vi.fn();
  const a = client.chatFileBlob('file-1', first),
    b = client.chatFileBlob('file-1', second);
  stream.enqueue(new Uint8Array([1, 2, 3]));
  stream.enqueue(new Uint8Array([4, 5, 6]));
  stream.close();
  const [left, right] = await Promise.all([a, b]);
  expect(left.size).toBe(6);
  expect(right).toBe(left);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(first.mock.calls.at(-1)?.[0]).toMatchObject({ received: 6, total: 6 });
  expect(second.mock.calls.at(-1)?.[0]).toMatchObject({ received: 6, total: 6 });
});

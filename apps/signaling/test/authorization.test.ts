import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('signaling account authorization adapter', () => {
  it('fails closed when no account API or explicit development bypass is configured', async () => {
    vi.stubEnv('ACCOUNT_API_URL', '');
    vi.stubEnv('SIGNALING_ALLOW_INSECURE_DEVELOPMENT', 'false');
    const { assertAuthorizationConfigured, authorizeRoom } =
      await import('../src/authorization.js');
    expect(() => assertAuthorizationConfigured()).toThrow('ACCOUNT_API_URL is required');
    await expect(authorizeRoom('join', 'ABCDEFGH2345')).resolves.toEqual({
      allowed: false,
      reason: 'AUTH_UNAVAILABLE',
    });
  });

  it('preserves standalone local development only with an explicit bypass', async () => {
    vi.stubEnv('ACCOUNT_API_URL', '');
    vi.stubEnv('SIGNALING_ALLOW_INSECURE_DEVELOPMENT', 'true');
    const { assertAuthorizationConfigured, authorizeRoom } =
      await import('../src/authorization.js');
    expect(() => assertAuthorizationConfigured()).not.toThrow();
    await expect(authorizeRoom('join', 'ABCDEFGH2345')).resolves.toEqual({
      allowed: true,
      kind: 'development',
    });
  });

  it('sends the opaque token only to the configured server-to-server endpoint', async () => {
    vi.stubEnv('ACCOUNT_API_URL', 'http://127.0.0.1:8790');
    vi.stubEnv('INTERNAL_SIGNALING_SECRET', 'internal-secret-value');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          allowed: true,
          kind: 'registered',
          userId: '286d39ef-61af-4aca-84b8-47f78b0f554a',
          displayName: 'Гера',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { authorizeRoom } = await import('../src/authorization.js');
    const result = await authorizeRoom('create', 'ABCDEFGH2345', 'a'.repeat(43));
    expect(result).toMatchObject({ allowed: true, kind: 'registered', displayName: 'Гера' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8790/v1/internal/room-authorize');
    expect(init.headers['x-freetalk-internal-secret']).toBe('internal-secret-value');
    expect(JSON.parse(init.body)).toEqual({
      action: 'create',
      roomId: 'ABCDEFGH2345',
      token: 'a'.repeat(43),
    });
  });

  it('fails closed when the account API cannot be reached', async () => {
    vi.stubEnv('ACCOUNT_API_URL', 'http://127.0.0.1:8790');
    vi.stubEnv('INTERNAL_SIGNALING_SECRET', 'internal-secret-value');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    const { authorizeRoom } = await import('../src/authorization.js');
    await expect(authorizeRoom('create', 'ABCDEFGH2345', 'a'.repeat(43))).resolves.toEqual({
      allowed: false,
      reason: 'AUTH_UNAVAILABLE',
    });
  });

  it('keeps room authorization independent when the telemetry collector rejects a report', async () => {
    vi.stubEnv('ACCOUNT_API_URL', 'http://127.0.0.1:8790');
    vi.stubEnv('INTERNAL_SIGNALING_SECRET', 'internal-secret-value');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/v1/internal/telemetry')) return new Response(null, { status: 503 });
        return new Response(
          JSON.stringify({
            allowed: true,
            kind: 'registered',
            userId: '286d39ef-61af-4aca-84b8-47f78b0f554a',
            displayName: 'Гера',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    const { authorizeRoom, recordTelemetry } = await import('../src/authorization.js');
    await expect(
      recordTelemetry({
        roomId: 'ABCDEFGH2345',
        reporterClientId: 'a08e6f59-5d0d-45fc-abfa-317f401f84f8',
        report: {
          eventVersion: 1,
          timestamp: Date.now(),
          clientVersion: 'test',
          platform: 'windows',
          sessionId: 'collector-offline-test-session',
          connections: [],
          events: [],
        },
      }),
    ).rejects.toThrow('Telemetry rejected: 503');
    await expect(authorizeRoom('join', 'ABCDEFGH2345', 'a'.repeat(43))).resolves.toMatchObject({
      allowed: true,
      kind: 'registered',
    });
  });
});

import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localTurnConfig } from '../src/local-turn.js';
const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
  vi.restoreAllMocks();
});
describe('independent TURN relay', () => {
  it('issues expiring interoperable HMAC credentials without exporting the shared key', () => {
    const secret = 'test-only-shared-key-which-is-not-a-production-secret';
    const config = localTurnConfig(
      {
        LOCAL_TURN_URLS: 'turn:192.0.2.1:3478?transport=udp,turn:192.0.2.1:3478?transport=tcp',
        LOCAL_TURN_SECRET: secret,
      },
      1_000_000,
    )!;
    const server = config.iceServers[0]!;
    expect(config.expiresAt).toBe(87_400_000);
    expect(server.username?.split(':')[0]).toBe('87400');
    expect(server.credential).toBe(
      createHmac('sha1', secret).update(server.username!).digest('base64'),
    );
    expect(JSON.stringify(config)).not.toContain(secret);
  });
  it('fails closed for partial or malformed configuration', () => {
    expect(localTurnConfig({})).toBeUndefined();
    expect(() => localTurnConfig({ LOCAL_TURN_SECRET: 'short' })).toThrow();
    expect(() =>
      localTurnConfig({
        LOCAL_TURN_SECRET: 'x'.repeat(48),
        LOCAL_TURN_URLS: 'https://example.com',
      }),
    ).toThrow();
  });
  it('does not hold room admission hostage to an unavailable external broker', async () => {
    vi.resetModules();
    process.env.LOCAL_TURN_URLS = 'turn:192.0.2.1:3478?transport=udp';
    process.env.LOCAL_TURN_SECRET = 'x'.repeat(48);
    process.env.TURN_BROKER_URL = 'https://test.invalid';
    process.env.TURN_BROKER_TOKEN = 'test-only';
    delete process.env.TURN_KEY_ID;
    delete process.env.TURN_KEY_API_TOKEN;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unreachable'));
    const { getIceConfig } = await import('../src/turn.js');
    const config = await getIceConfig();
    expect(config.iceServers[0]?.urls).toEqual([process.env.LOCAL_TURN_URLS]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('shares in-flight refreshes and retains a nonexpired independent-provider fallback', async () => {
    vi.resetModules();
    process.env.LOCAL_TURN_URLS = 'turn:192.0.2.1:3478?transport=udp';
    process.env.LOCAL_TURN_SECRET = 'x'.repeat(48);
    process.env.TURN_BROKER_URL = 'https://test.invalid';
    process.env.TURN_BROKER_TOKEN = 'test-only';
    delete process.env.TURN_KEY_ID;
    delete process.env.TURN_KEY_API_TOKEN;
    let resolve!: (response: Response) => void;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { getIceConfig } = await import('../src/turn.js');
    const calls = await Promise.all(Array.from({ length: 10 }, () => getIceConfig()));
    expect(calls.every((c) => c.iceServers.length === 2)).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    resolve(
      Response.json({
        type: 'ice-config',
        iceServers: [{ urls: 'turn:backup.example:3478' }],
        expiresAt: Date.now() + 120_000,
      }),
    );
    await vi.waitFor(async () => {
      expect((await getIceConfig()).iceServers[1]?.urls).toBe('turn:backup.example:3478');
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

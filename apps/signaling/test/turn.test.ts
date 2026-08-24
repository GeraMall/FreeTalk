import { afterEach, describe, expect, it, vi } from 'vitest';
import { getIceConfig } from '../src/turn.js';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
  vi.restoreAllMocks();
});

describe('TURN credential broker', () => {
  it('requests short-lived credentials without exposing provider secrets to the VPS', async () => {
    delete process.env.TURN_KEY_ID;
    delete process.env.TURN_KEY_API_TOKEN;
    process.env.TURN_BROKER_URL = 'https://broker.example/turn-credentials';
    process.env.TURN_BROKER_TOKEN = 'broker-test-token';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        type: 'ice-config',
        iceServers: [
          {
            urls: ['turn:203.0.113.10:3478?transport=udp'],
            username: 'temporary-user',
            credential: 'temporary-password',
          },
        ],
        expiresAt: Date.now() + 60_000,
      }),
    );

    const result = await getIceConfig();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://broker.example/turn-credentials',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer broker-test-token' },
      }),
    );
    expect(result.iceServers[0]?.username).toBe('temporary-user');
  });

  it('rejects malformed broker responses', async () => {
    delete process.env.TURN_KEY_ID;
    delete process.env.TURN_KEY_API_TOKEN;
    process.env.TURN_BROKER_URL = 'https://broker.example/turn-credentials';
    process.env.TURN_BROKER_TOKEN = 'broker-test-token';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ type: 'unexpected' }));

    await expect(getIceConfig()).rejects.toThrow('invalid response');
  });
});

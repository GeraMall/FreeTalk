import { describe, expect, it } from 'vitest';
import { hasTurnServer } from './ice-config';

describe('ICE configuration', () => {
  it('distinguishes STUN-only configuration from a TURN fallback', () => {
    expect(hasTurnServer([{ urls: 'stun:stun.cloudflare.com:3478' }])).toBe(false);
    expect(
      hasTurnServer([
        { urls: 'stun:stun.cloudflare.com:3478' },
        {
          urls: [
            'turn:turn.cloudflare.com:3478?transport=udp',
            'turns:turn.cloudflare.com:443?transport=tcp',
          ],
          username: 'temporary-user',
          credential: 'temporary-password',
        },
      ]),
    ).toBe(true);
  });
});

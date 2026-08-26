import { describe, expect, it } from 'vitest';
import { isNearBottom } from './chat-scroll';

describe('chat scroll helpers', () => {
  it('detects the bottom within the configured threshold', () => {
    expect(isNearBottom({ scrollHeight: 1_000, scrollTop: 780, clientHeight: 120 })).toBe(true);
    expect(isNearBottom({ scrollHeight: 1_000, scrollTop: 400, clientHeight: 120 })).toBe(false);
  });
});

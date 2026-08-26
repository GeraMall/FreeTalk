import { describe, expect, it } from 'vitest';
import {
  GUEST_MAX_JOINS_PER_UTC_DAY,
  GUEST_SESSION_SECONDS,
  DEFAULT_MESSAGE_RETENTION_HOURS,
  guestQuotaAvailable,
  hasHistoryMajority,
  isMessageRetentionHours,
} from '../src/policy.js';

describe('FreeUser and chat policies', () => {
  it('enforces five joins and a thirty minute session', () => {
    expect(GUEST_MAX_JOINS_PER_UTC_DAY).toBe(5);
    expect(GUEST_SESSION_SECONDS).toBe(1800);
    expect(guestQuotaAvailable(4)).toBe(true);
    expect(guestQuotaAvailable(5)).toBe(false);
  });

  it('requires more than half of eligible chat members', () => {
    expect(hasHistoryMajority(4, 8)).toBe(false);
    expect(hasHistoryMajority(5, 8)).toBe(true);
    expect(hasHistoryMajority(1, 1)).toBe(true);
    expect(hasHistoryMajority(0, 0)).toBe(false);
  });

  it('allows only supported chat retention periods', () => {
    expect(DEFAULT_MESSAGE_RETENTION_HOURS).toBe(720);
    expect([24, 168, 720, null].every(isMessageRetentionHours)).toBe(true);
    expect(isMessageRetentionHours(48)).toBe(false);
    expect(isMessageRetentionHours('720')).toBe(false);
  });
});

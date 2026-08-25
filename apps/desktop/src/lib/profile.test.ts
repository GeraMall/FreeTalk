import { describe, expect, it } from 'vitest';
import {
  PROFILE_CHANGE_WINDOW_MS,
  nextProfileChangeHistory,
  remainingProfileChanges,
} from './profile';

describe('profile change limiter', () => {
  it('allows three profile saves in five hours and rejects the fourth', () => {
    const now = 10_000_000;
    const history = [now - 3_000, now - 2_000, now - 1_000];
    expect(remainingProfileChanges(history, now)).toBe(0);
    expect(nextProfileChangeHistory(history, now)).toBeUndefined();
  });

  it('forgets changes outside the five hour window', () => {
    const now = 20_000_000;
    const history = [now - PROFILE_CHANGE_WINDOW_MS - 1, now - 1_000];
    expect(remainingProfileChanges(history, now)).toBe(2);
    expect(nextProfileChangeHistory(history, now)).toEqual([now - 1_000, now]);
  });
});

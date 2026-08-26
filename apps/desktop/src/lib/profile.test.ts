import { describe, expect, it } from 'vitest';
import {
  PROFILE_CHANGE_WINDOW_MS,
  dataUrlToBlob,
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

  it('converts a selected data URL without making a network request', async () => {
    const blob = dataUrlToBlob('data:image/webp;base64,SGVsbG8=');
    expect(blob.type).toBe('image/webp');
    expect(await blob.text()).toBe('Hello');
  });

  it('rejects malformed selected image data', () => {
    expect(() => dataUrlToBlob('https://example.test/avatar.webp')).toThrow(
      'Не удалось прочитать выбранное изображение.',
    );
  });
});

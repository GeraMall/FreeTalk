import { describe, expect, it } from 'vitest';
import {
  PROFILE_CHANGE_WINDOW_MS,
  MAX_PROFILE_IMAGE_INPUT_BYTES,
  dataUrlToBlob,
  nextProfileChangeHistory,
  prepareAvatar,
  prepareChatImage,
  prepareCover,
  remainingProfileChanges,
} from './profile';

describe('profile change limiter', () => {
  it('allows five profile saves in five hours and rejects the sixth', () => {
    const now = 10_000_000;
    const history = [now - 5_000, now - 4_000, now - 3_000, now - 2_000, now - 1_000];
    expect(remainingProfileChanges(history, now)).toBe(0);
    expect(nextProfileChangeHistory(history, now)).toBeUndefined();
  });

  it('forgets changes outside the five hour window', () => {
    const now = 20_000_000;
    const history = [now - PROFILE_CHANGE_WINDOW_MS - 1, now - 1_000];
    expect(remainingProfileChanges(history, now)).toBe(4);
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

  it('rejects avatar, cover and chat source files over 25 MB before decoding', async () => {
    const oversized = {
      type: 'image/webp',
      size: MAX_PROFILE_IMAGE_INPUT_BYTES + 1,
    } as File;
    await expect(prepareAvatar(oversized)).rejects.toThrow('не больше 25 МБ');
    await expect(prepareCover(oversized)).rejects.toThrow('не больше 25 МБ');
    await expect(prepareChatImage(oversized)).rejects.toThrow('не больше 25 МБ');
  });

  it('rejects unsupported source image formats before decoding', async () => {
    const unsupported = { type: 'image/gif', size: 128 } as File;
    await expect(prepareAvatar(unsupported)).rejects.toThrow('JPEG, PNG или WebP');
  });
});

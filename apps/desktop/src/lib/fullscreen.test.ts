// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const windowApi = vi.hoisted(() => ({
  isFullscreen: vi.fn(),
  setFullscreen: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => windowApi,
}));

import { leaveWindowFullscreen, toggleMediaFullscreen } from './fullscreen';

describe('media fullscreen fallback', () => {
  beforeEach(() => {
    windowApi.isFullscreen.mockReset().mockResolvedValue(false);
    windowApi.setFullscreen.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: null,
    });
  });

  it('uses the Tauri window fullscreen API when element fullscreen is unavailable', async () => {
    const element = document.createElement('div');
    Object.defineProperty(element, 'requestFullscreen', {
      configurable: true,
      value: undefined,
    });

    await expect(toggleMediaFullscreen(element)).resolves.toBe('window');
    expect(windowApi.setFullscreen).toHaveBeenCalledWith(true);
  });

  it('leaves a Tauri fullscreen window when the expanded viewer closes', async () => {
    await leaveWindowFullscreen(true);
    expect(windowApi.setFullscreen).toHaveBeenCalledWith(false);
  });
});

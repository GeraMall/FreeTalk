// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, loadSettings, saveSettings } from './settings';

function usePlatform(userAgent: string) {
  vi.stubGlobal('navigator', { userAgent });
}

describe('platform-specific settings defaults', () => {
  beforeEach(() => localStorage.clear());

  afterEach(() => vi.unstubAllGlobals());

  it('keeps screen audio enabled by default on Windows', () => {
    usePlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    expect(defaultSettings()).toMatchObject({
      transmissionMode: 'voice-activation',
      vadThreshold: 0.015,
      noiseSuppression: true,
      autoGainControl: true,
      echoCancellation: true,
      echoDucking: true,
      echoDuckingLevel: 0.4,
      typingAttenuation: true,
      comfortNoise: false,
      screenContentMode: 'balanced',
      screenAudioByDefault: true,
    });
    expect(loadSettings().screenAudioByDefault).toBe(true);
  });

  it('disables screen audio by default for a new macOS installation', () => {
    usePlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_1)');
    expect(defaultSettings().screenAudioByDefault).toBe(false);
    expect(loadSettings().screenAudioByDefault).toBe(false);
  });

  it('disables an old macOS default once but preserves a later explicit choice', () => {
    usePlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_1)');
    localStorage.setItem('freetalk.settings.v1', JSON.stringify({ screenAudioByDefault: true }));

    const migrated = loadSettings();
    expect(migrated.screenAudioByDefault).toBe(false);

    saveSettings({ ...migrated, screenAudioByDefault: true });
    expect(loadSettings().screenAudioByDefault).toBe(true);
  });
});

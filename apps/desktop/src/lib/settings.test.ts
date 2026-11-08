// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, loadSettings, saveSettings } from './settings';

function usePlatform(userAgent: string) {
  vi.stubGlobal('navigator', { userAgent });
}

describe('platform-specific settings defaults', () => {
  beforeEach(() => localStorage.clear());

  afterEach(() => vi.unstubAllGlobals());

  it('rebases the old 85% size to 100% and preserves a newly selected 85%', () => {
    localStorage.setItem('freetalk.settings.v1', JSON.stringify({ chatTextScale: 0.85 }));
    expect(loadSettings().chatTextScale).toBe(1);

    saveSettings({ ...loadSettings(), chatTextScale: 0.85 });
    expect(loadSettings().chatTextScale).toBe(0.85);
  });

  it('treats the previous 110% as the new 100% without rescaling saved values twice', () => {
    localStorage.setItem(
      'freetalk.settings.v1',
      JSON.stringify({ chatTextScale: 1.1, chatTextScaleBasis: 2 }),
    );
    expect(loadSettings().chatTextScale).toBe(1);
    saveSettings({ ...loadSettings(), chatTextScale: 1.1 });
    expect(loadSettings().chatTextScale).toBe(1.1);
  });

  it('enables automatic updates for a new profile and preserves an explicit opt-out', () => {
    expect(defaultSettings().autoUpdate).toBe(true);
    expect(loadSettings().autoUpdate).toBe(true);
    saveSettings({ ...loadSettings(), autoUpdate: false });
    expect(loadSettings().autoUpdate).toBe(false);
    localStorage.setItem('freetalk.settings.v1', JSON.stringify({ autoUpdate: 'invalid' }));
    expect(loadSettings().autoUpdate).toBe(true);
  });

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
      chatWallpaperFit: 'cover',
      participantCardStyle: 'avatar-glass',
      mirrorSelfVideo: true,
    });
    expect(loadSettings().screenAudioByDefault).toBe(true);
  });

  it('keeps self-view mirroring enabled by default and preserves an explicit opt-out', () => {
    expect(loadSettings().mirrorSelfVideo).toBe(true);

    localStorage.setItem('freetalk.settings.v1', JSON.stringify({ mirrorSelfVideo: false }));
    expect(loadSettings().mirrorSelfVideo).toBe(false);
  });

  it('loads a supported wallpaper fit and normalizes an invalid value', () => {
    localStorage.setItem('freetalk.settings.v1', JSON.stringify({ chatWallpaperFit: 'contain' }));
    expect(loadSettings().chatWallpaperFit).toBe('contain');

    localStorage.setItem('freetalk.settings.v1', JSON.stringify({ chatWallpaperFit: 'stretch' }));
    expect(loadSettings().chatWallpaperFit).toBe('cover');
  });

  it('enables avatar glass by default and preserves an explicit classic choice', () => {
    localStorage.setItem(
      'freetalk.settings.v1',
      JSON.stringify({ participantCardStyle: 'avatar-glass' }),
    );
    expect(loadSettings().participantCardStyle).toBe('avatar-glass');

    localStorage.setItem(
      'freetalk.settings.v1',
      JSON.stringify({ participantCardStyle: 'classic' }),
    );
    expect(loadSettings().participantCardStyle).toBe('classic');

    localStorage.setItem(
      'freetalk.settings.v1',
      JSON.stringify({ participantCardStyle: 'unknown' }),
    );
    expect(loadSettings().participantCardStyle).toBe('avatar-glass');
  });

  it('retires previously saved participant decorations', () => {
    localStorage.setItem(
      'freetalk.settings.v1',
      JSON.stringify({ participantCardDecoration: 'japan' }),
    );
    expect(loadSettings().participantCardDecoration).toBe('none');
  });

  it('disables screen audio by default for a new macOS installation', () => {
    usePlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_1)');
    expect(defaultSettings().screenAudioByDefault).toBe(false);
    expect(loadSettings().screenAudioByDefault).toBe(false);
  });

  it('starts the Mac desktop with its detail-first Full HD 30 FPS profile', () => {
    usePlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_1)');
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    for (const settings of [defaultSettings(), loadSettings()]) {
      expect(settings).toMatchObject({
        screenContentMode: 'text',
        screenResolution: '1080p',
        screenFrameRate: 30,
        screenAdaptiveQuality: true,
        screenAudioByDefault: false,
      });
    }
  });

  it('preserves an explicit Mac screen profile across launches', () => {
    usePlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_1)');
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    saveSettings({
      ...defaultSettings(),
      screenContentMode: 'video',
      screenResolution: '1440p',
      screenFrameRate: 60,
      screenAdaptiveQuality: false,
    });
    expect(loadSettings()).toMatchObject({
      screenContentMode: 'video',
      screenResolution: '1440p',
      screenFrameRate: 60,
      screenAdaptiveQuality: false,
    });
  });

  it('keeps the universal default on the Windows desktop', () => {
    usePlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    expect(loadSettings()).toMatchObject({
      screenContentMode: 'balanced',
      screenResolution: '1080p',
      screenFrameRate: 30,
      screenAudioByDefault: true,
    });
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

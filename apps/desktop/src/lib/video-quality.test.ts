import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIDEO_PREFERENCES,
  nextAdaptiveQualityLevel,
  normalizeVideoPreferences,
  screenEncodingProfile,
} from './video-quality';

describe('video quality preferences', () => {
  it('defaults to 1080p 30 FPS and validates persisted values', () => {
    expect(normalizeVideoPreferences({})).toEqual(DEFAULT_VIDEO_PREFERENCES);
    expect(
      normalizeVideoPreferences({
        screenResolution: 'invalid' as never,
        screenFrameRate: 120 as never,
      }),
    ).toEqual(DEFAULT_VIDEO_PREFERENCES);
  });

  it('supports 2K 60 FPS and progressively reduces bitrate, FPS and resolution', () => {
    const preferences = {
      ...DEFAULT_VIDEO_PREFERENCES,
      screenResolution: '1440p' as const,
      screenFrameRate: 60 as const,
    };
    expect(screenEncodingProfile(preferences, 0)).toEqual({
      maxBitrate: 14_000_000,
      maxFramerate: 60,
      scaleResolutionDownBy: 1,
    });
    expect(screenEncodingProfile(preferences, 3)).toEqual({
      maxBitrate: 2_800_000,
      maxFramerate: 15,
      scaleResolutionDownBy: 3,
    });
  });

  it('drops quality on loss or congestion and only restores it after stable samples', () => {
    const degraded = nextAdaptiveQualityLevel(
      0,
      0,
      { fractionLost: 0.08, roundTripTime: 0.4 },
      6_000_000,
    );
    expect(degraded).toEqual({ level: 1, goodSamples: 0 });

    let state = degraded;
    for (let index = 0; index < 5; index += 1) {
      state = nextAdaptiveQualityLevel(
        state.level,
        state.goodSamples,
        { availableOutgoingBitrate: 10_000_000, fractionLost: 0, roundTripTime: 0.05 },
        3_720_000,
        6_000_000,
      );
    }
    expect(state).toEqual({ level: 0, goodSamples: 0 });
  });
});

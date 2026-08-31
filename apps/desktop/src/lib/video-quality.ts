export type ScreenResolution = '720p' | '1080p' | '1440p';
export type ScreenFrameRate = 15 | 30 | 60;
export type ScreenContentMode = 'text' | 'balanced' | 'video';

export interface VideoPreferences {
  cameraDeviceId: string;
  screenResolution: ScreenResolution;
  screenFrameRate: ScreenFrameRate;
  screenContentMode: ScreenContentMode;
  screenAudioByDefault: boolean;
  screenAdaptiveQuality: boolean;
}

export interface ScreenEncodingProfile {
  maxBitrate: number;
  maxFramerate: number;
  scaleResolutionDownBy: number;
}

export interface NetworkQualitySample {
  availableOutgoingBitrate?: number;
  fractionLost?: number;
  roundTripTime?: number;
  qualityLimitationReason?: string;
}

export const DEFAULT_VIDEO_PREFERENCES: VideoPreferences = {
  cameraDeviceId: '',
  screenResolution: '1080p',
  screenFrameRate: 30,
  screenContentMode: 'balanced',
  screenAudioByDefault: true,
  screenAdaptiveQuality: true,
};

const RESOLUTIONS: Record<ScreenResolution, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
};

const BASE_BITRATES: Record<ScreenResolution, Record<ScreenFrameRate, number>> = {
  '720p': { 15: 1_800_000, 30: 3_000_000, 60: 5_000_000 },
  '1080p': { 15: 3_000_000, 30: 6_000_000, 60: 9_000_000 },
  '1440p': { 15: 5_000_000, 30: 9_000_000, 60: 14_000_000 },
};

const BITRATE_BY_LEVEL = [1, 0.62, 0.36, 0.2] as const;
const TEXT_SCALE_BY_LEVEL = [1, 1, 1, 1.5] as const;
const TEXT_FPS_BY_LEVEL = [1, 0.8, 0.5, 0.4] as const;
const BALANCED_SCALE_BY_LEVEL = [1, 1.25, 1.5, 2] as const;
const BALANCED_FPS_BY_LEVEL = [1, 0.9, 0.75, 0.6] as const;
const VIDEO_SCALE_BY_LEVEL = [1, 1.5, 2, 3] as const;
const VIDEO_FPS_BY_LEVEL = [1, 1, 0.75, 0.5] as const;

export function screenCaptureConstraints(preferences: VideoPreferences): MediaTrackConstraints {
  const resolution = RESOLUTIONS[preferences.screenResolution];
  return {
    displaySurface: 'window',
    width: { ideal: resolution.width, max: resolution.width },
    height: { ideal: resolution.height, max: resolution.height },
    frameRate: { ideal: preferences.screenFrameRate, max: preferences.screenFrameRate },
  };
}

export function screenEncodingProfile(
  preferences: VideoPreferences,
  adaptiveLevel = 0,
): ScreenEncodingProfile {
  const level = Math.max(0, Math.min(3, Math.round(adaptiveLevel)));
  const baseBitrate = BASE_BITRATES[preferences.screenResolution][preferences.screenFrameRate];
  const scaleByLevel =
    preferences.screenContentMode === 'text'
      ? TEXT_SCALE_BY_LEVEL
      : preferences.screenContentMode === 'balanced'
        ? BALANCED_SCALE_BY_LEVEL
        : VIDEO_SCALE_BY_LEVEL;
  const fpsByLevel =
    preferences.screenContentMode === 'text'
      ? TEXT_FPS_BY_LEVEL
      : preferences.screenContentMode === 'balanced'
        ? BALANCED_FPS_BY_LEVEL
        : VIDEO_FPS_BY_LEVEL;
  return {
    maxBitrate: Math.round(baseBitrate * BITRATE_BY_LEVEL[level]),
    maxFramerate: Math.max(12, Math.round(preferences.screenFrameRate * fpsByLevel[level])),
    scaleResolutionDownBy: scaleByLevel[level],
  };
}

export function nextAdaptiveQualityLevel(
  currentLevel: number,
  consecutiveGoodSamples: number,
  sample: NetworkQualitySample,
  targetBitrate: number,
  upgradeTargetBitrate = targetBitrate,
) {
  const available = sample.availableOutgoingBitrate ?? Number.POSITIVE_INFINITY;
  const loss = sample.fractionLost ?? 0;
  const rtt = sample.roundTripTime ?? 0;
  const bandwidthLimited = sample.qualityLimitationReason === 'bandwidth';
  const bad = bandwidthLimited || available < targetBitrate * 1.15 || loss > 0.05 || rtt > 0.35;
  if (bad) return { level: Math.min(3, currentLevel + 1), goodSamples: 0 };

  const hasEvidence =
    sample.availableOutgoingBitrate !== undefined ||
    sample.fractionLost !== undefined ||
    sample.roundTripTime !== undefined ||
    sample.qualityLimitationReason !== undefined;
  const good = hasEvidence && available > upgradeTargetBitrate * 1.25 && loss < 0.02 && rtt < 0.2;
  const goodSamples = good ? consecutiveGoodSamples + 1 : 0;
  if (goodSamples >= 3 && currentLevel > 0) return { level: currentLevel - 1, goodSamples: 0 };
  return { level: currentLevel, goodSamples };
}

export function normalizeVideoPreferences(value: Partial<VideoPreferences>): VideoPreferences {
  return {
    cameraDeviceId: typeof value.cameraDeviceId === 'string' ? value.cameraDeviceId : '',
    screenResolution:
      value.screenResolution === '720p' ||
      value.screenResolution === '1080p' ||
      value.screenResolution === '1440p'
        ? value.screenResolution
        : DEFAULT_VIDEO_PREFERENCES.screenResolution,
    screenFrameRate:
      value.screenFrameRate === 15 || value.screenFrameRate === 30 || value.screenFrameRate === 60
        ? value.screenFrameRate
        : DEFAULT_VIDEO_PREFERENCES.screenFrameRate,
    screenContentMode:
      value.screenContentMode === 'text' ||
      value.screenContentMode === 'balanced' ||
      value.screenContentMode === 'video'
        ? value.screenContentMode
        : DEFAULT_VIDEO_PREFERENCES.screenContentMode,
    screenAudioByDefault:
      typeof value.screenAudioByDefault === 'boolean'
        ? value.screenAudioByDefault
        : DEFAULT_VIDEO_PREFERENCES.screenAudioByDefault,
    screenAdaptiveQuality:
      typeof value.screenAdaptiveQuality === 'boolean'
        ? value.screenAdaptiveQuality
        : DEFAULT_VIDEO_PREFERENCES.screenAdaptiveQuality,
  };
}

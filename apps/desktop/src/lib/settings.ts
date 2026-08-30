import {
  DEFAULT_VIDEO_PREFERENCES,
  normalizeVideoPreferences,
  type VideoPreferences,
} from './video-quality';

export interface LocalSettings extends VideoPreferences {
  displayName: string;
  avatarDataUrl: string;
  profileChangeTimestamps: number[];
  inputDeviceId: string;
  outputDeviceId: string;
  transmissionMode: 'voice-activation' | 'push-to-talk' | 'continuous';
  pushToTalkKey: string;
  vadThreshold: number;
  outputVolume: number;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  echoCancellation: boolean;
  echoDucking: boolean;
  echoDuckingLevel: number;
  typingAttenuation: boolean;
  comfortNoise: boolean;
  peerVolumes: Record<string, number>;
  screenVolumes: Record<string, number>;
  mutedPeers: Record<string, boolean>;
  chatWallpaperDataUrl: string;
  chatTextScale: number;
  chatMessageStyle: 'bubbles' | 'compact';
  recordingDirectory: string;
  recordingAskDirectory: boolean;
  recordingShowParticipantNames: boolean;
  recordingAddTimestamp: boolean;
  recordingIncludeSharedVideo: boolean;
}

const KEY = 'freetalk.settings.v1';
const defaults: LocalSettings = {
  displayName: '',
  avatarDataUrl: '',
  profileChangeTimestamps: [],
  ...DEFAULT_VIDEO_PREFERENCES,
  inputDeviceId: '',
  outputDeviceId: '',
  transmissionMode: 'voice-activation',
  pushToTalkKey: 'Space',
  vadThreshold: 0.045,
  outputVolume: 0.85,
  noiseSuppression: true,
  autoGainControl: true,
  echoCancellation: true,
  echoDucking: true,
  echoDuckingLevel: 0.35,
  typingAttenuation: false,
  comfortNoise: false,
  peerVolumes: {},
  screenVolumes: {},
  mutedPeers: {},
  chatWallpaperDataUrl: '',
  chatTextScale: 1,
  chatMessageStyle: 'bubbles',
  recordingDirectory: '',
  recordingAskDirectory: false,
  recordingShowParticipantNames: true,
  recordingAddTimestamp: false,
  recordingIncludeSharedVideo: true,
};

export function defaultSettings(): LocalSettings {
  return { ...defaults, peerVolumes: {}, screenVolumes: {}, mutedPeers: {} };
}

export function loadSettings(): LocalSettings {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<LocalSettings>;
    const legacy = value as Partial<LocalSettings> & { pushToTalk?: boolean };
    const video = normalizeVideoPreferences(value);
    return {
      ...defaults,
      ...value,
      ...video,
      transmissionMode:
        value.transmissionMode ?? (legacy.pushToTalk ? 'push-to-talk' : 'voice-activation'),
      peerVolumes: value.peerVolumes ?? {},
      screenVolumes: value.screenVolumes ?? {},
      mutedPeers: value.mutedPeers ?? {},
      profileChangeTimestamps: Array.isArray(value.profileChangeTimestamps)
        ? value.profileChangeTimestamps.filter((time) => Number.isFinite(time))
        : [],
      chatTextScale:
        typeof value.chatTextScale === 'number'
          ? Math.min(1.3, Math.max(0.85, value.chatTextScale))
          : defaults.chatTextScale,
      chatMessageStyle: value.chatMessageStyle === 'compact' ? 'compact' : 'bubbles',
      recordingDirectory:
        typeof value.recordingDirectory === 'string' ? value.recordingDirectory : '',
      recordingAskDirectory:
        typeof value.recordingAskDirectory === 'boolean' ? value.recordingAskDirectory : false,
      recordingShowParticipantNames:
        typeof value.recordingShowParticipantNames === 'boolean'
          ? value.recordingShowParticipantNames
          : true,
      recordingAddTimestamp:
        typeof value.recordingAddTimestamp === 'boolean' ? value.recordingAddTimestamp : false,
      recordingIncludeSharedVideo:
        typeof value.recordingIncludeSharedVideo === 'boolean'
          ? value.recordingIncludeSharedVideo
          : true,
    };
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(settings: LocalSettings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
}

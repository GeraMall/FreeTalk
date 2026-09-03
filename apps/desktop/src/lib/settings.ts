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
  cameraBackgroundMode: 'none' | 'blur' | 'custom';
  cameraBackgroundDataUrl: string;
  cameraPreviewAlways: boolean;
  participantJoinedSound: boolean;
  participantDisconnectedSound: boolean;
  recordingStartSound: boolean;
}

const KEY = 'freetalk.settings.v1';
const MAC_SCREEN_AUDIO_DEFAULT_OFF_MIGRATION = 'freetalk.migration.mac-screen-audio-default-off.v1';
const defaults: LocalSettings = {
  displayName: '',
  avatarDataUrl: '',
  profileChangeTimestamps: [],
  ...DEFAULT_VIDEO_PREFERENCES,
  inputDeviceId: '',
  outputDeviceId: '',
  transmissionMode: 'voice-activation',
  pushToTalkKey: 'Space',
  vadThreshold: 0.015,
  outputVolume: 0.85,
  noiseSuppression: true,
  autoGainControl: true,
  echoCancellation: true,
  echoDucking: true,
  echoDuckingLevel: 0.4,
  typingAttenuation: true,
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
  cameraBackgroundMode: 'none',
  cameraBackgroundDataUrl: '',
  cameraPreviewAlways: true,
  participantJoinedSound: true,
  participantDisconnectedSound: true,
  recordingStartSound: true,
};

function isMacOS() {
  return typeof navigator !== 'undefined' && /Macintosh|Mac OS X/i.test(navigator.userAgent);
}

export function defaultSettings(): LocalSettings {
  return {
    ...defaults,
    screenAudioByDefault: isMacOS() ? false : defaults.screenAudioByDefault,
    peerVolumes: {},
    screenVolumes: {},
    mutedPeers: {},
  };
}

export function loadSettings(): LocalSettings {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<LocalSettings>;
    const legacy = value as Partial<LocalSettings> & { pushToTalk?: boolean };
    const video = normalizeVideoPreferences(value);
    const macOS = isMacOS();
    const migrateMacScreenAudio =
      macOS && localStorage.getItem(MAC_SCREEN_AUDIO_DEFAULT_OFF_MIGRATION) !== 'done';
    const settings: LocalSettings = {
      ...defaults,
      ...value,
      ...video,
      screenAudioByDefault:
        macOS && (migrateMacScreenAudio || typeof value.screenAudioByDefault !== 'boolean')
          ? false
          : video.screenAudioByDefault,
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
      cameraBackgroundMode:
        value.cameraBackgroundMode === 'blur' || value.cameraBackgroundMode === 'custom'
          ? value.cameraBackgroundMode
          : 'none',
      cameraBackgroundDataUrl:
        typeof value.cameraBackgroundDataUrl === 'string' ? value.cameraBackgroundDataUrl : '',
      cameraPreviewAlways:
        typeof value.cameraPreviewAlways === 'boolean' ? value.cameraPreviewAlways : true,
      participantJoinedSound:
        typeof value.participantJoinedSound === 'boolean' ? value.participantJoinedSound : true,
      participantDisconnectedSound:
        typeof value.participantDisconnectedSound === 'boolean'
          ? value.participantDisconnectedSound
          : true,
      recordingStartSound:
        typeof value.recordingStartSound === 'boolean' ? value.recordingStartSound : true,
    };
    if (migrateMacScreenAudio) {
      localStorage.setItem(KEY, JSON.stringify(settings));
      localStorage.setItem(MAC_SCREEN_AUDIO_DEFAULT_OFF_MIGRATION, 'done');
    }
    return settings;
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings: LocalSettings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
}

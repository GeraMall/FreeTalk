export interface LocalSettings {
  displayName: string;
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
  mutedPeers: Record<string, boolean>;
}

const KEY = 'freetalk.settings.v1';
const defaults: LocalSettings = {
  displayName: '',
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
  mutedPeers: {},
};

export function defaultSettings(): LocalSettings {
  return { ...defaults, peerVolumes: {}, mutedPeers: {} };
}

export function loadSettings(): LocalSettings {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<LocalSettings>;
    const legacy = value as Partial<LocalSettings> & { pushToTalk?: boolean };
    return {
      ...defaults,
      ...value,
      transmissionMode:
        value.transmissionMode ?? (legacy.pushToTalk ? 'push-to-talk' : 'voice-activation'),
      peerVolumes: value.peerVolumes ?? {},
      mutedPeers: value.mutedPeers ?? {},
    };
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(settings: LocalSettings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
}

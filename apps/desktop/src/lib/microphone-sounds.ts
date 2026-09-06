import type { LocalSettings } from './settings';

export const MICROPHONE_SOUND_URLS = {
  enabled: '/sounds/microphone-enabled.mp3',
  disabled: '/sounds/microphone-disabled.mp3',
} as const;

const MICROPHONE_SOUND_GAIN = 0.8;

export function microphoneSoundUrl(muted: boolean) {
  return muted ? MICROPHONE_SOUND_URLS.disabled : MICROPHONE_SOUND_URLS.enabled;
}

export function microphoneSoundVolume(outputVolume: number) {
  return Math.min(1, Math.max(0, outputVolume)) * MICROPHONE_SOUND_GAIN;
}

export async function playMicrophoneToggleSound(muted: boolean, settings: LocalSettings) {
  const audio = new Audio(microphoneSoundUrl(muted));
  audio.preload = 'auto';
  audio.volume = microphoneSoundVolume(settings.outputVolume);
  if (settings.outputDeviceId && 'setSinkId' in audio)
    await (audio as HTMLAudioElement & { setSinkId(id: string): Promise<void> })
      .setSinkId(settings.outputDeviceId)
      .catch(() => undefined);
  try {
    await audio.play();
  } catch {
    // Browsers may reject playback until the user has interacted with the app.
  }
}

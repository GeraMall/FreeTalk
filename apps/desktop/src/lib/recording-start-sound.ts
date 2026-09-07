import recordingStartSound from '../assets/recording-start.mp3';
import type { LocalSettings } from './settings';

export async function playRecordingStartNotification(settings: LocalSettings) {
  const sound = new Audio(recordingStartSound);
  sound.volume = settings.outputVolume;
  if (settings.outputDeviceId && 'setSinkId' in sound)
    await (sound as HTMLAudioElement & { setSinkId(deviceId: string): Promise<void> })
      .setSinkId(settings.outputDeviceId)
      .catch(() => undefined);
  await sound.play().catch(() => undefined);
}

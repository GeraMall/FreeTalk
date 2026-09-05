import type { LocalSettings } from './settings';

export const INCOMING_CALL_RINGTONE_URL = '/sounds/incoming-call.mp3';

type RingtoneSettings = Pick<LocalSettings, 'outputDeviceId' | 'outputVolume'>;

export class IncomingCallRingtone {
  private audio?: HTMLAudioElement;

  constructor(
    private readonly createAudio: () => HTMLAudioElement = () =>
      new Audio(INCOMING_CALL_RINGTONE_URL),
  ) {}

  async start(settings: RingtoneSettings) {
    this.stop();
    const audio = this.createAudio();
    audio.preload = 'auto';
    audio.loop = true;
    audio.volume = Math.min(1, Math.max(0, settings.outputVolume));
    this.audio = audio;
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

  stop() {
    if (!this.audio) return;
    this.audio.pause();
    this.audio.currentTime = 0;
    this.audio = undefined;
  }
}

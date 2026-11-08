import { loadSettings } from './settings';
export type MonopolySound = 'shake' | 'roll' | 'step' | 'buy' | 'card' | 'win';
export class MonopolySounds {
  enabled = true;
  private active = new Map<HTMLAudioElement, MonopolySound>();
  private lastShake = 0;
  private timers = new Map<HTMLAudioElement, ReturnType<typeof setTimeout>>();
  async play(sound: MonopolySound, timing?: { offsetMs: number; remainingMs: number }) {
    if (!this.enabled || this.active.size >= 6) return;
    if (sound === 'shake') {
      if (Date.now() - this.lastShake < 110) return;
      this.lastShake = Date.now();
    }
    const settings = loadSettings();
    if (settings.outputVolume <= 0) return;
    const audio = new Audio(`/sounds/monopoly/${sound}.wav`);
    this.active.set(audio, sound);
    audio.volume = Math.min(1, settings.outputVolume) * 0.6;
    audio.preload = 'auto';
    const release = () => {
      this.active.delete(audio);
      clearTimeout(this.timers.get(audio));
      this.timers.delete(audio);
    };
    if (timing) {
      if (timing.remainingMs <= 0) {
        release();
        return;
      }
      try {
        audio.currentTime = timing.offsetMs / 1000;
      } catch {
        /* A late sound is still limited by the shared deadline. */
      }
      this.timers.set(
        audio,
        setTimeout(() => {
          audio.pause();
          audio.src = '';
          release();
        }, timing.remainingMs),
      );
    }
    audio.onended = release;
    audio.onerror = release;
    if (settings.outputDeviceId && 'setSinkId' in audio)
      await (audio as HTMLAudioElement & { setSinkId(id: string): Promise<void> })
        .setSinkId(settings.outputDeviceId)
        .catch(() => {});
    if (!this.enabled || !this.active.has(audio)) {
      release();
      return;
    }
    await audio.play().catch(release);
  }
  stopDice() {
    for (const [audio, sound] of this.active)
      if (sound === 'shake' || sound === 'roll') {
        audio.pause();
        audio.src = '';
        this.active.delete(audio);
        clearTimeout(this.timers.get(audio));
        this.timers.delete(audio);
      }
  }
  stop() {
    for (const [a] of this.active) {
      a.pause();
      a.src = '';
    }
    this.active.clear();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}

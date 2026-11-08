import { loadSettings } from './settings';
export type MonopolySound = 'shake' | 'roll' | 'step' | 'buy' | 'card' | 'win';
export class MonopolySounds {
  enabled = true;
  private active = new Set<HTMLAudioElement>();
  private lastShake = 0;
  async play(sound: MonopolySound) {
    if (!this.enabled || this.active.size >= 6) return;
    if (sound === 'shake') {
      if (Date.now() - this.lastShake < 110) return;
      this.lastShake = Date.now();
    }
    const settings = loadSettings();
    if (settings.outputVolume <= 0) return;
    const audio = new Audio(`/sounds/monopoly/${sound}.wav`);
    this.active.add(audio);
    audio.volume = Math.min(1, settings.outputVolume) * 0.6;
    audio.preload = 'auto';
    const release = () => this.active.delete(audio);
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
  stop() {
    for (const a of this.active) {
      a.pause();
      a.src = '';
    }
    this.active.clear();
  }
}

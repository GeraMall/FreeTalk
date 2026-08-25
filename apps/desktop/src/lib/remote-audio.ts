import { monitorRemoteSpeaking } from './audio-manager';
import { connectionDiagnostics } from './connection-diagnostics';

export class RemoteAudio {
  private readonly elements = new Map<string, HTMLAudioElement>();
  private readonly monitors = new Map<string, () => void>();
  private readonly peerVolumes = new Map<string, number>();
  private readonly recoveryTimers = new Map<string, number>();
  private masterVolume = 0.85;
  private ducking = 1;

  constructor(private readonly onSpeaking?: (peerId: string, speaking: boolean) => void) {}

  async attach(
    peerId: string,
    stream: MediaStream,
    volume: number,
    muted: boolean,
    outputDeviceId: string,
  ) {
    let audio = this.elements.get(peerId);
    if (!audio) {
      audio = new Audio();
      audio.autoplay = true;
      audio.addEventListener('pause', () => this.scheduleRecovery(peerId, audio!));
      audio.addEventListener('stalled', () => this.scheduleRecovery(peerId, audio!));
      this.elements.set(peerId, audio);
    }
    audio.srcObject = stream;
    this.peerVolumes.set(peerId, volume);
    this.applyVolume(peerId, audio);
    audio.muted = muted;
    await this.setSink(audio, outputDeviceId);
    await audio.play().catch(() => this.scheduleRecovery(peerId, audio!));
    if (this.onSpeaking) {
      this.monitors.get(peerId)?.();
      this.monitors.set(
        peerId,
        monitorRemoteSpeaking(stream, (speaking) => this.onSpeaking?.(peerId, speaking)),
      );
    }
  }

  setVolume(peerId: string, volume: number) {
    this.peerVolumes.set(peerId, volume);
    const audio = this.elements.get(peerId);
    if (audio) this.applyVolume(peerId, audio);
  }
  setMasterVolume(volume: number) {
    this.masterVolume = volume;
    this.refreshVolumes();
  }
  setDucking(active: boolean, level: number) {
    this.ducking = active ? level : 1;
    this.refreshVolumes();
  }
  setMuted(peerId: string, muted: boolean) {
    const audio = this.elements.get(peerId);
    if (audio) audio.muted = muted;
  }
  async setOutput(deviceId: string) {
    await Promise.all([...this.elements.values()].map((audio) => this.setSink(audio, deviceId)));
  }
  supportsOutputSelection() {
    return 'setSinkId' in HTMLMediaElement.prototype;
  }

  remove(peerId: string) {
    const recoveryTimer = this.recoveryTimers.get(peerId);
    if (recoveryTimer) window.clearTimeout(recoveryTimer);
    this.recoveryTimers.delete(peerId);
    this.monitors.get(peerId)?.();
    this.monitors.delete(peerId);
    const audio = this.elements.get(peerId);
    if (audio) {
      audio.srcObject = null;
      audio.pause();
    }
    this.elements.delete(peerId);
    this.peerVolumes.delete(peerId);
  }
  closeAll() {
    for (const peerId of [...this.elements.keys()]) this.remove(peerId);
  }

  private async setSink(audio: HTMLAudioElement, deviceId: string) {
    if (deviceId && 'setSinkId' in audio)
      await (audio as HTMLAudioElement & { setSinkId(id: string): Promise<void> })
        .setSinkId(deviceId)
        .catch(() => undefined);
  }

  private refreshVolumes() {
    for (const [peerId, audio] of this.elements) this.applyVolume(peerId, audio);
  }

  private applyVolume(peerId: string, audio: HTMLAudioElement) {
    audio.volume = Math.min(
      1,
      (this.peerVolumes.get(peerId) ?? 1) * this.masterVolume * this.ducking,
    );
  }

  private scheduleRecovery(peerId: string, audio: HTMLAudioElement) {
    if (!audio.srcObject || this.recoveryTimers.has(peerId)) return;
    this.recoveryTimers.set(
      peerId,
      window.setTimeout(() => {
        this.recoveryTimers.delete(peerId);
        if (!audio.srcObject || !audio.paused) return;
        connectionDiagnostics.record('remote-audio-playback:resume', peerId);
        void audio.play().catch(() => this.scheduleRecovery(peerId, audio));
      }, 500),
    );
  }
}

export type NotificationSound = 'joined' | 'disconnected';

const SOUND_URLS: Record<NotificationSound, string> = {
  joined: '/sounds/participant-joined.mp3',
  disconnected: '/sounds/participant-disconnected.mp3',
};

const NOTIFICATION_VOLUME = 0.72;
const ACTIVE_SAMPLE_FLOOR = 0.001;

export function activeRms(channels: readonly Float32Array[]) {
  let sum = 0;
  let count = 0;
  for (const channel of channels) {
    for (const sample of channel) {
      if (Math.abs(sample) < ACTIVE_SAMPLE_FLOOR) continue;
      sum += sample * sample;
      count += 1;
    }
  }
  return count === 0 ? 0 : Math.sqrt(sum / count);
}

export function equalizationGains(levels: Record<NotificationSound, number>) {
  const validLevels = Object.values(levels).filter((level) => Number.isFinite(level) && level > 0);
  if (validLevels.length !== 2) return { joined: 1, disconnected: 1 };
  const target = Math.min(...validLevels);
  return {
    joined: Math.min(1, target / levels.joined),
    disconnected: Math.min(1, target / levels.disconnected),
  };
}

export class ParticipantNotificationTracker {
  private readonly participantIds = new Set<string>();

  reset(participantIds: Iterable<string>) {
    this.participantIds.clear();
    for (const participantId of participantIds) this.participantIds.add(participantId);
  }

  joined(participantId: string, selfId: string) {
    if (participantId === selfId || this.participantIds.has(participantId)) return false;
    this.participantIds.add(participantId);
    return true;
  }

  disconnected(participantId: string, selfId: string) {
    if (participantId === selfId) return false;
    return this.participantIds.delete(participantId);
  }

  clear() {
    this.participantIds.clear();
  }
}

export class NotificationSounds {
  private elements?: Record<NotificationSound, HTMLAudioElement>;
  private gains: Record<NotificationSound, number> = { joined: 1, disconnected: 1 };
  private outputDeviceId = '';
  private preparation?: Promise<void>;

  prepare(outputDeviceId = this.outputDeviceId) {
    this.outputDeviceId = outputDeviceId;
    this.preparation ??= this.measureLevels();
    for (const element of Object.values(this.getElements())) {
      element.load();
      void this.setSink(element, outputDeviceId);
    }
    return this.preparation;
  }

  setOutput(outputDeviceId: string) {
    this.outputDeviceId = outputDeviceId;
    return Promise.all(
      Object.values(this.getElements()).map((element) => this.setSink(element, outputDeviceId)),
    );
  }

  playJoined() {
    return this.play('joined');
  }

  playDisconnected() {
    return this.play('disconnected');
  }

  stop() {
    if (!this.elements) return;
    for (const element of Object.values(this.elements)) {
      element.pause();
      element.currentTime = 0;
    }
  }

  private createElement(url: string) {
    const element = new Audio(url);
    element.preload = 'auto';
    return element;
  }

  private getElements() {
    this.elements ??= {
      joined: this.createElement(SOUND_URLS.joined),
      disconnected: this.createElement(SOUND_URLS.disconnected),
    };
    return this.elements;
  }

  private async play(sound: NotificationSound) {
    await this.prepare();
    this.stop();
    const element = this.getElements()[sound];
    element.volume = NOTIFICATION_VOLUME * this.gains[sound];
    await this.setSink(element, this.outputDeviceId);
    await element.play().catch(() => undefined);
  }

  private async measureLevels() {
    const AudioContextClass =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    try {
      const decoded = await Promise.all(
        (Object.keys(SOUND_URLS) as NotificationSound[]).map(async (sound) => {
          const response = await fetch(SOUND_URLS[sound]);
          if (!response.ok) throw new Error(`Sound asset unavailable: ${sound}`);
          const buffer = await context.decodeAudioData(await response.arrayBuffer());
          const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
            buffer.getChannelData(index),
          );
          return [sound, activeRms(channels)] as const;
        }),
      );
      this.gains = equalizationGains(
        Object.fromEntries(decoded) as Record<NotificationSound, number>,
      );
    } catch {
      this.gains = { joined: 1, disconnected: 1 };
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  private async setSink(element: HTMLAudioElement, outputDeviceId: string) {
    if (outputDeviceId && 'setSinkId' in element) {
      await (element as HTMLAudioElement & { setSinkId(id: string): Promise<void> })
        .setSinkId(outputDeviceId)
        .catch(() => undefined);
    }
  }
}

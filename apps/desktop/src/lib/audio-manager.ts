import { connectionDiagnostics } from './connection-diagnostics';

export interface AudioProcessingSettings {
  transmissionMode: 'voice-activation' | 'push-to-talk' | 'continuous';
  vadThreshold: number;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  echoCancellation: boolean;
  comfortNoise: boolean;
}

export class AudioManager {
  private sourceStream?: MediaStream;
  private stream?: MediaStream;
  private context?: AudioContext;
  private analyser?: AnalyserNode;
  private noise?: AudioBufferSourceNode;
  private speakingFrame?: number;
  private muted = false;
  private pttPressed = false;
  private voiceActive = false;
  private lastVoiceAt = 0;
  private resumePending = false;
  private typingSuppressed = false;

  constructor(
    private readonly onSpeaking: (speaking: boolean) => void,
    private readonly onLevel: (level: number) => void,
    private settings: AudioProcessingSettings,
  ) {}

  async start(inputDeviceId = '') {
    this.stop();
    connectionDiagnostics.record('get-user-media:start', undefined, {
      selectedInput: Boolean(inputDeviceId),
    });
    try {
      this.sourceStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          deviceId: inputDeviceId ? { exact: inputDeviceId } : undefined,
          echoCancellation: this.settings.echoCancellation,
          noiseSuppression: this.settings.noiseSuppression,
          autoGainControl: this.settings.autoGainControl,
          channelCount: 1,
          sampleRate: 48_000,
        },
      });
      connectionDiagnostics.record('get-user-media:end', undefined, {
        tracks: this.sourceStream.getAudioTracks().length,
      });
      this.buildProcessingGraph();
      connectionDiagnostics.record('audio-processing-graph:ready');
      this.applyEnabled();
      this.watchLevel();
      return this.stream!;
    } catch (error) {
      connectionDiagnostics.record('get-user-media:error', undefined, {
        name: error instanceof DOMException ? error.name : 'unknown',
      });
      if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError')
          throw new Error('Доступ к микрофону запрещён. Разрешите его в настройках системы.');
        if (error.name === 'NotFoundError')
          throw new Error('Микрофон не найден. Подключите устройство и повторите попытку.');
        if (error.name === 'OverconstrainedError')
          throw new Error('Выбранный микрофон больше недоступен.');
      }
      throw new Error('Не удалось включить микрофон. Проверьте системные настройки.');
    }
  }

  async switchInput(deviceId: string, settings = this.settings) {
    this.settings = settings;
    return this.start(deviceId);
  }
  getStream() {
    return this.stream;
  }
  getTrack() {
    return this.stream?.getAudioTracks()[0];
  }
  isMuted() {
    return this.muted;
  }
  setMuted(muted: boolean) {
    this.muted = muted;
    this.applyEnabled();
  }
  setSettings(settings: AudioProcessingSettings) {
    this.settings = settings;
    this.applyEnabled();
  }
  setPushToTalkPressed(pressed: boolean) {
    this.pttPressed = pressed;
    this.applyEnabled();
  }
  setTypingSuppressed(suppressed: boolean) {
    this.typingSuppressed = suppressed;
    this.applyEnabled();
  }

  stop() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.sourceStream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.sourceStream = undefined;
    if (this.speakingFrame) cancelAnimationFrame(this.speakingFrame);
    this.speakingFrame = undefined;
    this.noise?.stop();
    this.noise = undefined;
    void this.context?.close();
    this.context = undefined;
    this.onLevel(0);
    this.onSpeaking(false);
  }

  static async listDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      inputs: devices.filter((device) => device.kind === 'audioinput'),
      outputs: devices.filter((device) => device.kind === 'audiooutput'),
      cameras: devices.filter((device) => device.kind === 'videoinput'),
    };
  }

  private buildProcessingGraph() {
    this.context = new AudioContext({ sampleRate: 48_000 });
    this.context.onstatechange = () => {
      connectionDiagnostics.record('audio-context:state', undefined, {
        state: this.context?.state ?? 'closed',
      });
      this.ensureContextRunning();
    };
    const source = this.context.createMediaStreamSource(this.sourceStream!);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 512;
    source.connect(this.analyser);

    const destination = this.context.createMediaStreamDestination();
    source.connect(destination);
    if (this.settings.comfortNoise) {
      const buffer = this.context.createBuffer(
        1,
        this.context.sampleRate * 2,
        this.context.sampleRate,
      );
      const data = buffer.getChannelData(0);
      for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
      const noise = this.context.createBufferSource();
      const gain = this.context.createGain();
      gain.gain.value = 0.00035;
      noise.buffer = buffer;
      noise.loop = true;
      noise.connect(gain).connect(destination);
      noise.start();
      this.noise = noise;
    }
    this.stream = destination.stream;
  }

  private applyEnabled() {
    const modeAllows =
      this.settings.transmissionMode === 'continuous' ||
      (this.settings.transmissionMode === 'push-to-talk' && this.pttPressed) ||
      (this.settings.transmissionMode === 'voice-activation' && this.voiceActive);
    const enabled = !this.muted && !this.typingSuppressed && modeAllows;
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }

  private watchLevel() {
    if (!this.analyser) return;
    const values = new Uint8Array(this.analyser.fftSize);
    let previous = false;
    let lastLevelUpdate = 0;
    const tick = (time = 0) => {
      this.analyser!.getByteTimeDomainData(values);
      const rms = Math.sqrt(
        values.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / values.length,
      );
      if (time - lastLevelUpdate > 80) {
        lastLevelUpdate = time;
        this.onLevel(Math.min(1, rms / 0.18));
      }
      const now = performance.now();
      if (rms > this.settings.vadThreshold) {
        this.lastVoiceAt = now;
        this.voiceActive = true;
      } else if (now - this.lastVoiceAt > 350) {
        this.voiceActive = false;
      }
      this.applyEnabled();
      const speaking = Boolean(
        this.getTrack()?.enabled && rms > Math.min(0.035, this.settings.vadThreshold),
      );
      if (speaking !== previous) {
        previous = speaking;
        this.onSpeaking(speaking);
      }
      this.speakingFrame = requestAnimationFrame(tick);
      this.ensureContextRunning();
    };
    tick();
  }

  private ensureContextRunning() {
    const context = this.context;
    if (!context || context.state === 'running' || context.state === 'closed' || this.resumePending)
      return;
    this.resumePending = true;
    void context
      .resume()
      .then(() =>
        connectionDiagnostics.record('audio-context:resumed', undefined, {
          state: context.state,
        }),
      )
      .catch(() => undefined)
      .finally(() => {
        this.resumePending = false;
      });
  }
}

export function monitorRemoteSpeaking(stream: MediaStream, callback: (speaking: boolean) => void) {
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  context.createMediaStreamSource(stream).connect(analyser);
  const values = new Uint8Array(analyser.fftSize);
  let frame = 0;
  let previous = false;
  const tick = () => {
    analyser.getByteTimeDomainData(values);
    const rms = Math.sqrt(
      values.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / values.length,
    );
    const speaking = rms > 0.035;
    if (speaking !== previous) {
      previous = speaking;
      callback(speaking);
    }
    frame = requestAnimationFrame(tick);
  };
  tick();
  return () => {
    cancelAnimationFrame(frame);
    void context.close();
    callback(false);
  };
}

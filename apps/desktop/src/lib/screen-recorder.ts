import type { LocalSettings } from './settings';
import { startNativeMacScreenAudio, stopNativeMacScreenAudio } from './macos-screen-audio';
import { createRecordingDestination, type RecordingDestination } from './recording-storage';
import { connectionDiagnostics } from './connection-diagnostics';

export type ScreenRecordingPhase = 'idle' | 'recording' | 'saving';

export interface ScreenRecordingState {
  phase: ScreenRecordingPhase;
  path?: string;
  startedAt?: number;
}

export interface StartScreenRecordingOptions {
  settings: LocalSettings;
  sharedScreenStream?: MediaStream;
  audioStreams?: MediaStream[];
  participantNames: string[];
}

export class ScreenRecorder {
  private recorder?: MediaRecorder;
  private sourceStream?: MediaStream;
  private recordingStream?: MediaStream;
  private destination?: RecordingDestination;
  private writeQueue = Promise.resolve();
  private stopPromise?: Promise<string>;
  private resolveStop?: (path: string) => void;
  private rejectStop?: (error: unknown) => void;
  private animationFrame?: number;
  private sourceVideo?: HTMLVideoElement;
  private ownsSource = false;
  private nativeScreenAudio = false;
  private recordingError?: Error;
  private audioContext?: AudioContext;
  private audioSources: MediaStreamAudioSourceNode[] = [];

  constructor(private readonly onState: (state: ScreenRecordingState) => void) {}

  async start(options: StartScreenRecordingOptions) {
    if (this.recorder && this.recorder.state !== 'inactive') return this.destination;
    const source =
      options.settings.recordingIncludeSharedVideo && options.sharedScreenStream
        ? options.sharedScreenStream
        : await captureScreenForRecording();
    this.ownsSource = source !== options.sharedScreenStream;
    const videoTrack = source.getVideoTracks()[0];
    if (!videoTrack) {
      if (this.ownsSource) stopStream(source);
      throw new Error('Выбранный экран не вернул видеопоток.');
    }
    if (
      this.ownsSource &&
      /Macintosh|Mac OS X/i.test(navigator.userAgent) &&
      !source.getAudioTracks().length
    ) {
      try {
        source.addTrack(await startNativeMacScreenAudio());
        this.nativeScreenAudio = true;
      } catch {
        // Video recording remains available when macOS declines system audio.
      }
    }
    this.sourceStream = source;

    try {
      const mediaRecorderOptions = recorderOptions(videoTrack);
      this.destination = await createRecordingDestination(
        options.settings.recordingDirectory,
        options.settings.recordingAskDirectory,
        mediaRecorderOptions.mimeType?.startsWith('video/mp4') ? 'mp4' : 'webm',
      );
      let recordingVideoStream: MediaStream;
      if (
        options.settings.recordingShowParticipantNames ||
        options.settings.recordingAddTimestamp
      ) {
        const composition = await composeRecording(
          source,
          options,
          (frame) => (this.animationFrame = frame),
        );
        recordingVideoStream = composition.stream;
        this.sourceVideo = composition.video;
      } else recordingVideoStream = new MediaStream([videoTrack.clone()]);
      const audioMix = await createRecordingAudioMix([source, ...(options.audioStreams ?? [])]);
      this.audioContext = audioMix.context;
      this.audioSources = audioMix.sources;
      this.recordingStream = recordingVideoStream;
      if (audioMix.track) this.recordingStream.addTrack(audioMix.track);
      connectionDiagnostics.record('screen-recording:media-ready', undefined, {
        sourceAudioTracks: source.getAudioTracks().length,
        additionalAudioStreams: options.audioStreams?.length ?? 0,
        mixedAudio: Boolean(audioMix.track),
        mimeType: mediaRecorderOptions.mimeType ?? 'browser-default',
      });
      const recorder = new MediaRecorder(this.recordingStream, mediaRecorderOptions);
      this.recorder = recorder;
      this.writeQueue = Promise.resolve();
      this.stopPromise = new Promise<string>((resolve, reject) => {
        this.resolveStop = resolve;
        this.rejectStop = reject;
      });
      void this.stopPromise.catch(() => undefined);
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        this.writeQueue = this.writeQueue.then(async () => {
          const bytes = new Uint8Array(await event.data.arrayBuffer());
          const written = await this.destination!.file.write(bytes);
          if (written !== bytes.byteLength) throw new Error('Не удалось полностью записать видео.');
        });
      };
      recorder.onerror = (event) => {
        this.recordingError = new Error(event.error?.message || 'Ошибка локальной записи.');
        if (recorder.state === 'recording') recorder.stop();
      };
      recorder.onstop = () => void this.finishStop();
      videoTrack.addEventListener('ended', () => void this.stop(), { once: true });
      recorder.start(1_000);
      this.onState({ phase: 'recording', path: this.destination.path, startedAt: Date.now() });
      return this.destination;
    } catch (error) {
      if (this.destination) await this.destination.file.close().catch(() => undefined);
      this.cleanupMedia();
      this.reset();
      throw error;
    }
  }

  async stop() {
    if (!this.recorder || this.recorder.state === 'inactive') return this.destination?.path ?? '';
    this.onState({
      phase: 'saving',
      path: this.destination?.path,
    });
    this.recorder.stop();
    return this.stopPromise!;
  }

  dispose() {
    if (this.recorder?.state === 'recording') void this.stop();
    else {
      this.cleanupMedia();
      this.reset();
    }
  }

  private async finishStop() {
    const path = this.destination?.path ?? '';
    try {
      await this.writeQueue;
      if (this.recordingError) throw this.recordingError;
      await this.destination?.file.close();
      this.resolveStop?.(path);
      this.onState({ phase: 'idle', path });
    } catch (error) {
      this.rejectStop?.(error);
      this.onState({ phase: 'idle' });
    } finally {
      this.cleanupMedia();
      this.reset();
    }
  }

  private cleanupMedia() {
    if (this.animationFrame !== undefined) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = undefined;
    if (this.sourceVideo) {
      this.sourceVideo.pause();
      this.sourceVideo.srcObject = null;
    }
    this.sourceVideo = undefined;
    stopStream(this.recordingStream);
    if (this.ownsSource) stopStream(this.sourceStream);
    if (this.nativeScreenAudio) void stopNativeMacScreenAudio();
    this.audioSources.forEach((source) => source.disconnect());
    void this.audioContext?.close().catch(() => undefined);
    this.audioContext = undefined;
    this.audioSources = [];
  }

  private reset() {
    this.recorder = undefined;
    this.sourceStream = undefined;
    this.recordingStream = undefined;
    this.destination = undefined;
    this.stopPromise = undefined;
    this.resolveStop = undefined;
    this.rejectStop = undefined;
    this.ownsSource = false;
    this.nativeScreenAudio = false;
    this.recordingError = undefined;
  }
}

async function composeRecording(
  source: MediaStream,
  options: StartScreenRecordingOptions,
  onFrame: (frame: number) => void,
) {
  const sourceTrack = source.getVideoTracks()[0]!;
  const settings = sourceTrack.getSettings();
  const width = Math.max(1, settings.width ?? 1920);
  const height = Math.max(1, settings.height ?? 1080);
  const frameRate = Math.max(15, Math.min(60, settings.frameRate ?? 30));
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = source;
  await video.play();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Не удалось подготовить изображение для записи.');

  const draw = () => {
    context.drawImage(video, 0, 0, width, height);
    drawRecordingOverlays(context, width, height, options);
    onFrame(requestAnimationFrame(draw));
  };
  draw();
  return { stream: canvas.captureStream(frameRate), video };
}

async function createRecordingAudioMix(streams: MediaStream[]) {
  const tracks = new Map<string, MediaStreamTrack>();
  for (const stream of streams) {
    for (const track of stream.getAudioTracks()) {
      if (track.readyState === 'live') tracks.set(track.id, track);
    }
  }
  if (!tracks.size)
    return {
      track: undefined,
      context: undefined,
      sources: [] as MediaStreamAudioSourceNode[],
    };
  const context = new AudioContext({ sampleRate: 48_000 });
  const destination = context.createMediaStreamDestination();
  const sources = [...tracks.values()].map((track) => {
    const source = context.createMediaStreamSource(new MediaStream([track]));
    source.connect(destination);
    return source;
  });
  if (context.state === 'suspended') await context.resume();
  return {
    track: destination.stream.getAudioTracks()[0],
    context,
    sources,
  };
}

function drawRecordingOverlays(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: StartScreenRecordingOptions,
) {
  const scale = Math.max(1, width / 1920);
  context.font = `600 ${Math.round(22 * scale)}px system-ui, sans-serif`;
  context.textBaseline = 'middle';
  if (options.settings.recordingShowParticipantNames && options.participantNames.length) {
    const label = options.participantNames.join(' · ');
    const padding = 14 * scale;
    const boxHeight = 48 * scale;
    const boxWidth = Math.min(width - 40 * scale, context.measureText(label).width + padding * 2);
    context.fillStyle = 'rgba(2, 12, 24, 0.72)';
    context.fillRect(20 * scale, height - boxHeight - 20 * scale, boxWidth, boxHeight);
    context.fillStyle = '#f6f7fa';
    context.fillText(label, 20 * scale + padding, height - boxHeight / 2 - 20 * scale, boxWidth);
  }
  if (options.settings.recordingAddTimestamp) {
    const label = new Date().toLocaleString('ru-RU');
    const padding = 14 * scale;
    const boxHeight = 48 * scale;
    const boxWidth = context.measureText(label).width + padding * 2;
    context.fillStyle = 'rgba(2, 12, 24, 0.72)';
    context.fillRect(width - boxWidth - 20 * scale, 20 * scale, boxWidth, boxHeight);
    context.fillStyle = '#f6f7fa';
    context.fillText(label, width - boxWidth - 20 * scale + padding, 20 * scale + boxHeight / 2);
  }
}

async function captureScreenForRecording() {
  const macOS = /Macintosh|Mac OS X/i.test(navigator.userAgent);
  return navigator.mediaDevices.getDisplayMedia({
    audio: macOS
      ? true
      : {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
          channelCount: { ideal: 2 },
        },
    video: {
      width: { ideal: 3840 },
      height: { ideal: 2160 },
      frameRate: { ideal: 60, max: 60 },
    },
    systemAudio: 'include',
    windowAudio: 'window',
    selfBrowserSurface: 'exclude',
  } as DisplayMediaStreamOptions);
}

function recorderOptions(track: MediaStreamTrack): MediaRecorderOptions {
  const settings = track.getSettings();
  const pixels = (settings.width ?? 1920) * (settings.height ?? 1080);
  const mimeType = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ].find((type) => MediaRecorder.isTypeSupported(type));
  return {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond:
      pixels >= 8_000_000 ? 40_000_000 : pixels >= 3_500_000 ? 24_000_000 : 16_000_000,
    audioBitsPerSecond: 192_000,
  };
}

function stopStream(stream?: MediaStream) {
  stream?.getTracks().forEach((track) => track.stop());
}

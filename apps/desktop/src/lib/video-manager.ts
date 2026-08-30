import { connectionDiagnostics } from './connection-diagnostics';
import {
  DEFAULT_VIDEO_PREFERENCES,
  normalizeVideoPreferences,
  screenCaptureConstraints,
  type VideoPreferences,
} from './video-quality';
import { startNativeMacScreenAudio, stopNativeMacScreenAudio } from './macos-screen-audio';

export type LocalVideoSource = 'none' | 'camera' | 'screen';
export type VideoMediaSource = Exclude<LocalVideoSource, 'none'>;

export interface LocalVideoState {
  cameraEnabled: boolean;
  screenEnabled: boolean;
  screenAudioEnabled: boolean;
  source: LocalVideoSource;
  previewStream?: MediaStream;
  cameraStream?: MediaStream;
  screenStream?: MediaStream;
}

type PublishVideo = (
  track: MediaStreamTrack | null,
  source: VideoMediaSource,
  stream?: MediaStream,
) => Promise<void>;

export function cameraConstraints(deviceId = ''): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 60, max: 60 },
  };
}

export class VideoManager {
  private cameraTrack?: MediaStreamTrack;
  private screenTrack?: MediaStreamTrack;
  private screenStream?: MediaStream;
  private nativeScreenAudio = false;
  private operationQueue = Promise.resolve();
  private disposed = false;
  private preferences: VideoPreferences;

  constructor(
    private readonly publish: PublishVideo,
    private readonly onState: (state: LocalVideoState) => void,
    private readonly onError: (message: string) => void = () => undefined,
    private readonly onNotice: (message: string) => void = () => undefined,
    preferences: VideoPreferences = DEFAULT_VIDEO_PREFERENCES,
  ) {
    this.preferences = normalizeVideoPreferences(preferences);
  }

  toggleCamera() {
    return this.enqueue(() => (this.cameraTrack ? this.stopCamera() : this.startCamera()));
  }

  toggleScreen(includeAudio = true) {
    return this.enqueue(() =>
      this.screenTrack ? this.stopScreen() : this.startScreen(includeAudio),
    );
  }

  setPreferences(preferences: VideoPreferences) {
    this.preferences = normalizeVideoPreferences(preferences);
  }

  setCameraDevice(deviceId: string) {
    return this.enqueue(async () => {
      this.preferences = { ...this.preferences, cameraDeviceId: deviceId };
      if (!this.cameraTrack) return;
      await this.replaceCamera();
    });
  }

  getCurrent() {
    const track = this.screenTrack ?? this.cameraTrack ?? null;
    return { track, source: this.source() };
  }

  getTracks() {
    return {
      camera: this.cameraTrack ?? null,
      screen: this.screenTrack ?? null,
      screenStream: this.screenStream,
    };
  }

  dispose() {
    this.disposed = true;
    this.stopStream(this.screenStream);
    this.detachAndStop(this.cameraTrack);
    this.screenTrack = undefined;
    this.screenStream = undefined;
    this.cameraTrack = undefined;
    if (this.nativeScreenAudio) void stopNativeMacScreenAudio();
    this.nativeScreenAudio = false;
    this.emitState();
  }

  private async startCamera() {
    if (this.disposed) return;
    connectionDiagnostics.record('camera-capture:start');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: cameraConstraints(this.preferences.cameraDeviceId),
      });
    } catch (error) {
      connectionDiagnostics.record('camera-capture:error', undefined, {
        errorName: error instanceof DOMException ? error.name : 'unknown',
      });
      throw new Error(cameraErrorMessage(error));
    }
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((item) => item.stop());
      throw new Error('Камера не вернула видеопоток. Проверьте подключение устройства.');
    }
    if (this.disposed) {
      track.stop();
      return;
    }
    this.cameraTrack = track;
    track.contentHint = 'motion';
    track.onended = () => {
      void this.enqueue(async () => {
        if (this.cameraTrack !== track) return;
        this.cameraTrack = undefined;
        connectionDiagnostics.record('camera-track:ended');
        await this.publish(null, 'camera');
        this.emitState();
        this.onError(
          'Камера была отключена или перестала быть доступна. Голосовая связь сохранена.',
        );
      });
    };
    connectionDiagnostics.record('camera-capture:ready', undefined, videoTrackDetails(track));
    await this.publish(track, 'camera');
    this.emitState();
  }

  private async stopCamera() {
    const track = this.cameraTrack;
    this.cameraTrack = undefined;
    await this.publish(null, 'camera');
    this.detachAndStop(track);
    connectionDiagnostics.record('camera-capture:stopped');
    this.emitState();
  }

  private async replaceCamera() {
    const previous = this.cameraTrack;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: cameraConstraints(this.preferences.cameraDeviceId),
      });
    } catch (error) {
      throw new Error(cameraErrorMessage(error));
    }
    const replacement = stream.getVideoTracks()[0];
    if (!replacement) {
      this.stopStream(stream);
      throw new Error('Выбранная камера не вернула видеопоток.');
    }
    replacement.contentHint = 'motion';
    replacement.onended = () => {
      void this.enqueue(async () => {
        if (this.cameraTrack !== replacement) return;
        this.cameraTrack = undefined;
        await this.publish(null, 'camera');
        this.emitState();
      });
    };
    this.cameraTrack = replacement;
    await this.publish(replacement, 'camera');
    this.detachAndStop(previous);
    connectionDiagnostics.record(
      'camera-device:switched',
      undefined,
      videoTrackDetails(replacement),
    );
    this.emitState();
  }

  private async startScreen(includeAudio: boolean) {
    if (this.disposed) return;
    connectionDiagnostics.record('screen-capture:start');
    const macOS = /Macintosh|Mac OS X/i.test(navigator.userAgent);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        audio: includeAudio
          ? macOS
            ? true
            : {
                autoGainControl: false,
                echoCancellation: false,
                noiseSuppression: false,
                channelCount: { ideal: 2 },
                restrictOwnAudio: true,
              }
          : false,
        video: screenCaptureConstraints(this.preferences),
        selfBrowserSurface: 'exclude',
        systemAudio: includeAudio ? 'include' : 'exclude',
        windowAudio: includeAudio ? 'window' : 'exclude',
      } as DisplayMediaStreamOptions);
    } catch (error) {
      connectionDiagnostics.record('screen-capture:error', undefined, {
        errorName: error instanceof DOMException ? error.name : 'unknown',
      });
      throw new Error(screenErrorMessage(error));
    }
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((item) => item.stop());
      throw new Error('Не удалось получить изображение выбранного экрана или окна.');
    }
    if (this.disposed) {
      stream.getTracks().forEach((item) => item.stop());
      return;
    }
    if (!includeAudio) {
      stream.getAudioTracks().forEach((item) => {
        item.stop();
        stream.removeTrack(item);
      });
    }
    this.screenTrack = track;
    this.screenStream = stream;
    track.contentHint = this.preferences.screenContentMode === 'text' ? 'detail' : 'motion';
    let audioTrack = stream.getAudioTracks()[0];
    if (includeAudio && macOS && !audioTrack) {
      try {
        audioTrack = await startNativeMacScreenAudio();
        stream.addTrack(audioTrack);
        this.nativeScreenAudio = true;
      } catch (error) {
        connectionDiagnostics.record('screen-audio-native:error', undefined, {
          error: error instanceof Error ? error.message : 'unknown',
        });
      }
    }
    if (audioTrack) audioTrack.contentHint = 'music';
    track.onended = () => {
      void this.enqueue(() => this.finishScreen(track, false));
    };
    connectionDiagnostics.record('screen-capture:ready', undefined, {
      ...videoTrackDetails(track),
      audioIncluded: Boolean(audioTrack),
      audioTrackId: audioTrack?.id ?? 'none',
      displaySurface: track.getSettings().displaySurface ?? 'unknown',
    });
    if (includeAudio && !audioTrack) {
      this.onNotice(
        macOS
          ? 'macOS не запустила нативный захват системного звука. Установите macOS 13 или новее и повторно разрешите FreeTalk запись экрана и системного аудио.'
          : 'Экран включён, но система не предоставила аудиодорожку. В системном окне выберите экран или окно с включённой передачей звука.',
      );
    }
    await this.publish(track, 'screen', stream);
    this.emitState();
  }

  private stopScreen() {
    return this.finishScreen(this.screenTrack, true);
  }

  private async finishScreen(track: MediaStreamTrack | undefined, stopTrack: boolean) {
    if (!track || this.screenTrack !== track) return;
    const stream = this.screenStream;
    const nativeScreenAudio = this.nativeScreenAudio;
    this.screenTrack = undefined;
    this.screenStream = undefined;
    this.nativeScreenAudio = false;
    track.onended = null;
    await this.publish(null, 'screen');
    if (stopTrack) this.stopStream(stream);
    else stream?.getAudioTracks().forEach((item) => item.stop());
    if (nativeScreenAudio) await stopNativeMacScreenAudio();
    connectionDiagnostics.record('screen-capture:stopped', undefined, {
      initiatedBy: stopTrack ? 'app' : 'system',
      cameraPreserved: Boolean(this.cameraTrack),
    });
    this.emitState();
  }

  private source(): LocalVideoSource {
    if (this.screenTrack) return 'screen';
    if (this.cameraTrack) return 'camera';
    return 'none';
  }

  private emitState() {
    const current = this.screenTrack ?? this.cameraTrack;
    this.onState({
      cameraEnabled: Boolean(this.cameraTrack),
      screenEnabled: Boolean(this.screenTrack),
      screenAudioEnabled: Boolean(this.screenStream?.getAudioTracks().length),
      source: this.source(),
      previewStream: current ? new MediaStream([current]) : undefined,
      cameraStream: this.cameraTrack ? new MediaStream([this.cameraTrack]) : undefined,
      screenStream: this.screenTrack ? this.screenStream : undefined,
    });
  }

  private detachAndStop(track: MediaStreamTrack | undefined) {
    if (!track) return;
    track.onended = null;
    track.stop();
  }

  private stopStream(stream: MediaStream | undefined) {
    stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
  }

  private enqueue<T>(operation: () => Promise<T>) {
    const pending = this.operationQueue.then(operation);
    this.operationQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }
}

function videoTrackDetails(track: MediaStreamTrack) {
  const settings = track.getSettings();
  return {
    width: settings.width ?? 0,
    height: settings.height ?? 0,
    frameRate: settings.frameRate ?? 0,
    deviceId: settings.deviceId ?? 'unknown',
    trackId: track.id,
  };
}

function cameraErrorMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Доступ к камере запрещён. Разрешите его в настройках конфиденциальности системы.';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError')
    return 'Камера не найдена. Подключите камеру и попробуйте снова.';
  if (name === 'NotReadableError' || name === 'TrackStartError')
    return 'Камера занята другим приложением или недоступна.';
  if (name === 'OverconstrainedError') return 'Камера не поддерживает выбранный режим видео.';
  return 'Не удалось включить камеру. Проверьте устройство и системные разрешения.';
}

function screenErrorMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError')
    return 'Демонстрация экрана отменена или запрещена системными настройками.';
  if (name === 'NotFoundError') return 'Экран или окно для демонстрации не найдено.';
  if (name === 'NotReadableError') return 'Система не разрешила захват выбранного экрана или окна.';
  return 'Не удалось запустить демонстрацию экрана.';
}

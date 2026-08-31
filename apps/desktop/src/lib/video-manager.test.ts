// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startNativeMacScreenAudio, stopNativeMacScreenAudio } from './macos-screen-audio';
import { VideoManager } from './video-manager';
import { DEFAULT_VIDEO_PREFERENCES } from './video-quality';

vi.mock('./macos-screen-audio', () => ({
  startNativeMacScreenAudio: vi.fn(),
  stopNativeMacScreenAudio: vi.fn(async () => undefined),
}));

class FakeTrack {
  id = crypto.randomUUID();
  contentHint = '';
  onended: (() => void) | null = null;
  stop = vi.fn();
  getSettings() {
    return { width: 1920, height: 1080, frameRate: 60, deviceId: 'camera-1' };
  }
  constructor(public readonly kind: 'audio' | 'video' = 'video') {}
}

class FakeStream {
  constructor(private tracks: FakeTrack[]) {}
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === 'video');
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }
  removeTrack(track: FakeTrack) {
    this.tracks = this.tracks.filter((item) => item !== track);
  }
  addTrack(track: FakeTrack) {
    this.tracks.push(track);
  }
}

describe('VideoManager', () => {
  const cameraTracks: FakeTrack[] = [];
  const screenTracks: FakeTrack[] = [];
  const screenAudioTracks: FakeTrack[] = [];
  const screenStreams: FakeStream[] = [];

  beforeEach(() => {
    cameraTracks.length = 0;
    screenTracks.length = 0;
    screenAudioTracks.length = 0;
    screenStreams.length = 0;
    vi.mocked(startNativeMacScreenAudio).mockReset();
    vi.mocked(stopNativeMacScreenAudio).mockClear();
    vi.stubGlobal('MediaStream', FakeStream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => {
          const track = new FakeTrack();
          cameraTracks.push(track);
          return new FakeStream([track]);
        }),
        getDisplayMedia: vi.fn(async () => {
          const videoTrack = new FakeTrack();
          const audioTrack = new FakeTrack('audio');
          const stream = new FakeStream([videoTrack, audioTrack]);
          screenTracks.push(videoTrack);
          screenAudioTracks.push(audioTrack);
          screenStreams.push(stream);
          return stream;
        }),
      },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('toggles the camera five times without leaking tracks', async () => {
    const publish = vi.fn(async () => undefined);
    const onState = vi.fn();
    const manager = new VideoManager(publish, onState);

    for (let index = 0; index < 5; index += 1) {
      await manager.toggleCamera();
      expect(manager.getCurrent().source).toBe('camera');
      await manager.toggleCamera();
      expect(manager.getCurrent().source).toBe('none');
    }

    expect(cameraTracks).toHaveLength(5);
    expect(cameraTracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
    const calls = publish.mock.calls as unknown as Array<[MediaStreamTrack | null, string]>;
    expect(calls.filter(([, source]) => source === 'camera')).toHaveLength(10);
    expect(calls.filter(([track]) => track === null)).toHaveLength(5);
  });

  it('keeps camera and screen as independent simultaneous tracks', async () => {
    const publish = vi.fn(async () => undefined);
    const manager = new VideoManager(publish, vi.fn());

    await manager.toggleCamera();
    const camera = cameraTracks[0]!;
    await manager.toggleScreen();
    expect(manager.getCurrent()).toEqual({ track: screenTracks[0], source: 'screen' });
    expect(manager.getTracks()).toEqual({
      camera,
      screen: screenTracks[0],
      screenStream: screenStreams[0],
    });
    await manager.toggleScreen();

    expect(manager.getCurrent()).toEqual({ track: camera, source: 'camera' });
    expect(screenTracks[0]!.stop).toHaveBeenCalledOnce();
    expect(screenAudioTracks[0]!.stop).toHaveBeenCalledOnce();
    expect(camera.stop).not.toHaveBeenCalled();
    expect(publish.mock.calls).toContainEqual([camera, 'camera']);
    expect(publish.mock.calls.at(-1)).toEqual([null, 'screen']);
  });

  it('handles the system Stop sharing event and keeps video off without a camera', async () => {
    const publish = vi.fn(async () => undefined);
    const manager = new VideoManager(publish, vi.fn());

    await manager.toggleScreen();
    screenTracks[0]!.onended?.();
    await vi.waitFor(() => expect(manager.getCurrent().source).toBe('none'));

    expect(publish.mock.calls.at(-1)).toEqual([null, 'screen']);
  });

  it('keeps screen sharing active when the camera is turned off underneath it', async () => {
    const publish = vi.fn(async () => undefined);
    const manager = new VideoManager(publish, vi.fn());

    await manager.toggleCamera();
    await manager.toggleScreen();
    await manager.toggleCamera();

    expect(manager.getCurrent().source).toBe('screen');
    await manager.toggleScreen();
    expect(manager.getCurrent().source).toBe('none');
  });

  it('requests a high-quality camera mode without exact constraints', async () => {
    const manager = new VideoManager(
      vi.fn(async () => undefined),
      vi.fn(),
    );
    await manager.toggleCamera();

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 60, max: 60 },
      },
    });
  });

  it('uses the selected camera and switches an active camera without leaving the room', async () => {
    const publish = vi.fn(async () => undefined);
    const manager = new VideoManager(publish, vi.fn(), vi.fn(), vi.fn(), {
      ...DEFAULT_VIDEO_PREFERENCES,
      cameraDeviceId: 'camera-external',
    });
    await manager.toggleCamera();

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenLastCalledWith({
      audio: false,
      video: expect.objectContaining({ deviceId: { exact: 'camera-external' } }),
    });
    const firstTrack = cameraTracks[0]!;
    await manager.setCameraDevice('camera-second');

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenLastCalledWith({
      audio: false,
      video: expect.objectContaining({ deviceId: { exact: 'camera-second' } }),
    });
    expect(firstTrack.stop).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenLastCalledWith(cameraTracks[1], 'camera');
  });

  it('requests and publishes selected window audio together with the screen stream', async () => {
    const publish = vi.fn(async () => undefined);
    const onState = vi.fn();
    const manager = new VideoManager(publish, onState);

    await manager.toggleScreen();

    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledWith({
      audio: {
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
        channelCount: { ideal: 2 },
        restrictOwnAudio: true,
      },
      video: {
        displaySurface: 'window',
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
        frameRate: { ideal: 30, max: 30 },
      },
      selfBrowserSurface: 'exclude',
      systemAudio: 'include',
      windowAudio: 'window',
    });
    expect(publish).toHaveBeenCalledWith(screenTracks[0], 'screen', screenStreams[0]);
    expect(screenAudioTracks[0]!.contentHint).toBe('music');
    expect(onState).toHaveBeenLastCalledWith(
      expect.objectContaining({ screenEnabled: true, screenAudioEnabled: true }),
    );
  });

  it('uses the simplest audio request supported by macOS WebKit', async () => {
    const userAgent = vi
      .spyOn(navigator, 'userAgent', 'get')
      .mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15');
    const manager = new VideoManager(
      vi.fn(async () => undefined),
      vi.fn(),
    );

    await manager.toggleScreen(true);

    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledWith(
      expect.objectContaining({ audio: true, systemAudio: 'include' }),
    );
    userAgent.mockRestore();
  });

  it('falls back to native ScreenCaptureKit audio when macOS WebKit returns video only', async () => {
    const userAgent = vi
      .spyOn(navigator, 'userAgent', 'get')
      .mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15');
    const video = new FakeTrack();
    const nativeAudio = new FakeTrack('audio');
    const stream = new FakeStream([video]);
    vi.mocked(navigator.mediaDevices.getDisplayMedia).mockResolvedValueOnce(
      stream as unknown as MediaStream,
    );
    vi.mocked(startNativeMacScreenAudio).mockResolvedValueOnce(
      nativeAudio as unknown as MediaStreamTrack,
    );
    const publish = vi.fn(async () => undefined);
    const manager = new VideoManager(publish, vi.fn());

    await manager.toggleScreen(true);

    expect(startNativeMacScreenAudio).toHaveBeenCalledOnce();
    expect(stream.getAudioTracks()).toEqual([nativeAudio]);
    expect(publish).toHaveBeenCalledWith(video, 'screen', stream);
    await manager.toggleScreen();
    expect(stopNativeMacScreenAudio).toHaveBeenCalledOnce();
    userAgent.mockRestore();
  });

  it('supports the maximum 2K 60 FPS screen preset', async () => {
    const manager = new VideoManager(
      vi.fn(async () => undefined),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      {
        ...DEFAULT_VIDEO_PREFERENCES,
        screenResolution: '1440p',
        screenFrameRate: 60,
      },
    );

    await manager.toggleScreen();

    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        video: {
          displaySurface: 'window',
          width: { ideal: 2560, max: 2560 },
          height: { ideal: 1440, max: 1440 },
          frameRate: { ideal: 60, max: 60 },
        },
      }),
    );
  });

  it('marks video-oriented screen sharing for smooth motion', async () => {
    const manager = new VideoManager(
      vi.fn(async () => undefined),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      { ...DEFAULT_VIDEO_PREFERENCES, screenContentMode: 'video' },
    );

    await manager.toggleScreen();

    expect(screenTracks[0]!.contentHint).toBe('motion');
  });

  it('leaves codec optimization balanced in universal mode', async () => {
    const manager = new VideoManager(
      vi.fn(async () => undefined),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      { ...DEFAULT_VIDEO_PREFERENCES, screenContentMode: 'balanced' },
    );

    await manager.toggleScreen();

    expect(screenTracks[0]!.contentHint).toBe('');
  });

  it('can share without audio and removes any unexpected audio track', async () => {
    const publish = vi.fn(async () => undefined);
    const onState = vi.fn();
    const manager = new VideoManager(publish, onState);

    await manager.toggleScreen(false);

    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledWith({
      audio: false,
      video: {
        displaySurface: 'window',
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
        frameRate: { ideal: 30, max: 30 },
      },
      selfBrowserSurface: 'exclude',
      systemAudio: 'exclude',
      windowAudio: 'exclude',
    });
    expect(screenAudioTracks[0]!.stop).toHaveBeenCalledOnce();
    expect(screenStreams[0]!.getAudioTracks()).toHaveLength(0);
    expect(onState).toHaveBeenLastCalledWith(
      expect.objectContaining({ screenEnabled: true, screenAudioEnabled: false }),
    );
  });

  it('warns when the platform does not return a requested screen audio track', async () => {
    const streamWithoutAudio = new FakeStream([new FakeTrack()]);
    vi.mocked(navigator.mediaDevices.getDisplayMedia).mockResolvedValueOnce(
      streamWithoutAudio as unknown as MediaStream,
    );
    const onNotice = vi.fn();
    const manager = new VideoManager(
      vi.fn(async () => undefined),
      vi.fn(),
      vi.fn(),
      onNotice,
    );

    await manager.toggleScreen(true);

    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('не предоставила аудиодорожку'));
  });

  it('can start camera while screen sharing and leaves screen active when camera stops', async () => {
    const publish = vi.fn(async () => undefined);
    const manager = new VideoManager(publish, vi.fn());

    await manager.toggleScreen();
    await manager.toggleCamera();
    expect(manager.getTracks()).toEqual({
      camera: cameraTracks[0],
      screen: screenTracks[0],
      screenStream: screenStreams[0],
    });
    await manager.toggleCamera();
    expect(manager.getTracks()).toEqual({
      camera: null,
      screen: screenTracks[0],
      screenStream: screenStreams[0],
    });
    expect(screenTracks[0]!.stop).not.toHaveBeenCalled();
  });
});

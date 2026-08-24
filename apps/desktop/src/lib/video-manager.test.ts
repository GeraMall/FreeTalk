// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoManager } from './video-manager';

class FakeTrack {
  kind = 'video';
  contentHint = '';
  onended: (() => void) | null = null;
  stop = vi.fn();
  getSettings() {
    return { width: 1280, height: 720, frameRate: 30 };
  }
}

class FakeStream {
  constructor(private readonly tracks: FakeTrack[]) {}
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks;
  }
}

describe('VideoManager', () => {
  const cameraTracks: FakeTrack[] = [];
  const screenTracks: FakeTrack[] = [];

  beforeEach(() => {
    cameraTracks.length = 0;
    screenTracks.length = 0;
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
          const track = new FakeTrack();
          screenTracks.push(track);
          return new FakeStream([track]);
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
    expect(calls.filter(([, source]) => source === 'camera')).toHaveLength(5);
    expect(calls.filter(([, source]) => source === 'none')).toHaveLength(5);
  });

  it('restores an active camera after screen sharing ends in the app', async () => {
    const publish = vi.fn(async () => undefined);
    const manager = new VideoManager(publish, vi.fn());

    await manager.toggleCamera();
    const camera = cameraTracks[0]!;
    await manager.toggleScreen();
    expect(manager.getCurrent()).toEqual({ track: screenTracks[0], source: 'screen' });
    await manager.toggleScreen();

    expect(manager.getCurrent()).toEqual({ track: camera, source: 'camera' });
    expect(screenTracks[0]!.stop).toHaveBeenCalledOnce();
    expect(camera.stop).not.toHaveBeenCalled();
    expect(publish.mock.calls.at(-1)).toEqual([camera, 'camera']);
  });

  it('handles the system Stop sharing event and keeps video off without a camera', async () => {
    const publish = vi.fn(async () => undefined);
    const manager = new VideoManager(publish, vi.fn());

    await manager.toggleScreen();
    screenTracks[0]!.onended?.();
    await vi.waitFor(() => expect(manager.getCurrent().source).toBe('none'));

    expect(publish.mock.calls.at(-1)).toEqual([null, 'none']);
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
});

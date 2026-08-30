// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from './settings';

const storage = vi.hoisted(() => ({
  write: vi.fn(async (bytes: Uint8Array) => bytes.byteLength),
  close: vi.fn(async () => undefined),
  create: vi.fn(),
}));

vi.mock('./recording-storage', () => ({
  createRecordingDestination: storage.create,
}));

import { ScreenRecorder } from './screen-recorder';

class FakeTrack extends EventTarget {
  kind = 'video';
  id = crypto.randomUUID();
  stop = vi.fn();
  clone = vi.fn(() => new FakeTrack());
  getSettings() {
    return { width: 1920, height: 1080, frameRate: 30 };
  }
}

class FakeStream {
  constructor(private readonly tracks: FakeTrack[]) {}
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === 'video');
  }
  getAudioTracks() {
    return [];
  }
}

class FakeMediaRecorder {
  static isTypeSupported(type: string) {
    return type.startsWith('video/webm');
  }
  state: RecordingState = 'inactive';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  start() {
    this.state = 'recording';
  }
  stop() {
    this.ondataavailable?.({
      data: {
        size: 3,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      },
    } as unknown as BlobEvent);
    this.state = 'inactive';
    this.onstop?.();
  }
}

describe('local screen recorder', () => {
  beforeEach(() => {
    storage.write.mockClear();
    storage.close.mockClear();
    storage.create.mockReset().mockResolvedValue({
      directory: 'D:/Recordings',
      path: 'D:/Recordings/FreeTalk.webm',
      file: { write: storage.write, close: storage.close },
    });
    vi.stubGlobal('MediaStream', FakeStream);
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('streams chunks to a local file and does not stop an active shared screen', async () => {
    const sourceTrack = new FakeTrack();
    const shared = new FakeStream([sourceTrack]) as unknown as MediaStream;
    const states = vi.fn();
    const recorder = new ScreenRecorder(states);

    const destination = await recorder.start({
      settings: {
        ...defaultSettings(),
        recordingShowParticipantNames: false,
        recordingAddTimestamp: false,
      },
      sharedScreenStream: shared,
      participantNames: ['Гера', 'Друг'],
    });
    expect(destination?.path).toBe('D:/Recordings/FreeTalk.webm');

    await expect(recorder.stop()).resolves.toBe('D:/Recordings/FreeTalk.webm');
    expect(storage.write).toHaveBeenCalledOnce();
    expect(storage.close).toHaveBeenCalledOnce();
    expect(sourceTrack.stop).not.toHaveBeenCalled();
    expect(states).toHaveBeenCalledWith(expect.objectContaining({ phase: 'recording' }));
    expect(states).toHaveBeenLastCalledWith({
      phase: 'idle',
      path: 'D:/Recordings/FreeTalk.webm',
    });
  });
});

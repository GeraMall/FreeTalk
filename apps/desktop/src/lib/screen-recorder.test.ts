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
  id = crypto.randomUUID();
  readyState: MediaStreamTrackState = 'live';
  stop = vi.fn();
  constructor(public kind: 'video' | 'audio' = 'video') {
    super();
  }
  clone = vi.fn(() => new FakeTrack(this.kind));
  getSettings() {
    return { width: 1920, height: 1080, frameRate: 30 };
  }
}

class FakeStream {
  constructor(private readonly tracks: FakeTrack[]) {}
  addTrack(track: FakeTrack) {
    this.tracks.push(track);
  }
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === 'video');
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }
}

class FakeAudioContext {
  state: AudioContextState = 'running';
  close = vi.fn(async () => undefined);
  resume = vi.fn(async () => undefined);
  createMediaStreamDestination() {
    return { stream: new FakeStream([new FakeTrack('audio')]) };
  }
  createMediaStreamSource() {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }
}

class FakeMediaRecorder {
  static latestStream?: FakeStream;
  static isTypeSupported(type: string) {
    return type.startsWith('video/mp4');
  }
  state: RecordingState = 'inactive';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  constructor(stream: FakeStream) {
    FakeMediaRecorder.latestStream = stream;
  }
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
      path: 'D:/Recordings/FreeTalk.mp4',
      file: { write: storage.write, close: storage.close },
    });
    vi.stubGlobal('MediaStream', FakeStream);
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    vi.stubGlobal('AudioContext', FakeAudioContext);
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
    expect(destination?.path).toBe('D:/Recordings/FreeTalk.mp4');
    expect(storage.create).toHaveBeenCalledWith(expect.any(String), expect.any(Boolean), 'mp4');

    await expect(recorder.stop()).resolves.toBe('D:/Recordings/FreeTalk.mp4');
    expect(storage.write).toHaveBeenCalledOnce();
    expect(storage.close).toHaveBeenCalledOnce();
    expect(sourceTrack.stop).not.toHaveBeenCalled();
    expect(states).toHaveBeenCalledWith(expect.objectContaining({ phase: 'recording' }));
    expect(states).toHaveBeenLastCalledWith({
      phase: 'idle',
      path: 'D:/Recordings/FreeTalk.mp4',
    });
  });

  it('mixes screen, microphone, and participant audio into one recorder track', async () => {
    const source = new FakeStream([new FakeTrack('video'), new FakeTrack('audio')]);
    const microphone = new FakeStream([new FakeTrack('audio')]);
    const participant = new FakeStream([new FakeTrack('audio')]);
    const recorder = new ScreenRecorder(vi.fn());

    await recorder.start({
      settings: {
        ...defaultSettings(),
        recordingShowParticipantNames: false,
        recordingAddTimestamp: false,
      },
      sharedScreenStream: source as unknown as MediaStream,
      audioStreams: [microphone as unknown as MediaStream, participant as unknown as MediaStream],
      participantNames: ['Гера', 'Друг'],
    });

    expect(FakeMediaRecorder.latestStream?.getVideoTracks()).toHaveLength(1);
    expect(FakeMediaRecorder.latestStream?.getAudioTracks()).toHaveLength(1);
    await recorder.stop();
  });
});

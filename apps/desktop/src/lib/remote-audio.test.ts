// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { monitorRemoteSpeaking } from './audio-manager';
import { RemoteAudio } from './remote-audio';

vi.mock('./audio-manager', () => ({ monitorRemoteSpeaking: vi.fn(() => vi.fn()) }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(monitorRemoteSpeaking).mockClear();
});

describe('remote audio lifecycle', () => {
  it('does not resume audio or monitoring after leaving while output selection is pending', async () => {
    let release!: () => void;
    const selected = new Promise<void>((resolve) => {
      release = resolve;
    });
    const audio = new Audio();
    Object.assign(audio, { setSinkId: () => selected });
    const play = vi.spyOn(audio, 'play').mockResolvedValue();
    vi.spyOn(audio, 'pause').mockImplementation(() => {});
    vi.stubGlobal(
      'Audio',
      vi.fn(function () {
        return audio;
      }),
    );
    const remote = new RemoteAudio(vi.fn());
    try {
      const attaching = remote.attach('peer', {} as MediaStream, 1, false, 'speakers');
      remote.closeAll();
      release();
      await attaching;
      expect(play).not.toHaveBeenCalled();
      expect(monitorRemoteSpeaking).not.toHaveBeenCalled();
      expect(audio.srcObject).toBeNull();
    } finally {
      remote.closeAll();
      vi.unstubAllGlobals();
    }
  });

  it('does not recreate a speaking monitor after pending playback completes on a closed call', async () => {
    let release!: () => void;
    const playing = new Promise<void>((resolve) => {
      release = resolve;
    });
    const audio = new Audio();
    vi.spyOn(audio, 'play').mockReturnValue(playing);
    vi.spyOn(audio, 'pause').mockImplementation(() => {});
    vi.stubGlobal(
      'Audio',
      vi.fn(function () {
        return audio;
      }),
    );
    const remote = new RemoteAudio(vi.fn());
    try {
      const attaching = remote.attach('peer', {} as MediaStream, 1, false, '');
      await Promise.resolve();
      remote.closeAll();
      release();
      await attaching;
      expect(monitorRemoteSpeaking).not.toHaveBeenCalled();
      expect(audio.srcObject).toBeNull();
    } finally {
      remote.closeAll();
      vi.unstubAllGlobals();
    }
  });
});

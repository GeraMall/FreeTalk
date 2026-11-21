// @vitest-environment jsdom
import { invoke } from '@tauri-apps/api/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectionDiagnostics } from './connection-diagnostics';
import { screenPickerStore } from './native-screen-picker';
import { DEFAULT_VIDEO_PREFERENCES } from './video-quality';
import {
  ScreenReceiver,
  attachNativeScreenSender,
  parseSignal,
  receiveNativeScreen,
  startNativeWindowsScreen,
} from './windows-screen';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }));

class FakeConnection {
  static instance: FakeConnection;
  signalingState = 'stable';
  remoteDescription: RTCSessionDescriptionInit | null = null;
  onicecandidate: unknown;
  ontrack?: (event: Pick<RTCTrackEvent, 'receiver' | 'track'>) => void;
  addIceCandidate = vi.fn(async () => undefined);
  setRemoteDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    this.remoteDescription = description;
  });
  createAnswer = vi.fn(async () => ({ type: 'answer', sdp: 'answer-sdp' }));
  setLocalDescription = vi.fn(async () => undefined);
  close = vi.fn(() => {
    this.signalingState = 'closed';
  });
  constructor() {
    FakeConnection.instance = this;
  }
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.mocked(invoke).mockReset();
});

function stubWebRtc() {
  vi.stubGlobal('RTCPeerConnection', FakeConnection);
  vi.stubGlobal(
    'MediaStream',
    class {
      addTrack() {}
      getTracks() {
        return [];
      }
    },
  );
}

function stubScreenReceiver() {
  stubWebRtc();
  const channel = { readyState: 'connecting', close: vi.fn() } as unknown as RTCDataChannel;
  return receiveNativeScreen(channel, [], vi.fn(), vi.fn());
}

function inboundVideo(id: string, timestamp: number, framesDecoded: number) {
  return [
    id,
    {
      id,
      timestamp,
      framesDecoded,
      type: 'inbound-rtp',
      kind: 'video',
      frameWidth: 2560,
      frameHeight: 1440,
      trackIdentifier: 'not-for-diagnostics',
    },
  ] as const;
}

function attachVideo(getStats: () => Promise<unknown>) {
  const track = { kind: 'video', readyState: 'live' } as MediaStreamTrack;
  const receiver = { track, getStats } as RTCRtpReceiver;
  FakeConnection.instance.ontrack?.({ track, receiver });
}

describe('native screen transport', () => {
  it('buffers ICE until the native offer arrives and serializes negotiation', async () => {
    vi.stubGlobal('RTCPeerConnection', FakeConnection);
    vi.stubGlobal(
      'MediaStream',
      class {
        getTracks() {
          return [];
        }
      },
    );
    const send = vi.fn(async () => undefined);
    const receiver = new ScreenReceiver([], send, vi.fn());
    await receiver.receive({ kind: 'ice', candidate: { candidate: 'candidate:1' } });
    expect(FakeConnection.instance.addIceCandidate).not.toHaveBeenCalled();
    await receiver.receive({ kind: 'offer', sdp: 'native-sdp' });
    expect(FakeConnection.instance.addIceCandidate).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({ kind: 'answer', sdp: 'answer-sdp' });
    receiver.close();
    await receiver.receive({ kind: 'offer', sdp: 'late-sdp' });
    expect(FakeConnection.instance.setRemoteDescription).toHaveBeenCalledOnce();
  });
  it('ignores malformed and oversized signaling messages', () => {
    for (const raw of [
      null,
      {},
      'null',
      '{',
      '{"kind":"offer","sdp":42}',
      JSON.stringify({ kind: 'ice', candidate: { candidate: 8 } }),
      'x'.repeat(128_001),
    ])
      expect(parseSignal(raw)).toBeNull();
    expect(parseSignal('{"kind":"ready"}')).toEqual({ kind: 'ready' });
    expect(parseSignal('{"kind":"stop"}')).toEqual({ kind: 'stop' });
  });

  it('samples decoded dimensions and computes FPS from the same inbound stream only', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Windows');
    const record = vi.spyOn(connectionDiagnostics, 'record');
    const close = stubScreenReceiver();
    const getStats = vi
      .fn()
      .mockResolvedValueOnce(new Map([inboundVideo('first-stream', 2_000, 55)]))
      .mockResolvedValueOnce(new Map([inboundVideo('first-stream', 4_000, 115)]))
      .mockResolvedValueOnce(new Map([inboundVideo('second-stream', 6_000, 120)]));
    attachVideo(getStats);

    await vi.advanceTimersByTimeAsync(6_000);
    expect(record.mock.calls).toEqual(
      [
        { width: 2560, height: 1440, framesDecoded: 55, fps: null },
        { width: 2560, height: 1440, framesDecoded: 115, fps: 30 },
        { width: 2560, height: 1440, framesDecoded: 120, fps: null },
      ].map((sample) => ['native-screen:receiver-sample', undefined, sample]),
    );
    close();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(getStats).toHaveBeenCalledTimes(3);
  });

  it('does not overlap requests or publish a delayed result after close', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Windows');
    const record = vi.spyOn(connectionDiagnostics, 'record');
    const close = stubScreenReceiver();
    let finish!: (value: unknown) => void;
    const getStats = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    attachVideo(getStats);

    await vi.advanceTimersByTimeAsync(6_000);
    expect(getStats).toHaveBeenCalledOnce();
    close();
    finish(new Map([inboundVideo('late', 6_000, 55)]));
    await vi.advanceTimersByTimeAsync(4_000);
    expect(record).not.toHaveBeenCalled();
    expect(getStats).toHaveBeenCalledOnce();
  });

  it.each([
    ['macOS desktop', 'Macintosh', true],
    ['Windows browser', 'Windows', false],
  ])('does not poll statistics on %s', async (_label, userAgent, tauri) => {
    vi.useFakeTimers();
    if (tauri) vi.stubGlobal('__TAURI_INTERNALS__', {});
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(userAgent);
    const getStats = vi.fn(async () => new Map());
    const close = stubScreenReceiver();
    attachVideo(getStats);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(getStats).not.toHaveBeenCalled();
    close();
  });

  it.each(['timeout', 'closed transport'])(
    'restores full-quality compatibility before forwarding after %s',
    async (reason) => {
      vi.useFakeTimers();
      stubWebRtc();
      const source = { id: 'monitor', title: 'Fixture', kind: 'screen' as const };
      let completeCompatibility!: () => void;
      const api = vi.mocked(invoke).mockImplementation(async (command) => {
        if (command === 'windows_screen_sources') return [source];
        if (command === 'windows_screen_start') return 'session';
        if (command === 'windows_screen_offer') return 'preview-sdp';
        if (command === 'windows_screen_require_compatibility')
          return new Promise((_, reject) => {
            completeCompatibility = () => reject(new Error('fixture command unavailable'));
          });
      });
      const started = startNativeWindowsScreen(DEFAULT_VIDEO_PREFERENCES, false, vi.fn());
      await vi.advanceTimersByTimeAsync(0);
      screenPickerStore.snapshot()!.complete({
        ...source,
        includeAudio: false,
        quality: DEFAULT_VIDEO_PREFERENCES,
      });
      await vi.advanceTimersByTimeAsync(0);
      attachVideo(async () => new Map());
      const session = await started;
      const channel = {
        readyState: 'open',
        close: vi.fn(),
        send: vi.fn(),
      } as unknown as RTCDataChannel;
      const onUnsupported = vi.fn();
      try {
        attachNativeScreenSender('viewer', channel, [], onUnsupported);
        if (reason === 'timeout') await vi.advanceTimersByTimeAsync(2_500);
        else channel.onclose?.(new Event('close'));
        expect(channel.close).toHaveBeenCalledOnce();
        expect(api).toHaveBeenCalledWith('windows_screen_require_compatibility', {
          sessionId: 'session',
        });
        expect(onUnsupported).not.toHaveBeenCalled();
        completeCompatibility();
        await vi.advanceTimersByTimeAsync(0);
        expect(onUnsupported).toHaveBeenCalledOnce();
      } finally {
        await session.stop();
      }
    },
  );
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenReceiver, parseSignal } from './windows-screen';

class FakeConnection {
  static instance: FakeConnection;
  signalingState = 'stable';
  remoteDescription: RTCSessionDescriptionInit | null = null;
  onicecandidate: unknown;
  ontrack: unknown;
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
afterEach(() => vi.unstubAllGlobals());
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
});

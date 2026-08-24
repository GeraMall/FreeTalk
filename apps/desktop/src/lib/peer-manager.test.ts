// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PeerManager } from './peer-manager';

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];

  connectionState: RTCPeerConnectionState = 'new';
  signalingState: RTCSignalingState = 'stable';
  remoteDescription: RTCSessionDescription | null = null;
  localDescription: RTCSessionDescription | null = null;
  onconnectionstatechange: ((event: Event) => void) | null = null;
  onicecandidate: RTCPeerConnection['onicecandidate'] = null;
  onnegotiationneeded: RTCPeerConnection['onnegotiationneeded'] = null;
  ontrack: RTCPeerConnection['ontrack'] = null;
  restartIce = vi.fn();
  addIceCandidate = vi.fn(async () => undefined);
  setRemoteDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    this.remoteDescription = description as RTCSessionDescription;
  });
  setLocalDescription = vi.fn(async () => {
    this.localDescription = { type: 'answer', sdp: 'answer-sdp' } as RTCSessionDescription;
  });
  setConfiguration = vi.fn((configuration: RTCConfiguration) => {
    this.configuration = configuration;
  });

  constructor(private configuration: RTCConfiguration) {
    FakePeerConnection.instances.push(this);
  }

  getConfiguration() {
    return this.configuration;
  }

  addTrack() {
    return {
      getParameters: () => ({ encodings: [] }),
      setParameters: () => Promise.resolve(),
    } as unknown as RTCRtpSender;
  }

  getTransceivers() {
    return [];
  }

  close() {
    this.connectionState = 'closed';
    this.signalingState = 'closed';
  }
}

function manager() {
  const stream = { getAudioTracks: () => [] } as unknown as MediaStream;
  return new PeerManager('286d39ef-61af-4aca-84b8-47f78b0f554a', [], stream, vi.fn(), {
    onTrack: vi.fn(),
    onState: vi.fn(),
  });
}

describe('PeerManager ICE recovery', () => {
  beforeEach(() => {
    FakePeerConnection.instances = [];
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
    vi.stubGlobal('RTCRtpReceiver', { getCapabilities: () => ({ codecs: [] }) });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('restarts ICE when short-lived TURN credentials arrive after peer creation', () => {
    const peers = manager();
    peers.ensure('386d39ef-61af-4aca-84b8-47f78b0f554b');
    const connection = FakePeerConnection.instances[0]!;
    const iceServers: RTCIceServer[] = [
      {
        urls: 'turns:turn.example.test:443?transport=tcp',
        username: 'temporary-user',
        credential: 'temporary-password',
      },
    ];

    peers.updateIceServers(iceServers);

    expect(connection.setConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ iceServers }),
    );
    expect(connection.restartIce).toHaveBeenCalledOnce();
  });

  it('does not restart ICE for a repeated identical configuration', () => {
    const peers = manager();
    peers.ensure('386d39ef-61af-4aca-84b8-47f78b0f554b');
    const connection = FakePeerConnection.instances[0]!;

    peers.updateIceServers([]);

    expect(connection.setConfiguration).not.toHaveBeenCalled();
    expect(connection.restartIce).not.toHaveBeenCalled();
  });

  it('limits automatic ICE restarts after a failed connection', () => {
    vi.useFakeTimers();
    const peers = manager();
    peers.ensure('386d39ef-61af-4aca-84b8-47f78b0f554b');
    const connection = FakePeerConnection.instances[0]!;
    connection.connectionState = 'failed';

    for (const delay of [1_000, 3_000, 7_000]) {
      connection.onconnectionstatechange?.(new Event('connectionstatechange'));
      vi.advanceTimersByTime(delay);
    }
    connection.onconnectionstatechange?.(new Event('connectionstatechange'));
    vi.advanceTimersByTime(30_000);

    expect(connection.restartIce).toHaveBeenCalledTimes(3);
  });

  it('queues an ICE candidate until the remote SDP is available', async () => {
    const peers = manager();
    const peerId = '386d39ef-61af-4aca-84b8-47f78b0f554b';
    const candidate = {
      candidate: 'candidate:1 1 udp 1 203.0.113.1 3478 typ relay',
      sdpMid: '0',
      sdpMLineIndex: 0,
    };

    await peers.handle({ type: 'ice-candidate', from: peerId, candidate });
    const connection = FakePeerConnection.instances[0]!;
    expect(connection.addIceCandidate).not.toHaveBeenCalled();

    await peers.handle({
      type: 'offer',
      from: peerId,
      description: { type: 'offer', sdp: 'offer-sdp' },
    });

    expect(connection.setRemoteDescription).toHaveBeenCalledOnce();
    expect(connection.addIceCandidate).toHaveBeenCalledWith(candidate);
    expect(connection.setRemoteDescription.mock.invocationCallOrder[0]).toBeLessThan(
      connection.addIceCandidate.mock.invocationCallOrder[0]!,
    );
  });

  it('ignores a late duplicate answer after the peer is already stable', async () => {
    const peers = manager();
    const peerId = '386d39ef-61af-4aca-84b8-47f78b0f554b';
    peers.ensure(peerId);
    const connection = FakePeerConnection.instances[0]!;
    connection.signalingState = 'stable';

    await expect(
      peers.handle({
        type: 'answer',
        from: peerId,
        description: { type: 'answer', sdp: 'late-answer-sdp' },
      }),
    ).resolves.toBeUndefined();

    expect(connection.setRemoteDescription).not.toHaveBeenCalled();
  });
});

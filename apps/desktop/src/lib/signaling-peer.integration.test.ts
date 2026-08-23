// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@freetalk/protocol';
import { PeerManager } from './peer-manager';
import { SignalingClient } from './signaling-client';

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;

  constructor(readonly url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  send() {}

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new Event('close'));
  }

  receive(message: ServerMessage) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
  }
}

class OrderedPeerConnection {
  static instances: OrderedPeerConnection[] = [];

  connectionState: RTCPeerConnectionState = 'new';
  signalingState: RTCSignalingState = 'stable';
  remoteDescription: RTCSessionDescription | null = null;
  localDescription: RTCSessionDescription | null = null;
  onconnectionstatechange: RTCPeerConnection['onconnectionstatechange'] = null;
  onicecandidate: RTCPeerConnection['onicecandidate'] = null;
  onnegotiationneeded: RTCPeerConnection['onnegotiationneeded'] = null;
  ontrack: RTCPeerConnection['ontrack'] = null;
  readonly operations: string[] = [];

  constructor(private configuration: RTCConfiguration) {
    OrderedPeerConnection.instances.push(this);
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.operations.push('start-setRemoteDescription');
    await Promise.resolve();
    this.remoteDescription = description as RTCSessionDescription;
    this.signalingState = 'have-remote-offer';
    this.operations.push('finish-setRemoteDescription');
  }

  async setLocalDescription() {
    this.operations.push('start-setLocalDescription');
    await Promise.resolve();
    this.localDescription = { type: 'answer', sdp: 'answer-sdp' } as RTCSessionDescription;
    this.signalingState = 'stable';
    this.operations.push('finish-setLocalDescription');
  }

  async addIceCandidate(candidate: RTCIceCandidateInit) {
    this.operations.push(`start-${candidate.candidate}`);
    await Promise.resolve();
    this.operations.push(`finish-${candidate.candidate}`);
  }

  getConfiguration() {
    return this.configuration;
  }

  setConfiguration(configuration: RTCConfiguration) {
    this.configuration = configuration;
  }

  restartIce() {}

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

const selfId = '286d39ef-61af-4aca-84b8-47f78b0f554a';
const peerId = '386d39ef-61af-4aca-84b8-47f78b0f554b';
const join = {
  type: 'create-room' as const,
  roomId: 'ABCDEFGH2345',
  clientId: selfId,
  sessionId: '30c6d4fa-3100-43a1-97e0-4ddc2416493e',
  name: 'Test',
};

function candidate(index: number): Extract<ServerMessage, { type: 'ice-candidate' }> {
  return {
    type: 'ice-candidate',
    from: peerId,
    candidate: {
      candidate: `candidate-${index}`,
      sdpMid: '0',
      sdpMLineIndex: 0,
    },
  };
}

describe('App signaling path integration', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    OrderedPeerConnection.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('RTCPeerConnection', OrderedPeerConnection);
    vi.stubGlobal('RTCRtpReceiver', { getCapabilities: () => ({ codecs: [] }) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serializes offer and every following ICE candidate through SignalingClient and PeerManager', async () => {
    const stream = { getAudioTracks: () => [] } as unknown as MediaStream;
    const peers = new PeerManager(selfId, [], stream, vi.fn(), {
      onTrack: vi.fn(),
      onState: vi.fn(),
    });
    const messageOrder: string[] = [];
    const handleServerMessage = async (message: ServerMessage) => {
      if (message.type !== 'offer' && message.type !== 'answer' && message.type !== 'ice-candidate')
        return;
      const label = message.type === 'ice-candidate' ? message.candidate.candidate : message.type;
      messageOrder.push(`start-${label}`);
      await peers.handle(message);
      messageOrder.push(`finish-${label}`);
    };
    // App passes this Promise-returning callback directly to SignalingClient.
    const client = new SignalingClient('wss://example.test/ws', handleServerMessage, vi.fn());
    client.connect(join);
    const socket = FakeWebSocket.instances[0]!;
    socket.open();

    socket.receive({
      type: 'offer',
      from: peerId,
      description: { type: 'offer', sdp: 'offer-sdp' },
    });
    socket.receive(candidate(1));
    socket.receive(candidate(2));
    socket.receive(candidate(3));
    await vi.waitFor(() => expect(messageOrder).toHaveLength(8));

    expect(messageOrder).toEqual([
      'start-offer',
      'finish-offer',
      'start-candidate-1',
      'finish-candidate-1',
      'start-candidate-2',
      'finish-candidate-2',
      'start-candidate-3',
      'finish-candidate-3',
    ]);
    expect(OrderedPeerConnection.instances[0]!.operations).toEqual([
      'start-setRemoteDescription',
      'finish-setRemoteDescription',
      'start-setLocalDescription',
      'finish-setLocalDescription',
      'start-candidate-1',
      'finish-candidate-1',
      'start-candidate-2',
      'finish-candidate-2',
      'start-candidate-3',
      'finish-candidate-3',
    ]);

    client.close();
    peers.closeAll();
  });
});

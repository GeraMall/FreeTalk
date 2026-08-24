// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@freetalk/protocol';
import { PeerManager } from './peer-manager';

type PeerSignal = Extract<ServerMessage, { type: 'offer' | 'answer' | 'ice-candidate' }> & {
  to: string;
};

class PerfectNegotiationPeerConnection {
  static instances: PerfectNegotiationPeerConnection[] = [];

  connectionState: RTCPeerConnectionState = 'new';
  signalingState: RTCSignalingState = 'stable';
  remoteDescription: RTCSessionDescription | null = null;
  localDescription: RTCSessionDescription | null = null;
  onconnectionstatechange: RTCPeerConnection['onconnectionstatechange'] = null;
  onicecandidate: RTCPeerConnection['onicecandidate'] = null;
  onnegotiationneeded: RTCPeerConnection['onnegotiationneeded'] = null;
  ontrack: RTCPeerConnection['ontrack'] = null;
  ondatachannel: RTCPeerConnection['ondatachannel'] = null;
  readonly operations: string[] = [];

  constructor(private configuration: RTCConfiguration) {
    PerfectNegotiationPeerConnection.instances.push(this);
  }

  async setLocalDescription(description?: RTCLocalSessionDescriptionInit) {
    if (description?.type === 'rollback') {
      if (this.signalingState !== 'have-local-offer') throw new Error('invalid rollback');
      this.operations.push('setLocalDescription:rollback');
      const listener = this.onnegotiationneeded as ((event: Event) => void) | null;
      listener?.(new Event('negotiationneeded'));
      this.localDescription = null;
      this.signalingState = 'stable';
      return;
    }
    const type =
      description?.type ?? (this.signalingState === 'have-remote-offer' ? 'answer' : 'offer');
    if (type === 'offer' && this.signalingState !== 'stable') throw new Error('invalid offer');
    if (type === 'answer' && this.signalingState !== 'have-remote-offer')
      throw new Error('invalid answer');
    this.operations.push(`setLocalDescription:${type}`);
    this.localDescription = {
      type,
      sdp: description?.sdp ?? `${type}-sdp-${this.operations.length}`,
    } as RTCSessionDescription;
    this.signalingState = type === 'offer' ? 'have-local-offer' : 'stable';
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    if (description.type === 'offer' && this.signalingState !== 'stable')
      throw new Error('offer requires rollback');
    if (description.type === 'answer' && this.signalingState !== 'have-local-offer')
      throw new Error('unexpected answer');
    this.operations.push(`setRemoteDescription:${description.type}`);
    this.remoteDescription = description as RTCSessionDescription;
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
  }

  async addIceCandidate() {}

  getConfiguration() {
    return this.configuration;
  }

  setConfiguration(configuration: RTCConfiguration) {
    this.configuration = configuration;
  }

  restartIce() {}

  addTrack(track: MediaStreamTrack) {
    return {
      track,
      replaceTrack: () => Promise.resolve(),
      getParameters: () => ({ encodings: [] }),
      setParameters: () => Promise.resolve(),
    } as unknown as RTCRtpSender;
  }

  createDataChannel() {
    return {
      label: 'freetalk-video-state-v1',
      readyState: 'connecting',
      close: () => undefined,
      send: () => undefined,
      onopen: null,
      onclose: null,
    } as unknown as RTCDataChannel;
  }

  getTransceivers() {
    return [];
  }

  close() {
    this.connectionState = 'closed';
    this.signalingState = 'closed';
  }
}

const peerA = '286d39ef-61af-4aca-84b8-47f78b0f554a';
const peerB = '386d39ef-61af-4aca-84b8-47f78b0f554b';

function incoming(message: PeerSignal) {
  const { to: _to, ...serverMessage } = message;
  void _to;
  return serverMessage;
}

describe('PeerManager perfect negotiation glare resolution', () => {
  beforeEach(() => {
    PerfectNegotiationPeerConnection.instances = [];
    vi.stubGlobal('RTCPeerConnection', PerfectNegotiationPeerConnection);
    vi.stubGlobal('RTCRtpReceiver', { getCapabilities: () => ({ codecs: [] }) });
    vi.stubGlobal(
      'MediaStream',
      class {
        constructor(private readonly tracks: MediaStreamTrack[] = []) {}
        getTracks() {
          return this.tracks;
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['A offer first', 'B offer first', 'simultaneous delivery'] as const)(
    'converges after simultaneous negotiationneeded with %s and survives renegotiation',
    async (deliveryOrder) => {
      const stream = { getAudioTracks: () => [] } as unknown as MediaStream;
      const signals: PeerSignal[] = [];
      const managerA = new PeerManager(peerA, [], stream, (message) => signals.push(message), {
        onTrack: vi.fn(),
        onState: vi.fn(),
      });
      const managerB = new PeerManager(peerB, [], stream, (message) => signals.push(message), {
        onTrack: vi.fn(),
        onState: vi.fn(),
      });
      const connectionA = managerA.ensure(peerB) as unknown as PerfectNegotiationPeerConnection;
      const connectionB = managerB.ensure(peerA) as unknown as PerfectNegotiationPeerConnection;

      const negotiateWithGlare = async () => {
        const fireNegotiationNeeded = (connection: PerfectNegotiationPeerConnection) => {
          const listener = connection.onnegotiationneeded as ((event: Event) => void) | null;
          listener?.(new Event('negotiationneeded'));
        };
        fireNegotiationNeeded(connectionA);
        fireNegotiationNeeded(connectionB);
        await vi.waitFor(() =>
          expect(signals.filter((message) => message.type === 'offer')).toHaveLength(2),
        );
        const offers = signals
          .splice(0)
          .filter(
            (message): message is Extract<PeerSignal, { type: 'offer' }> =>
              message.type === 'offer',
          );
        const offerFromA = offers.find((message) => message.from === peerA)!;
        const offerFromB = offers.find((message) => message.from === peerB)!;
        const deliverA = () => managerB.handle(incoming(offerFromA));
        const deliverB = () => managerA.handle(incoming(offerFromB));
        if (deliveryOrder === 'A offer first') {
          await deliverA();
          await deliverB();
        } else if (deliveryOrder === 'B offer first') {
          await deliverB();
          await deliverA();
        } else {
          await Promise.all([deliverA(), deliverB()]);
        }
        const answers = signals
          .splice(0)
          .filter(
            (message): message is Extract<PeerSignal, { type: 'answer' }> =>
              message.type === 'answer',
          );
        expect(answers).toHaveLength(1);
        expect(answers[0]!.from).toBe(peerB);
        await managerA.handle(incoming(answers[0]!));
        expect(connectionA.signalingState).toBe('stable');
        expect(connectionB.signalingState).toBe('stable');
      };

      await negotiateWithGlare();
      await negotiateWithGlare();

      expect(
        connectionA.operations.filter((operation) => operation === 'setLocalDescription:rollback'),
      ).toHaveLength(0);
      expect(
        connectionB.operations.filter((operation) => operation === 'setLocalDescription:rollback'),
      ).toHaveLength(2);
      expect(
        connectionB.operations.filter((operation) => operation === 'setLocalDescription:answer'),
      ).toHaveLength(2);
      expect(
        connectionA.operations.filter((operation) => operation === 'setRemoteDescription:answer'),
      ).toHaveLength(2);

      managerA.closeAll();
      managerB.closeAll();
    },
  );

  it('resolves glare when A enables camera while B starts screen sharing', async () => {
    const stream = { getAudioTracks: () => [] } as unknown as MediaStream;
    const signals: PeerSignal[] = [];
    const managerA = new PeerManager(peerA, [], stream, (message) => signals.push(message), {
      onTrack: vi.fn(),
      onState: vi.fn(),
    });
    const managerB = new PeerManager(peerB, [], stream, (message) => signals.push(message), {
      onTrack: vi.fn(),
      onState: vi.fn(),
    });
    const connectionA = managerA.ensure(peerB) as unknown as PerfectNegotiationPeerConnection;
    const connectionB = managerB.ensure(peerA) as unknown as PerfectNegotiationPeerConnection;
    const camera = { kind: 'video', id: 'camera' } as MediaStreamTrack;
    const screen = { kind: 'video', id: 'screen' } as MediaStreamTrack;

    await Promise.all([
      managerA.setVideoTrack(camera, 'camera'),
      managerB.setVideoTrack(screen, 'screen'),
    ]);
    const negotiateA = connectionA.onnegotiationneeded as ((event: Event) => void) | null;
    const negotiateB = connectionB.onnegotiationneeded as ((event: Event) => void) | null;
    negotiateA?.(new Event('negotiationneeded'));
    negotiateB?.(new Event('negotiationneeded'));
    await vi.waitFor(() =>
      expect(signals.filter((message) => message.type === 'offer')).toHaveLength(2),
    );

    const offers = signals.splice(0).filter((message) => message.type === 'offer');
    await Promise.all(
      offers.map((message) =>
        message.from === peerA
          ? managerB.handle(incoming(message))
          : managerA.handle(incoming(message)),
      ),
    );
    const answer = signals.find((message) => message.type === 'answer')!;
    await managerA.handle(incoming(answer));

    expect(connectionA.signalingState).toBe('stable');
    expect(connectionB.signalingState).toBe('stable');
    expect(connectionB.operations).toContain('setLocalDescription:rollback');
    expect(connectionB.operations).toContain('setLocalDescription:answer');
  });
});

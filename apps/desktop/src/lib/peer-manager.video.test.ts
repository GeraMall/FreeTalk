// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PeerManager } from './peer-manager';

class FakeSender {
  replaceTrack = vi.fn(async (track: MediaStreamTrack | null) => {
    this.track = track;
  });
  setParameters = vi.fn(async () => undefined);
  constructor(public track: MediaStreamTrack | null) {}
  getParameters() {
    return { encodings: [] } as unknown as RTCRtpSendParameters;
  }
}

class FakeDataChannel {
  label = 'freetalk-video-state-v1';
  readyState: RTCDataChannelState = 'open';
  onopen: RTCDataChannel['onopen'] = null;
  onclose: RTCDataChannel['onclose'] = null;
  onmessage: RTCDataChannel['onmessage'] = null;
  send = vi.fn();
  close = vi.fn();
}

class VideoPeerConnection {
  static instances: VideoPeerConnection[] = [];
  connectionState: RTCPeerConnectionState = 'connected';
  signalingState: RTCSignalingState = 'stable';
  iceConnectionState: RTCIceConnectionState = 'connected';
  iceGatheringState: RTCIceGatheringState = 'complete';
  remoteDescription: RTCSessionDescription | null = null;
  localDescription: RTCSessionDescription | null = null;
  onconnectionstatechange: RTCPeerConnection['onconnectionstatechange'] = null;
  onicecandidate: RTCPeerConnection['onicecandidate'] = null;
  onicegatheringstatechange: RTCPeerConnection['onicegatheringstatechange'] = null;
  onicecandidateerror: RTCPeerConnection['onicecandidateerror'] = null;
  oniceconnectionstatechange: RTCPeerConnection['oniceconnectionstatechange'] = null;
  onnegotiationneeded: RTCPeerConnection['onnegotiationneeded'] = null;
  ontrack: RTCPeerConnection['ontrack'] = null;
  ondatachannel: RTCPeerConnection['ondatachannel'] = null;
  readonly senders: FakeSender[] = [];
  readonly channels: FakeDataChannel[] = [];

  constructor(private configuration: RTCConfiguration) {
    VideoPeerConnection.instances.push(this);
  }
  addTrack(track: MediaStreamTrack) {
    const sender = new FakeSender(track);
    this.senders.push(sender);
    return sender as unknown as RTCRtpSender;
  }
  getSenders() {
    return this.senders as unknown as RTCRtpSender[];
  }
  createDataChannel() {
    const channel = new FakeDataChannel();
    this.channels.push(channel);
    return channel as unknown as RTCDataChannel;
  }
  getTransceivers() {
    return [];
  }
  getConfiguration() {
    return this.configuration;
  }
  setConfiguration(configuration: RTCConfiguration) {
    this.configuration = configuration;
  }
  async setLocalDescription() {}
  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = description as RTCSessionDescription;
  }
  async addIceCandidate() {}
  restartIce() {}
  async getStats() {
    return new Map();
  }
  close() {
    this.connectionState = 'closed';
    this.signalingState = 'closed';
  }
}

function track(kind: 'audio' | 'video', id: string) {
  return {
    kind,
    id,
    getSettings: () => ({}),
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
}

class FakeStream {
  constructor(private readonly tracks: MediaStreamTrack[]) {}
  getAudioTracks() {
    return this.tracks.filter((item) => item.kind === 'audio');
  }
  getTracks() {
    return this.tracks;
  }
}

describe('PeerManager video sender lifecycle', () => {
  beforeEach(() => {
    VideoPeerConnection.instances = [];
    vi.stubGlobal('RTCPeerConnection', VideoPeerConnection);
    vi.stubGlobal('RTCRtpReceiver', { getCapabilities: () => ({ codecs: [] }) });
    vi.stubGlobal('MediaStream', FakeStream);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('preserves audio and reuses exactly one video sender across repeated toggles', async () => {
    const audio = track('audio', 'audio');
    const manager = new PeerManager(
      '286d39ef-61af-4aca-84b8-47f78b0f554a',
      [],
      new FakeStream([audio]) as unknown as MediaStream,
      vi.fn(),
      { onTrack: vi.fn(), onState: vi.fn() },
    );
    manager.ensure('386d39ef-61af-4aca-84b8-47f78b0f554b');
    const connection = VideoPeerConnection.instances[0]!;

    for (let index = 0; index < 5; index += 1) {
      await manager.setVideoTrack(track('video', `camera-${index}`), 'camera');
      await manager.setVideoTrack(null, 'none');
    }

    expect(connection.senders.filter((sender) => sender.track?.kind === 'audio')).toHaveLength(1);
    expect(connection.senders).toHaveLength(2);
    expect(connection.channels).toHaveLength(1);
    expect(connection.senders[1]!.replaceTrack).toHaveBeenCalledTimes(9);
    expect(connection.signalingState).toBe('stable');
  });

  it('adds the current screen source to a participant joining later', async () => {
    const manager = new PeerManager(
      '286d39ef-61af-4aca-84b8-47f78b0f554a',
      [],
      new FakeStream([]) as unknown as MediaStream,
      vi.fn(),
      { onTrack: vi.fn(), onState: vi.fn() },
    );
    const screen = track('video', 'screen');
    await manager.setVideoTrack(screen, 'screen');
    manager.ensure('386d39ef-61af-4aca-84b8-47f78b0f554b');

    expect(VideoPeerConnection.instances[0]!.senders[0]!.track).toBe(screen);
    expect(VideoPeerConnection.instances[0]!.channels).toHaveLength(1);
  });

  it('reports remote video tracks and validated camera/screen state metadata', () => {
    const onVideoTrack = vi.fn();
    const onVideoState = vi.fn();
    const manager = new PeerManager(
      '286d39ef-61af-4aca-84b8-47f78b0f554a',
      [],
      new FakeStream([]) as unknown as MediaStream,
      vi.fn(),
      { onTrack: vi.fn(), onState: vi.fn(), onVideoTrack, onVideoState },
    );
    manager.ensure('386d39ef-61af-4aca-84b8-47f78b0f554b');
    const connection = VideoPeerConnection.instances[0]!;
    const video = track('video', 'remote-video');
    const stream = new FakeStream([video]) as unknown as MediaStream;

    const onTrack = connection.ontrack as ((event: RTCTrackEvent) => void) | null;
    onTrack?.({ track: video, streams: [stream] } as unknown as RTCTrackEvent);
    const channel = new FakeDataChannel();
    const onDataChannel = connection.ondatachannel as ((event: RTCDataChannelEvent) => void) | null;
    onDataChannel?.({ channel } as unknown as RTCDataChannelEvent);
    const onMessage = channel.onmessage as ((event: MessageEvent) => void) | null;
    onMessage?.({ data: JSON.stringify({ source: 'screen' }) } as MessageEvent);
    onMessage?.({ data: JSON.stringify({ source: 'none' }) } as MessageEvent);

    expect(onVideoTrack).toHaveBeenCalledWith(expect.any(String), stream, video);
    expect(onVideoState.mock.calls.map((call) => call[1])).toEqual(['screen', 'none']);
  });
});

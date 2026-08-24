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
  readonly transceivers: Array<{ mid: string; sender: FakeSender }> = [];
  readonly channels: FakeDataChannel[] = [];

  constructor(private configuration: RTCConfiguration) {
    VideoPeerConnection.instances.push(this);
  }
  addTrack(track: MediaStreamTrack) {
    const sender = new FakeSender(track);
    this.senders.push(sender);
    return sender as unknown as RTCRtpSender;
  }
  addTransceiver(track: MediaStreamTrack) {
    const sender = new FakeSender(track);
    const transceiver = { mid: `video-${this.transceivers.length}`, sender };
    this.senders.push(sender);
    this.transceivers.push(transceiver);
    return transceiver as unknown as RTCRtpTransceiver;
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
    return this.transceivers as unknown as RTCRtpTransceiver[];
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
  readonly id = crypto.randomUUID();
  constructor(private readonly tracks: MediaStreamTrack[]) {}
  getAudioTracks() {
    return this.tracks.filter((item) => item.kind === 'audio');
  }
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks.filter((item) => item.kind === 'video');
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

  it('preserves audio and reuses one camera transceiver across repeated toggles', async () => {
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
      await manager.setVideoTrack(null, 'camera');
    }

    expect(connection.senders.filter((sender) => sender.track?.kind === 'audio')).toHaveLength(1);
    expect(connection.senders).toHaveLength(2);
    expect(connection.channels).toHaveLength(1);
    expect(connection.senders[1]!.replaceTrack).toHaveBeenCalledTimes(9);
    expect(connection.signalingState).toBe('stable');
  });

  it('keeps independent camera and screen senders active simultaneously', async () => {
    const manager = new PeerManager(
      '286d39ef-61af-4aca-84b8-47f78b0f554a',
      [],
      new FakeStream([]) as unknown as MediaStream,
      vi.fn(),
      { onTrack: vi.fn(), onState: vi.fn() },
    );
    manager.ensure('386d39ef-61af-4aca-84b8-47f78b0f554b');
    const camera = track('video', 'camera');
    const screen = track('video', 'screen');

    await manager.setVideoTrack(camera, 'camera');
    await manager.setVideoTrack(screen, 'screen');
    const connection = VideoPeerConnection.instances[0]!;
    expect(connection.transceivers).toHaveLength(2);
    expect(connection.transceivers.map(({ sender }) => sender.track)).toEqual([camera, screen]);
    expect(connection.transceivers[0]!.sender.setParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        degradationPreference: 'maintain-framerate',
        encodings: [
          expect.objectContaining({
            maxBitrate: 3_500_000,
            maxFramerate: 60,
            priority: 'medium',
          }),
        ],
      }),
    );
    expect(connection.transceivers[1]!.sender.setParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        degradationPreference: 'maintain-resolution',
        encodings: [expect.objectContaining({ maxFramerate: 30, priority: 'low' })],
      }),
    );

    for (let index = 0; index < 5; index += 1) {
      await manager.setVideoTrack(null, 'screen');
      expect(connection.transceivers[0]!.sender.track).toBe(camera);
      expect(connection.transceivers[1]!.sender.track).toBeNull();
      await manager.setVideoTrack(track('video', `screen-${index}`), 'screen');
    }
    expect(connection.transceivers).toHaveLength(2);
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

  it('sends captured system audio in the same screen stream and reuses its sender', async () => {
    const manager = new PeerManager(
      '286d39ef-61af-4aca-84b8-47f78b0f554a',
      [],
      new FakeStream([]) as unknown as MediaStream,
      vi.fn(),
      { onTrack: vi.fn(), onState: vi.fn() },
    );
    manager.ensure('386d39ef-61af-4aca-84b8-47f78b0f554b');
    const screen = track('video', 'screen');
    const systemAudio = track('audio', 'system-audio');
    const screenStream = new FakeStream([screen, systemAudio]) as unknown as MediaStream;

    await manager.setVideoTrack(screen, 'screen', screenStream);
    const connection = VideoPeerConnection.instances[0]!;
    expect(connection.transceivers.map(({ sender }) => sender.track)).toEqual([
      screen,
      systemAudio,
    ]);
    expect(connection.transceivers[1]!.sender.setParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        encodings: [expect.objectContaining({ maxBitrate: 160_000, priority: 'medium' })],
      }),
    );

    await manager.setVideoTrack(null, 'screen');
    expect(connection.transceivers[0]!.sender.track).toBeNull();
    expect(connection.transceivers[1]!.sender.track).toBeNull();
  });

  it('does not replace the voice stream when remote screen audio arrives', () => {
    const onTrack = vi.fn();
    const manager = new PeerManager(
      '286d39ef-61af-4aca-84b8-47f78b0f554a',
      [],
      new FakeStream([]) as unknown as MediaStream,
      vi.fn(),
      { onTrack, onState: vi.fn() },
    );
    manager.ensure('386d39ef-61af-4aca-84b8-47f78b0f554b');
    const connection = VideoPeerConnection.instances[0]!;
    const screen = track('video', 'remote-screen');
    const systemAudio = track('audio', 'remote-system-audio');
    const screenStream = new FakeStream([screen, systemAudio]) as unknown as MediaStream;

    const onRemoteTrack = connection.ontrack as ((event: RTCTrackEvent) => void) | null;
    onRemoteTrack?.({
      track: systemAudio,
      streams: [screenStream],
      transceiver: { mid: 'screen-audio' },
    } as unknown as RTCTrackEvent);

    expect(onTrack).not.toHaveBeenCalled();
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
    const camera = track('video', 'remote-camera');
    const screen = track('video', 'remote-screen');
    const cameraStream = new FakeStream([camera]) as unknown as MediaStream;
    const screenStream = new FakeStream([screen]) as unknown as MediaStream;

    const onTrack = connection.ontrack as ((event: RTCTrackEvent) => void) | null;
    onTrack?.({
      track: camera,
      streams: [cameraStream],
      transceiver: { mid: 'remote-camera' },
    } as unknown as RTCTrackEvent);
    onTrack?.({
      track: screen,
      streams: [screenStream],
      transceiver: { mid: 'remote-screen' },
    } as unknown as RTCTrackEvent);
    const channel = new FakeDataChannel();
    const onDataChannel = connection.ondatachannel as ((event: RTCDataChannelEvent) => void) | null;
    onDataChannel?.({ channel } as unknown as RTCDataChannelEvent);
    const onMessage = channel.onmessage as ((event: MessageEvent) => void) | null;
    onMessage?.({
      data: JSON.stringify({
        version: 2,
        sources: {
          camera: { active: true, mid: 'remote-camera', trackId: 'remote-camera' },
          screen: { active: true, mid: 'remote-screen', trackId: 'remote-screen' },
        },
      }),
    } as MessageEvent);

    expect(onVideoTrack).toHaveBeenCalledWith(expect.any(String), 'camera', cameraStream, camera);
    expect(onVideoTrack).toHaveBeenCalledWith(expect.any(String), 'screen', screenStream, screen);
    expect(onVideoState).toHaveBeenCalledWith(expect.any(String), 'camera', true);
    expect(onVideoState).toHaveBeenCalledWith(expect.any(String), 'screen', true);
  });
});

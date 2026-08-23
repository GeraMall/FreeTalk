import type { ServerMessage } from '@freetalk/protocol';

interface PeerContext {
  connection: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  settingRemoteAnswer: boolean;
  candidates: Set<string>;
  disconnectTimer?: number;
}

export interface PeerEvents {
  onTrack(peerId: string, stream: MediaStream): void;
  onState(peerId: string, state: RTCPeerConnectionState): void;
}

export class PeerManager {
  private readonly peers = new Map<string, PeerContext>();

  constructor(
    private readonly selfId: string,
    private iceServers: RTCIceServer[],
    private readonly localStream: MediaStream,
    private readonly signal: (
      message: Extract<ServerMessage, { type: 'offer' | 'answer' | 'ice-candidate' }> & {
        to: string;
      },
    ) => void,
    private readonly events: PeerEvents,
  ) {}

  ensure(peerId: string) {
    if (this.peers.has(peerId)) return this.peers.get(peerId)!.connection;
    const connection = new RTCPeerConnection({
      iceServers: this.iceServers,
      bundlePolicy: 'max-bundle',
    });
    const context: PeerContext = {
      connection,
      polite: this.selfId.localeCompare(peerId) > 0,
      makingOffer: false,
      ignoreOffer: false,
      settingRemoteAnswer: false,
      candidates: new Set(),
    };
    this.peers.set(peerId, context);

    for (const track of this.localStream.getAudioTracks()) {
      const sender = connection.addTrack(track, this.localStream);
      void sender.getParameters().encodings?.length;
      const parameters = sender.getParameters();
      if (!parameters.encodings) parameters.encodings = [{}];
      parameters.encodings[0].maxBitrate = 64_000;
      void sender.setParameters(parameters).catch(() => undefined);
    }
    const transceiver = connection
      .getTransceivers()
      .find((item) => item.sender.track?.kind === 'audio');
    const opus = RTCRtpReceiver.getCapabilities?.('audio')?.codecs.filter(
      (codec) => codec.mimeType.toLowerCase() === 'audio/opus',
    );
    if (transceiver?.setCodecPreferences && opus?.length) transceiver.setCodecPreferences(opus);

    connection.onicecandidate = ({ candidate }) => {
      if (candidate)
        this.signal({
          type: 'ice-candidate',
          from: this.selfId,
          to: peerId,
          candidate: {
            candidate: candidate.candidate,
            sdpMid: candidate.sdpMid,
            sdpMLineIndex: candidate.sdpMLineIndex,
            usernameFragment: candidate.usernameFragment,
          },
        });
    };
    connection.ontrack = ({ streams, track }) => {
      const stream = streams[0] ?? new MediaStream([track]);
      this.events.onTrack(peerId, stream);
    };
    connection.onconnectionstatechange = () => {
      this.events.onState(peerId, connection.connectionState);
      if (connection.connectionState === 'disconnected') {
        context.disconnectTimer = window.setTimeout(() => {
          if (connection.connectionState === 'disconnected') connection.restartIce();
        }, 3_000);
      } else if (context.disconnectTimer) window.clearTimeout(context.disconnectTimer);
    };
    connection.onnegotiationneeded = async () => {
      try {
        context.makingOffer = true;
        await connection.setLocalDescription();
        if (connection.localDescription?.type === 'offer') {
          this.signal({
            type: 'offer',
            from: this.selfId,
            to: peerId,
            description: { type: 'offer', sdp: connection.localDescription.sdp },
          });
        }
      } catch {
        this.events.onState(peerId, 'failed');
      } finally {
        context.makingOffer = false;
      }
    };
    return connection;
  }

  async handle(message: Extract<ServerMessage, { type: 'offer' | 'answer' | 'ice-candidate' }>) {
    const context =
      this.peers.get(message.from) ?? (this.ensure(message.from), this.peers.get(message.from)!);
    const connection = context.connection;
    if (message.type === 'ice-candidate') {
      const key = JSON.stringify(message.candidate);
      if (context.candidates.has(key)) return;
      context.candidates.add(key);
      try {
        await connection.addIceCandidate(message.candidate);
      } catch (error) {
        if (!context.ignoreOffer) throw error;
      }
      return;
    }

    const isOffer = message.description.type === 'offer';
    const readyForOffer =
      !context.makingOffer &&
      (connection.signalingState === 'stable' || context.settingRemoteAnswer);
    const collision = isOffer && !readyForOffer;
    context.ignoreOffer = !context.polite && collision;
    if (context.ignoreOffer) return;
    context.settingRemoteAnswer = message.description.type === 'answer';
    await connection.setRemoteDescription(message.description);
    context.settingRemoteAnswer = false;
    if (isOffer) {
      await connection.setLocalDescription();
      if (connection.localDescription?.type === 'answer') {
        this.signal({
          type: 'answer',
          from: this.selfId,
          to: message.from,
          description: { type: 'answer', sdp: connection.localDescription.sdp },
        });
      }
    }
  }

  async replaceAudioTrack(track: MediaStreamTrack) {
    await Promise.all(
      [...this.peers.values()].map(async ({ connection }) => {
        const sender = connection.getSenders().find((item) => item.track?.kind === 'audio');
        if (sender) await sender.replaceTrack(track);
      }),
    );
  }

  updateIceServers(iceServers: RTCIceServer[]) {
    this.iceServers = iceServers;
    for (const { connection } of this.peers.values()) {
      connection.setConfiguration({ ...connection.getConfiguration(), iceServers });
    }
  }

  remove(peerId: string) {
    const context = this.peers.get(peerId);
    if (!context) return;
    if (context.disconnectTimer) window.clearTimeout(context.disconnectTimer);
    context.connection.close();
    this.peers.delete(peerId);
  }

  closeAll() {
    for (const peerId of [...this.peers.keys()]) this.remove(peerId);
  }
}

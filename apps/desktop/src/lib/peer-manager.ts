import type { ServerMessage } from '@freetalk/protocol';

interface PeerContext {
  connection: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  settingRemoteAnswer: boolean;
  candidates: Set<string>;
  pendingCandidates: RTCIceCandidateInit[];
  operationQueue: Promise<void>;
  disconnectTimer?: number;
  iceRestartAttempts: number;
}

const ICE_RESTART_DELAYS_MS = [1_000, 3_000, 7_000] as const;

export interface PeerEvents {
  onTrack(peerId: string, stream: MediaStream): void;
  onState(peerId: string, state: RTCPeerConnectionState): void;
}

interface NegotiationDiagnosticTarget {
  __FREETALK_NEGOTIATION_LOG__?: (entry: {
    peerId: string;
    event: string;
    signalingState: RTCSignalingState;
  }) => void;
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
      pendingCandidates: [],
      operationQueue: Promise.resolve(),
      iceRestartAttempts: 0,
    };
    this.peers.set(peerId, context);
    this.trace(peerId, context.polite ? 'role:polite' : 'role:impolite', connection);

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
      if (connection.connectionState === 'connected') {
        context.iceRestartAttempts = 0;
        this.clearDisconnectTimer(context);
      } else if (
        connection.connectionState === 'disconnected' ||
        connection.connectionState === 'failed'
      ) {
        this.scheduleIceRestart(context);
      } else if (connection.connectionState === 'closed') {
        this.clearDisconnectTimer(context);
      }
    };
    connection.onnegotiationneeded = () => {
      this.trace(peerId, 'negotiationneeded', connection);
      if (connection.signalingState !== 'stable') {
        this.trace(peerId, 'offer-skipped:not-stable', connection);
        return;
      }
      void this.enqueue(context, async () => {
        if (connection.signalingState !== 'stable') {
          this.trace(peerId, 'offer-skipped:not-stable', connection);
          return;
        }
        try {
          context.makingOffer = true;
          this.trace(peerId, 'create-offer', connection);
          await connection.setLocalDescription();
          if (connection.localDescription?.type === 'offer') {
            this.trace(peerId, 'set-local-offer', connection);
            this.signal({
              type: 'offer',
              from: this.selfId,
              to: peerId,
              description: { type: 'offer', sdp: connection.localDescription.sdp },
            });
          }
        } finally {
          context.makingOffer = false;
        }
      }).catch(() => this.events.onState(peerId, 'failed'));
    };
    return connection;
  }

  async handle(message: Extract<ServerMessage, { type: 'offer' | 'answer' | 'ice-candidate' }>) {
    const context =
      this.peers.get(message.from) ?? (this.ensure(message.from), this.peers.get(message.from)!);
    await this.enqueue(context, () => this.handlePeerMessage(context, message));
  }

  private async handlePeerMessage(
    context: PeerContext,
    message: Extract<ServerMessage, { type: 'offer' | 'answer' | 'ice-candidate' }>,
  ) {
    const connection = context.connection;
    if (message.type === 'ice-candidate') {
      const key = JSON.stringify(message.candidate);
      if (context.candidates.has(key)) return;
      context.candidates.add(key);
      if (!connection.remoteDescription) {
        if (context.pendingCandidates.length >= 256) context.pendingCandidates.shift();
        context.pendingCandidates.push(message.candidate);
        return;
      }
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
    if (collision) this.trace(message.from, 'collision-detected', connection);
    context.ignoreOffer = !context.polite && collision;
    if (context.ignoreOffer) {
      this.trace(message.from, 'impolite:ignore-offer', connection);
      return;
    }
    if (isOffer && collision && connection.signalingState !== 'stable') {
      this.trace(message.from, 'polite:rollback', connection);
      await connection.setLocalDescription({ type: 'rollback' });
    }
    if (message.description.type === 'answer')
      this.trace(message.from, 'answer-received', connection);
    context.settingRemoteAnswer = message.description.type === 'answer';
    try {
      await connection.setRemoteDescription(message.description);
      this.trace(message.from, `set-remote-${message.description.type}`, connection);
    } finally {
      context.settingRemoteAnswer = false;
    }
    await this.flushPendingCandidates(context);
    if (isOffer) {
      this.trace(message.from, 'create-answer', connection);
      await connection.setLocalDescription();
      if (connection.localDescription?.type === 'answer') {
        this.trace(message.from, 'set-local-answer', connection);
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
    if (JSON.stringify(this.iceServers) === JSON.stringify(iceServers)) return;
    this.iceServers = iceServers;
    for (const context of this.peers.values()) {
      const { connection } = context;
      if (connection.signalingState === 'closed') continue;
      connection.setConfiguration({ ...connection.getConfiguration(), iceServers });
      context.iceRestartAttempts = 0;
      this.clearDisconnectTimer(context);
      // The signaling server intentionally issues short-lived TURN credentials
      // only after the participant joins. Restart gathering so connections that
      // already started with STUN can immediately discover relay candidates.
      connection.restartIce();
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

  private scheduleIceRestart(context: PeerContext) {
    if (
      context.disconnectTimer ||
      context.iceRestartAttempts >= ICE_RESTART_DELAYS_MS.length ||
      context.connection.signalingState === 'closed'
    )
      return;
    const delay = ICE_RESTART_DELAYS_MS[context.iceRestartAttempts]!;
    context.disconnectTimer = window.setTimeout(() => {
      context.disconnectTimer = undefined;
      if (
        context.connection.connectionState !== 'disconnected' &&
        context.connection.connectionState !== 'failed'
      )
        return;
      context.iceRestartAttempts += 1;
      try {
        context.connection.restartIce();
      } catch {
        /* the peer may have closed between the state event and this timer */
      }
    }, delay);
  }

  private clearDisconnectTimer(context: PeerContext) {
    if (!context.disconnectTimer) return;
    window.clearTimeout(context.disconnectTimer);
    context.disconnectTimer = undefined;
  }

  private enqueue(context: PeerContext, operation: () => Promise<void>) {
    const pending = context.operationQueue.then(operation);
    context.operationQueue = pending.catch(() => undefined);
    return pending;
  }

  private trace(peerId: string, event: string, connection: RTCPeerConnection) {
    const target = globalThis as typeof globalThis & NegotiationDiagnosticTarget;
    target.__FREETALK_NEGOTIATION_LOG__?.({
      peerId,
      event,
      signalingState: connection.signalingState,
    });
  }

  private async flushPendingCandidates(context: PeerContext) {
    const pending = context.pendingCandidates.splice(0);
    for (const candidate of pending) {
      try {
        await context.connection.addIceCandidate(candidate);
      } catch {
        // A queued candidate can belong to an offer ignored during glare. Later
        // candidates for the accepted description will still be applied.
      }
    }
  }
}

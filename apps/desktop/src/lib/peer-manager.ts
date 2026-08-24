import type { ServerMessage } from '@freetalk/protocol';
import { connectionDiagnostics } from './connection-diagnostics';
import type { LocalVideoSource } from './video-manager';

const VIDEO_STATE_CHANNEL = 'freetalk-video-state-v1';

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
  diagnosticTimer?: number;
  diagnosticStartedAt: number;
  firstCandidateTypes: Set<string>;
  firstConnectivityCheckRecorded: boolean;
  selectedPairRecorded: boolean;
  firstInboundRtpRecorded: boolean;
  firstInboundVideoRecorded: boolean;
  firstOutboundVideoRecorded: boolean;
  videoSender?: RTCRtpSender;
  videoStateChannel?: RTCDataChannel;
  remoteVideoStateChannel?: RTCDataChannel;
  remoteVideoActive: boolean;
}

const ICE_RESTART_DELAYS_MS = [1_000, 3_000, 7_000] as const;

export interface PeerEvents {
  onTrack(peerId: string, stream: MediaStream): void;
  onVideoTrack?(peerId: string, stream: MediaStream, track: MediaStreamTrack): void;
  onVideoState?(peerId: string, source: LocalVideoSource): void;
  onState(peerId: string, state: RTCPeerConnectionState): void;
}

interface NegotiationDiagnosticTarget {
  __FREETALK_NEGOTIATION_LOG__?: (entry: {
    peerId: string;
    event: string;
    signalingState: RTCSignalingState;
  }) => void;
}

interface CandidatePairStats extends RTCStats {
  localCandidateId?: string;
  remoteCandidateId?: string;
  state?: string;
  nominated?: boolean;
  requestsSent?: number;
}

export class PeerManager {
  private readonly peers = new Map<string, PeerContext>();
  private localVideoTrack: MediaStreamTrack | null = null;
  private localVideoSource: LocalVideoSource = 'none';

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
      diagnosticStartedAt: performance.now(),
      firstCandidateTypes: new Set(),
      firstConnectivityCheckRecorded: false,
      selectedPairRecorded: false,
      firstInboundRtpRecorded: false,
      firstInboundVideoRecorded: false,
      firstOutboundVideoRecorded: false,
      remoteVideoActive: false,
    };
    this.peers.set(peerId, context);
    connectionDiagnostics.record('peer-created', peerId, {
      polite: context.polite,
      icePolicy: connection.getConfiguration().iceTransportPolicy ?? 'all',
      iceServers: this.iceServers.length,
    });
    this.trace(peerId, context.polite ? 'role:polite' : 'role:impolite', connection);

    for (const track of this.localStream.getAudioTracks()) {
      connectionDiagnostics.record('add-track:start', peerId, { kind: track.kind });
      const sender = connection.addTrack(track, this.localStream);
      connectionDiagnostics.record('add-track:end', peerId, { kind: track.kind });
      void sender.getParameters().encodings?.length;
      const parameters = sender.getParameters();
      if (!parameters.encodings?.length) parameters.encodings = [{}];
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

    if (this.localVideoTrack) {
      context.videoSender = connection.addTrack(
        this.localVideoTrack,
        new MediaStream([this.localVideoTrack]),
      );
      this.configureVideoSender(context.videoSender, this.localVideoSource);
      this.ensureVideoStateChannel(peerId, context);
    }

    connection.onicecandidate = ({ candidate }) => {
      if (candidate) {
        const type = candidate.type ?? this.candidateType(candidate.candidate);
        if (type && !context.firstCandidateTypes.has(type)) {
          context.firstCandidateTypes.add(type);
          connectionDiagnostics.record(`first-${type}-candidate`, peerId, {
            protocol: candidate.protocol ?? 'unknown',
            relayProtocol:
              (candidate as RTCIceCandidate & { relayProtocol?: string }).relayProtocol ?? 'none',
          });
        }
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
      } else {
        connectionDiagnostics.record('ice-candidates:end', peerId);
      }
    };
    connection.onicegatheringstatechange = () =>
      connectionDiagnostics.record(`ice-gathering:${connection.iceGatheringState}`, peerId);
    connection.onicecandidateerror = (event) =>
      connectionDiagnostics.record('ice-candidate-error', peerId, {
        errorCode: event.errorCode,
        errorText: event.errorText,
      });
    connection.oniceconnectionstatechange = () => {
      connectionDiagnostics.record(`ice-connection:${connection.iceConnectionState}`, peerId);
      if (connection.iceConnectionState === 'checking' && !context.firstConnectivityCheckRecorded) {
        context.firstConnectivityCheckRecorded = true;
        connectionDiagnostics.record('first-connectivity-check', peerId);
      }
      void this.pollConnectionStats(peerId, context);
    };
    connection.ontrack = ({ streams, track }) => {
      connectionDiagnostics.record('remote-track', peerId, { kind: track.kind });
      const stream = streams[0] ?? new MediaStream([track]);
      if (track.kind === 'video') {
        connectionDiagnostics.record('video-ontrack-fired', peerId);
        track.onended = () => {
          context.remoteVideoActive = false;
          connectionDiagnostics.record('remote-video-track:ended', peerId);
          this.events.onVideoState?.(peerId, 'none');
        };
        this.events.onVideoTrack?.(peerId, stream, track);
        context.remoteVideoActive = true;
        this.startDiagnosticTimer(peerId, context);
      } else {
        this.events.onTrack(peerId, stream);
      }
    };
    connection.ondatachannel = ({ channel }) => {
      if (channel.label !== VIDEO_STATE_CHANNEL) return;
      context.remoteVideoStateChannel?.close();
      context.remoteVideoStateChannel = channel;
      channel.onmessage = ({ data }) => this.handleVideoStateMessage(peerId, context, data);
    };
    connection.onconnectionstatechange = () => {
      connectionDiagnostics.record(`connection:${connection.connectionState}`, peerId);
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
      connectionDiagnostics.record('negotiationneeded', peerId, {
        signalingState: connection.signalingState,
      });
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
          connectionDiagnostics.record('create-offer:start', peerId, { implicit: true });
          connectionDiagnostics.record('set-local-description:start', peerId, { type: 'offer' });
          await connection.setLocalDescription();
          connectionDiagnostics.record('create-offer:end', peerId, { implicit: true });
          connectionDiagnostics.record('set-local-description:end', peerId, {
            type: connection.localDescription?.type ?? 'unknown',
          });
          if (connection.localDescription?.type === 'offer') {
            this.trace(peerId, 'set-local-offer', connection);
            this.signal({
              type: 'offer',
              from: this.selfId,
              to: peerId,
              description: { type: 'offer', sdp: connection.localDescription.sdp },
            });
            connectionDiagnostics.record('offer-sent', peerId);
          }
        } finally {
          context.makingOffer = false;
        }
      }).catch(() => this.events.onState(peerId, 'failed'));
    };
    this.startDiagnosticTimer(peerId, context);
    return connection;
  }

  async handle(message: Extract<ServerMessage, { type: 'offer' | 'answer' | 'ice-candidate' }>) {
    const context =
      this.peers.get(message.from) ?? (this.ensure(message.from), this.peers.get(message.from)!);
    connectionDiagnostics.record(`${message.type}-received`, message.from);
    try {
      await this.enqueue(context, () => this.handlePeerMessage(context, message));
    } catch (error) {
      connectionDiagnostics.record('peer-message:error', message.from, {
        messageType: message.type,
        errorName: error instanceof DOMException ? error.name : 'unknown',
        signalingState: context.connection.signalingState,
        hasRemoteDescription: Boolean(context.connection.remoteDescription),
      });
      throw error;
    }
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
        connectionDiagnostics.record('ice-candidate:queued', message.from, {
          pending: context.pendingCandidates.length,
        });
        return;
      }
      try {
        connectionDiagnostics.record('add-ice-candidate:start', message.from);
        await connection.addIceCandidate(message.candidate);
        connectionDiagnostics.record('add-ice-candidate:end', message.from);
      } catch (error) {
        if (!context.ignoreOffer) throw error;
      }
      return;
    }

    if (message.description.type === 'answer' && connection.signalingState !== 'have-local-offer') {
      this.trace(message.from, 'answer-ignored:unexpected-state', connection);
      connectionDiagnostics.record('answer-ignored:unexpected-state', message.from, {
        signalingState: connection.signalingState,
      });
      return;
    }

    const isOffer = message.description.type === 'offer';
    const readyForOffer =
      !context.makingOffer &&
      (connection.signalingState === 'stable' || context.settingRemoteAnswer);
    const collision = isOffer && !readyForOffer;
    if (collision) this.trace(message.from, 'collision-detected', connection);
    if (collision)
      connectionDiagnostics.record('offer-collision', message.from, {
        polite: context.polite,
        signalingState: connection.signalingState,
      });
    context.ignoreOffer = !context.polite && collision;
    if (context.ignoreOffer) {
      this.trace(message.from, 'impolite:ignore-offer', connection);
      return;
    }
    if (isOffer && collision && connection.signalingState !== 'stable') {
      this.trace(message.from, 'polite:rollback', connection);
      connectionDiagnostics.record('rollback:start', message.from);
      await connection.setLocalDescription({ type: 'rollback' });
      connectionDiagnostics.record('rollback:end', message.from);
    }
    if (message.description.type === 'answer')
      this.trace(message.from, 'answer-received', connection);
    context.settingRemoteAnswer = message.description.type === 'answer';
    try {
      connectionDiagnostics.record('set-remote-description:start', message.from, {
        type: message.description.type,
      });
      await connection.setRemoteDescription(message.description);
      connectionDiagnostics.record('set-remote-description:end', message.from, {
        type: message.description.type,
      });
      this.trace(message.from, `set-remote-${message.description.type}`, connection);
    } finally {
      context.settingRemoteAnswer = false;
    }
    await this.flushPendingCandidates(context);
    if (isOffer) {
      this.trace(message.from, 'create-answer', connection);
      connectionDiagnostics.record('create-answer:start', message.from, { implicit: true });
      connectionDiagnostics.record('set-local-description:start', message.from, { type: 'answer' });
      await connection.setLocalDescription();
      connectionDiagnostics.record('create-answer:end', message.from, { implicit: true });
      connectionDiagnostics.record('set-local-description:end', message.from, {
        type: connection.localDescription?.type ?? 'unknown',
      });
      if (connection.localDescription?.type === 'answer') {
        this.trace(message.from, 'set-local-answer', connection);
        this.signal({
          type: 'answer',
          from: this.selfId,
          to: message.from,
          description: { type: 'answer', sdp: connection.localDescription.sdp },
        });
        connectionDiagnostics.record('answer-sent', message.from);
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

  async setVideoTrack(track: MediaStreamTrack | null, source: LocalVideoSource) {
    this.localVideoTrack = track;
    this.localVideoSource = source;
    connectionDiagnostics.record('local-video-source', undefined, { source });
    await Promise.all(
      [...this.peers.entries()].map(([peerId, context]) =>
        this.enqueue(context, async () => {
          if (source !== 'none') this.ensureVideoStateChannel(peerId, context);
          if (context.videoSender) {
            await context.videoSender.replaceTrack(track);
          } else if (track) {
            context.videoSender = context.connection.addTrack(track, new MediaStream([track]));
          }
          if (context.videoSender && track) this.configureVideoSender(context.videoSender, source);
          this.sendVideoState(context);
          this.startDiagnosticTimer(peerId, context);
        }),
      ),
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
    this.clearDiagnosticTimer(context);
    context.videoStateChannel?.close();
    context.remoteVideoStateChannel?.close();
    context.connection.close();
    this.peers.delete(peerId);
    this.events.onVideoState?.(peerId, 'none');
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

  private clearDiagnosticTimer(context: PeerContext) {
    if (!context.diagnosticTimer) return;
    window.clearInterval(context.diagnosticTimer);
    context.diagnosticTimer = undefined;
  }

  private startDiagnosticTimer(peerId: string, context: PeerContext) {
    context.diagnosticStartedAt = performance.now();
    if (context.diagnosticTimer) return;
    context.diagnosticTimer = window.setInterval(() => {
      if (performance.now() - context.diagnosticStartedAt > 120_000) {
        this.clearDiagnosticTimer(context);
        return;
      }
      void this.pollConnectionStats(peerId, context);
    }, 250);
  }

  private ensureVideoStateChannel(peerId: string, context: PeerContext) {
    if (context.videoStateChannel) return;
    const channel = context.connection.createDataChannel(VIDEO_STATE_CHANNEL, { ordered: true });
    context.videoStateChannel = channel;
    channel.onopen = () => {
      connectionDiagnostics.record('video-state-channel:open', peerId);
      this.sendVideoState(context);
    };
    channel.onclose = () => connectionDiagnostics.record('video-state-channel:closed', peerId);
  }

  private sendVideoState(context: PeerContext) {
    if (context.videoStateChannel?.readyState !== 'open') return;
    context.videoStateChannel.send(JSON.stringify({ source: this.localVideoSource }));
  }

  private handleVideoStateMessage(peerId: string, context: PeerContext, raw: unknown) {
    if (typeof raw !== 'string' || raw.length > 128) return;
    try {
      const value = JSON.parse(raw) as { source?: unknown };
      if (value.source !== 'none' && value.source !== 'camera' && value.source !== 'screen') return;
      context.remoteVideoActive = value.source !== 'none';
      if (context.remoteVideoActive) this.startDiagnosticTimer(peerId, context);
      connectionDiagnostics.record('remote-video-source', peerId, { source: value.source });
      this.events.onVideoState?.(peerId, value.source);
    } catch {
      // Ignore malformed peer metadata. It never affects the media connection.
    }
  }

  private configureVideoSender(sender: RTCRtpSender, source: LocalVideoSource) {
    const parameters = sender.getParameters();
    if (!parameters.encodings?.length) parameters.encodings = [{}];
    parameters.encodings[0]!.maxBitrate = source === 'screen' ? 2_500_000 : 1_500_000;
    parameters.degradationPreference = source === 'screen' ? 'maintain-resolution' : 'balanced';
    void sender.setParameters(parameters).catch(() => undefined);
  }

  private candidateType(candidate: string) {
    return candidate.match(/\btyp\s+(host|srflx|prflx|relay)\b/i)?.[1]?.toLowerCase();
  }

  private async pollConnectionStats(peerId: string, context: PeerContext) {
    if (context.connection.signalingState === 'closed') return;
    try {
      const stats = await context.connection.getStats();
      let selectedPair: RTCStats | undefined;
      let inboundBytes = 0;
      let inboundPackets = 0;
      let outboundBytes = 0;
      let outboundPackets = 0;
      let inboundVideoBytes = 0;
      let inboundVideoPackets = 0;
      let inboundFramesDecoded = 0;
      let inboundFramesReceived = 0;
      let outboundVideoBytes = 0;
      let outboundVideoPackets = 0;
      let outboundFramesEncoded = 0;
      let outboundFramesSent = 0;
      for (const report of stats.values()) {
        if (
          report.type === 'candidate-pair' &&
          !context.firstConnectivityCheckRecorded &&
          (report.state === 'in-progress' || Number(report.requestsSent ?? 0) > 0)
        ) {
          context.firstConnectivityCheckRecorded = true;
          connectionDiagnostics.record('first-connectivity-check', peerId);
        }
        if (report.type === 'transport' && report.selectedCandidatePairId)
          selectedPair = stats.get(report.selectedCandidatePairId);
        if (
          !selectedPair &&
          report.type === 'candidate-pair' &&
          report.state === 'succeeded' &&
          report.nominated
        )
          selectedPair = report;
        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          inboundBytes += Number(report.bytesReceived ?? 0);
          inboundPackets += Number(report.packetsReceived ?? 0);
        }
        if (report.type === 'outbound-rtp' && report.kind === 'audio') {
          outboundBytes += Number(report.bytesSent ?? 0);
          outboundPackets += Number(report.packetsSent ?? 0);
        }
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          inboundVideoBytes += Number(report.bytesReceived ?? 0);
          inboundVideoPackets += Number(report.packetsReceived ?? 0);
          inboundFramesDecoded += Number(report.framesDecoded ?? 0);
          inboundFramesReceived += Number(report.framesReceived ?? 0);
        }
        if (report.type === 'outbound-rtp' && report.kind === 'video') {
          outboundVideoBytes += Number(report.bytesSent ?? 0);
          outboundVideoPackets += Number(report.packetsSent ?? 0);
          outboundFramesEncoded += Number(report.framesEncoded ?? 0);
          outboundFramesSent += Number(report.framesSent ?? 0);
        }
      }
      if (selectedPair && !context.selectedPairRecorded) {
        context.selectedPairRecorded = true;
        const pair = selectedPair as CandidatePairStats;
        const local = pair.localCandidateId ? stats.get(pair.localCandidateId) : undefined;
        const remote = pair.remoteCandidateId ? stats.get(pair.remoteCandidateId) : undefined;
        connectionDiagnostics.record('selected-candidate-pair', peerId, {
          localType: local?.candidateType ?? 'unknown',
          remoteType: remote?.candidateType ?? 'unknown',
          protocol: local?.protocol ?? 'unknown',
          relayProtocol: local?.relayProtocol ?? 'none',
        });
      }
      if ((inboundBytes > 0 || inboundPackets > 0) && !context.firstInboundRtpRecorded) {
        context.firstInboundRtpRecorded = true;
        connectionDiagnostics.record('first-inbound-rtp', peerId, {
          bytesReceived: inboundBytes,
          packetsReceived: inboundPackets,
          bytesSent: outboundBytes,
          packetsSent: outboundPackets,
        });
      }
      if (
        (outboundVideoBytes > 0 || outboundVideoPackets > 0) &&
        !context.firstOutboundVideoRecorded
      ) {
        context.firstOutboundVideoRecorded = true;
        connectionDiagnostics.record('first-video-outbound-rtp', peerId, {
          bytesSent: outboundVideoBytes,
          packetsSent: outboundVideoPackets,
          framesEncoded: outboundFramesEncoded,
          framesSent: outboundFramesSent,
        });
      }
      if (
        (inboundVideoBytes > 0 || inboundVideoPackets > 0) &&
        !context.firstInboundVideoRecorded
      ) {
        context.firstInboundVideoRecorded = true;
        connectionDiagnostics.record('first-video-inbound-rtp', peerId, {
          bytesReceived: inboundVideoBytes,
          packetsReceived: inboundVideoPackets,
          framesDecoded: inboundFramesDecoded,
          framesReceived: inboundFramesReceived,
        });
      }
      const localVideoActive = this.localVideoSource !== 'none';
      const videoDiagnosticsComplete =
        (!localVideoActive || context.firstOutboundVideoRecorded) &&
        (!context.remoteVideoActive || context.firstInboundVideoRecorded);
      if (
        context.selectedPairRecorded &&
        context.firstInboundRtpRecorded &&
        videoDiagnosticsComplete
      )
        this.clearDiagnosticTimer(context);
    } catch {
      // Diagnostics must never affect call setup.
    }
  }
}

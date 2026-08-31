import type { ServerMessage, TelemetryConnectionSample } from '@freetalk/protocol';
import { connectionDiagnostics } from './connection-diagnostics';
import type { VideoMediaSource } from './video-manager';
import {
  DEFAULT_VIDEO_PREFERENCES,
  nextAdaptiveQualityLevel,
  normalizeVideoPreferences,
  screenEncodingProfile,
  type NetworkQualitySample,
  type VideoPreferences,
} from './video-quality';

const VIDEO_STATE_CHANNEL = 'freetalk-video-state-v1';
const VIDEO_STATE_REQUEST = JSON.stringify({ version: 2, request: 'video-state' });

interface VideoSenderContext {
  transceiver: RTCRtpTransceiver;
  sender: RTCRtpSender;
}

interface RemoteVideoSourceState {
  active: boolean;
  mid: string | null;
  trackId: string | null;
}

interface PeerContext {
  connection: RTCPeerConnection;
  voiceSender?: RTCRtpSender;
  polite: boolean;
  makingOffer: boolean;
  negotiationPending: boolean;
  ignoreOffer: boolean;
  settingRemoteAnswer: boolean;
  candidates: Set<string>;
  pendingCandidates: RTCIceCandidateInit[];
  operationQueue: Promise<void>;
  disconnectTimer?: number;
  iceRestartAttempts: number;
  diagnosticTimer?: number;
  qualityTimer?: number;
  adaptiveQualityLevel: number;
  adaptiveGoodSamples: number;
  screenStatsSnapshot?: { bytesSent: number; timestamp: number };
  diagnosticStartedAt: number;
  firstCandidateTypes: Set<string>;
  firstConnectivityCheckRecorded: boolean;
  selectedPairRecorded: boolean;
  firstInboundRtpRecorded: boolean;
  inboundVideoRecorded: Set<VideoMediaSource>;
  outboundVideoRecorded: Set<VideoMediaSource>;
  telemetrySnapshots: Map<
    string,
    { bytes: number; packets: number; packetsLost: number; timestamp: number }
  >;
  videoSenders: Partial<Record<VideoMediaSource, VideoSenderContext>>;
  screenAudioSender?: VideoSenderContext;
  videoStateChannel?: RTCDataChannel;
  remoteVideoStateChannel?: RTCDataChannel;
  remoteVideoState: Record<VideoMediaSource, RemoteVideoSourceState>;
  remoteVideoTracksByMid: Map<string, { stream: MediaStream; track: MediaStreamTrack }>;
  remoteVideoTracksById: Map<string, { stream: MediaStream; track: MediaStreamTrack }>;
}

const ICE_RESTART_DELAYS_MS = [1_000, 3_000, 7_000] as const;

export interface PeerEvents {
  onTrack(peerId: string, stream: MediaStream): void;
  onScreenAudioTrack?(peerId: string, stream: MediaStream): void;
  onVideoTrack?(
    peerId: string,
    source: VideoMediaSource,
    stream: MediaStream,
    track: MediaStreamTrack,
  ): void;
  onVideoState?(peerId: string, source: VideoMediaSource, active: boolean): void;
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
  currentRoundTripTime?: number;
  availableOutgoingBitrate?: number;
  availableIncomingBitrate?: number;
}

interface OutboundVideoStats extends RTCStats {
  bytesSent?: number;
  codecId?: string;
  frameWidth?: number;
  frameHeight?: number;
  framesPerSecond?: number;
}

export class PeerManager {
  private readonly peers = new Map<string, PeerContext>();
  private readonly localVideoTracks: Record<VideoMediaSource, MediaStreamTrack | null> = {
    camera: null,
    screen: null,
  };
  private localScreenStream?: MediaStream;
  private videoPreferences: VideoPreferences;

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
    videoPreferences: VideoPreferences = DEFAULT_VIDEO_PREFERENCES,
  ) {
    this.videoPreferences = normalizeVideoPreferences(videoPreferences);
  }

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
      negotiationPending: false,
      ignoreOffer: false,
      settingRemoteAnswer: false,
      candidates: new Set(),
      pendingCandidates: [],
      operationQueue: Promise.resolve(),
      iceRestartAttempts: 0,
      diagnosticStartedAt: performance.now(),
      adaptiveQualityLevel: 0,
      adaptiveGoodSamples: 0,
      firstCandidateTypes: new Set(),
      firstConnectivityCheckRecorded: false,
      selectedPairRecorded: false,
      firstInboundRtpRecorded: false,
      inboundVideoRecorded: new Set(),
      outboundVideoRecorded: new Set(),
      telemetrySnapshots: new Map(),
      videoSenders: {},
      remoteVideoState: {
        camera: { active: false, mid: null, trackId: null },
        screen: { active: false, mid: null, trackId: null },
      },
      remoteVideoTracksByMid: new Map(),
      remoteVideoTracksById: new Map(),
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
      context.voiceSender = sender;
      connectionDiagnostics.record('add-track:end', peerId, { kind: track.kind });
      void sender.getParameters().encodings?.length;
      const parameters = sender.getParameters();
      if (!parameters.encodings?.length) parameters.encodings = [{}];
      parameters.encodings[0].maxBitrate = 64_000;
      parameters.encodings[0].priority = 'high';
      void sender.setParameters(parameters).catch(() => undefined);
    }
    const transceiver = connection
      .getTransceivers()
      .find((item) => item.sender.track?.kind === 'audio');
    const opus = RTCRtpReceiver.getCapabilities?.('audio')?.codecs.filter(
      (codec) => codec.mimeType.toLowerCase() === 'audio/opus',
    );
    if (transceiver?.setCodecPreferences && opus?.length) transceiver.setCodecPreferences(opus);

    for (const source of ['camera', 'screen'] as const) {
      const track = this.localVideoTracks[source];
      if (track)
        this.createVideoSender(
          peerId,
          context,
          source,
          track,
          source === 'screen' ? this.localScreenStream : undefined,
        );
    }
    const screenAudioTrack = this.localScreenStream?.getAudioTracks()[0];
    if (screenAudioTrack)
      this.createScreenAudioSender(peerId, context, screenAudioTrack, this.localScreenStream!);
    if (this.localVideoTracks.camera || this.localVideoTracks.screen)
      this.ensureVideoStateChannel(peerId, context);
    if (this.localVideoTracks.screen) this.startQualityTimer(peerId, context);

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
    connection.ontrack = ({ streams, track, transceiver }) => {
      connectionDiagnostics.record('remote-track', peerId, { kind: track.kind });
      const stream = streams[0] ?? new MediaStream([track]);
      if (track.kind === 'video') {
        const mid = transceiver.mid;
        connectionDiagnostics.record('video-ontrack-fired', peerId, {
          mid: mid ?? 'unassigned',
          trackId: track.id,
        });
        if (mid) context.remoteVideoTracksByMid.set(mid, { stream, track });
        context.remoteVideoTracksById.set(track.id, { stream, track });
        track.onended = () => {
          const source = this.remoteSourceForMedia(context, mid, track.id);
          connectionDiagnostics.record('remote-video-track:ended', peerId, {
            mediaSource: source ?? 'unknown',
            mid: mid ?? 'unassigned',
          });
          if (mid) context.remoteVideoTracksByMid.delete(mid);
          context.remoteVideoTracksById.delete(track.id);
          if (source) this.events.onVideoState?.(peerId, source, false);
        };
        this.publishMappedRemoteVideo(peerId, context, mid, track.id);
        this.startDiagnosticTimer(peerId, context);
      } else if (
        context.voiceSender
          ? transceiver.sender !== context.voiceSender
          : stream.getVideoTracks().length > 0
      ) {
        connectionDiagnostics.record('remote-screen-audio-track', peerId, {
          trackId: track.id,
          streamId: stream.id,
          mid: transceiver.mid ?? 'unassigned',
        });
        this.events.onScreenAudioTrack?.(peerId, new MediaStream([track]));
      } else {
        this.events.onTrack(peerId, stream);
      }
    };
    connection.ondatachannel = ({ channel }) => {
      if (channel.label !== VIDEO_STATE_CHANNEL) return;
      context.remoteVideoStateChannel?.close();
      context.remoteVideoStateChannel = channel;
      this.configureVideoStateChannel(peerId, context, channel, true);
    };
    connection.onconnectionstatechange = () => {
      connectionDiagnostics.record(`connection:${connection.connectionState}`, peerId);
      this.events.onState(peerId, connection.connectionState);
      if (connection.connectionState === 'connected') {
        context.iceRestartAttempts = 0;
        this.clearDisconnectTimer(context);
        this.sendVideoState(peerId, context);
        this.requestVideoState(context);
      } else if (
        connection.connectionState === 'disconnected' ||
        connection.connectionState === 'failed'
      ) {
        this.scheduleIceRestart(peerId, context);
      } else if (connection.connectionState === 'closed') {
        this.clearDisconnectTimer(context);
      }
    };
    connection.onsignalingstatechange = () => {
      if (connection.signalingState === 'stable' && context.negotiationPending)
        this.negotiateWhenStable(peerId, context);
    };
    connection.onnegotiationneeded = () => {
      connectionDiagnostics.record('negotiationneeded', peerId, {
        signalingState: connection.signalingState,
      });
      this.trace(peerId, 'negotiationneeded', connection);
      this.requestNegotiation(peerId, context);
    };
    // WebKit can emit the initial negotiationneeded event before a handler is
    // attached when camera/screen transceivers already exist for a late joiner.
    // Explicitly request one negotiation so those tracks are never omitted.
    if (this.localVideoTracks.camera || this.localVideoTracks.screen || screenAudioTrack)
      this.requestNegotiation(peerId, context);
    this.startDiagnosticTimer(peerId, context);
    return connection;
  }

  async collectTelemetry(): Promise<TelemetryConnectionSample[]> {
    const samples = await Promise.all(
      [...this.peers].map(async ([peerId, context]) => {
        if (context.connection.signalingState === 'closed') return undefined;
        try {
          return await this.collectPeerTelemetry(peerId, context);
        } catch {
          return undefined;
        }
      }),
    );
    return samples.filter((sample): sample is TelemetryConnectionSample => Boolean(sample));
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
      this.sendVideoState(message.from, context);
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
    if (connection.signalingState === 'stable' && context.negotiationPending)
      this.negotiateWhenStable(message.from, context);
  }

  async replaceAudioTrack(track: MediaStreamTrack) {
    await Promise.all(
      [...this.peers.values()].map(async (context) => {
        if (context.voiceSender) await context.voiceSender.replaceTrack(track);
      }),
    );
  }

  async setVideoTrack(
    track: MediaStreamTrack | null,
    source: VideoMediaSource,
    stream?: MediaStream,
  ) {
    this.localVideoTracks[source] = track;
    if (source === 'screen') this.localScreenStream = track ? stream : undefined;
    connectionDiagnostics.record('local-video-source', undefined, {
      mediaSource: source,
      active: Boolean(track),
      trackId: track?.id ?? 'none',
    });
    await Promise.all(
      [...this.peers.entries()].map(([peerId, context]) =>
        this.enqueue(context, async () => {
          if (track) this.ensureVideoStateChannel(peerId, context);
          const existing = context.videoSenders[source];
          if (existing) {
            await existing.sender.replaceTrack(track);
          } else if (track) {
            this.createVideoSender(peerId, context, source, track, stream);
          }
          if (source === 'screen') {
            const audioTrack = stream?.getAudioTracks()[0] ?? null;
            if (context.screenAudioSender) {
              await context.screenAudioSender.sender.replaceTrack(audioTrack);
              if (audioTrack) this.configureScreenAudioSender(peerId, context.screenAudioSender);
            } else if (audioTrack && stream) {
              this.createScreenAudioSender(peerId, context, audioTrack, stream);
            }
            connectionDiagnostics.record('local-screen-audio-source', peerId, {
              active: Boolean(audioTrack),
              trackId: audioTrack?.id ?? 'none',
            });
          }
          for (const activeSource of ['camera', 'screen'] as const) {
            const sender = context.videoSenders[activeSource];
            if (sender?.sender.track) this.configureVideoSender(peerId, sender, activeSource);
          }
          if (source === 'screen') {
            context.adaptiveQualityLevel = 0;
            context.adaptiveGoodSamples = 0;
            context.screenStatsSnapshot = undefined;
            if (track) this.startQualityTimer(peerId, context);
            else this.clearQualityTimer(context);
          }
          this.sendVideoState(peerId, context);
          this.startDiagnosticTimer(peerId, context);
        }),
      ),
    );
    // Do not rely exclusively on negotiationneeded here. WebKit may coalesce or
    // drop the event when a data channel and video transceiver are added together.
    for (const [peerId, context] of this.peers) this.requestNegotiation(peerId, context);
  }

  setVideoPreferences(preferences: VideoPreferences) {
    this.videoPreferences = normalizeVideoPreferences(preferences);
    for (const [peerId, context] of this.peers) {
      context.adaptiveQualityLevel = 0;
      context.adaptiveGoodSamples = 0;
      for (const source of ['camera', 'screen'] as const) {
        const sender = context.videoSenders[source];
        if (sender?.sender.track) this.configureVideoSender(peerId, sender, source);
      }
      if (this.localVideoTracks.screen) this.startQualityTimer(peerId, context);
      else this.clearQualityTimer(context);
    }
  }

  updateIceServers(iceServers: RTCIceServer[]) {
    if (JSON.stringify(this.iceServers) === JSON.stringify(iceServers)) return;
    this.iceServers = iceServers;
    for (const [peerId, context] of this.peers) {
      const { connection } = context;
      if (connection.signalingState === 'closed') continue;
      connection.setConfiguration({ ...connection.getConfiguration(), iceServers });
      context.iceRestartAttempts = 0;
      this.clearDisconnectTimer(context);
      // The signaling server intentionally issues short-lived TURN credentials
      // only after the participant joins. Restart gathering so connections that
      // already started with STUN can immediately discover relay candidates.
      connectionDiagnostics.record('ice-restart:credentials:start', peerId);
      connection.restartIce();
    }
  }

  remove(peerId: string) {
    const context = this.peers.get(peerId);
    if (!context) return;
    if (context.disconnectTimer) window.clearTimeout(context.disconnectTimer);
    this.clearDiagnosticTimer(context);
    this.clearQualityTimer(context);
    context.videoStateChannel?.close();
    context.remoteVideoStateChannel?.close();
    context.connection.close();
    this.peers.delete(peerId);
    this.events.onVideoState?.(peerId, 'camera', false);
    this.events.onVideoState?.(peerId, 'screen', false);
  }

  closeAll() {
    for (const peerId of [...this.peers.keys()]) this.remove(peerId);
  }

  private scheduleIceRestart(peerId: string, context: PeerContext) {
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
        connectionDiagnostics.record('ice-restart:recovery:start', peerId, {
          attempt: context.iceRestartAttempts,
        });
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

  private requestNegotiation(peerId: string, context: PeerContext) {
    if (context.connection.signalingState === 'closed') return;
    context.negotiationPending = true;
    this.negotiateWhenStable(peerId, context);
  }

  private negotiateWhenStable(peerId: string, context: PeerContext) {
    void this.enqueue(context, async () => {
      const connection = context.connection;
      if (!context.negotiationPending || connection.signalingState !== 'stable') {
        if (context.negotiationPending) this.trace(peerId, 'offer-deferred:not-stable', connection);
        return;
      }
      context.negotiationPending = false;
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
        this.sendVideoState(peerId, context);
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

  private clearQualityTimer(context: PeerContext) {
    if (!context.qualityTimer) return;
    window.clearInterval(context.qualityTimer);
    context.qualityTimer = undefined;
  }

  private startQualityTimer(peerId: string, context: PeerContext) {
    if (context.qualityTimer) return;
    context.qualityTimer = window.setInterval(() => {
      if (!this.localVideoTracks.screen || context.connection.signalingState === 'closed') {
        this.clearQualityTimer(context);
        return;
      }
      void this.pollAdaptiveQuality(peerId, context);
    }, 1_000);
  }

  private ensureVideoStateChannel(peerId: string, context: PeerContext) {
    if (context.videoStateChannel) return;
    const channel = context.connection.createDataChannel(VIDEO_STATE_CHANNEL, { ordered: true });
    context.videoStateChannel = channel;
    this.configureVideoStateChannel(peerId, context, channel, false);
  }

  private sendVideoState(peerId: string, context: PeerContext) {
    const channels = new Set([context.videoStateChannel, context.remoteVideoStateChannel]);
    for (const channel of channels)
      if (channel?.readyState === 'open') this.sendVideoStateOn(peerId, context, channel);
  }

  private sendVideoStateOn(peerId: string, context: PeerContext, channel: RTCDataChannel) {
    const sources = Object.fromEntries(
      (['camera', 'screen'] as const).map((source) => {
        const sender = context.videoSenders[source];
        const track = this.localVideoTracks[source];
        return [
          source,
          {
            active: Boolean(track),
            mid: sender?.transceiver.mid ?? null,
            trackId: track?.id ?? null,
          },
        ];
      }),
    ) as Record<VideoMediaSource, RemoteVideoSourceState>;
    if (!this.sendChannelMessage(channel, JSON.stringify({ version: 2, sources }))) return;
    connectionDiagnostics.record('video-source-map:sent', peerId, {
      cameraActive: sources.camera.active,
      cameraMid: sources.camera.mid ?? 'unassigned',
      screenActive: sources.screen.active,
      screenMid: sources.screen.mid ?? 'unassigned',
    });
  }

  private configureVideoStateChannel(
    peerId: string,
    context: PeerContext,
    channel: RTCDataChannel,
    incoming: boolean,
  ) {
    const synchronize = () => {
      connectionDiagnostics.record('video-state-channel:open', peerId, {
        direction: incoming ? 'incoming' : 'outgoing',
      });
      this.sendVideoStateOn(peerId, context, channel);
      this.sendChannelMessage(channel, VIDEO_STATE_REQUEST);
    };
    channel.onmessage = ({ data }) => {
      if (data === VIDEO_STATE_REQUEST) {
        connectionDiagnostics.record('video-state-request:received', peerId);
        this.sendVideoStateOn(peerId, context, channel);
        return;
      }
      this.handleVideoStateMessage(peerId, context, data);
    };
    channel.onopen = synchronize;
    channel.onclose = () => connectionDiagnostics.record('video-state-channel:closed', peerId);
    if (channel.readyState === 'open') synchronize();
  }

  private requestVideoState(context: PeerContext) {
    const channels = new Set([context.videoStateChannel, context.remoteVideoStateChannel]);
    for (const channel of channels)
      if (channel) this.sendChannelMessage(channel, VIDEO_STATE_REQUEST);
  }

  private sendChannelMessage(channel: RTCDataChannel, message: string) {
    if (channel.readyState !== 'open') return false;
    try {
      channel.send(message);
      return true;
    } catch {
      // The data channel can close between checking readyState and send(). Media
      // stays connected and the next open/connected event requests state again.
      return false;
    }
  }

  private handleVideoStateMessage(peerId: string, context: PeerContext, raw: unknown) {
    if (typeof raw !== 'string' || raw.length > 512) return;
    try {
      const value = JSON.parse(raw) as {
        version?: unknown;
        sources?: Partial<Record<VideoMediaSource, Partial<RemoteVideoSourceState>>>;
        source?: unknown;
      };
      if (value.version !== 2 || !value.sources) {
        // Compatibility with 0.3.x peers that exposed one replaceTrack-based source.
        if (value.source !== 'none' && value.source !== 'camera' && value.source !== 'screen')
          return;
        for (const source of ['camera', 'screen'] as const) {
          const active = value.source === source;
          context.remoteVideoState[source] = { active, mid: null, trackId: null };
          this.events.onVideoState?.(peerId, source, active);
        }
        if (value.source === 'camera' || value.source === 'screen') {
          const onlyRemoteTrack = [...context.remoteVideoTracksByMid.entries()].at(-1);
          if (onlyRemoteTrack) {
            context.remoteVideoState[value.source].mid = onlyRemoteTrack[0];
            this.publishMappedRemoteVideo(
              peerId,
              context,
              onlyRemoteTrack[0],
              onlyRemoteTrack[1].track.id,
            );
          }
        }
        return;
      }
      for (const source of ['camera', 'screen'] as const) {
        const next = value.sources[source];
        if (
          !next ||
          typeof next.active !== 'boolean' ||
          (next.mid !== null && typeof next.mid !== 'string') ||
          (next.trackId !== null && typeof next.trackId !== 'string')
        )
          return;
        context.remoteVideoState[source] = {
          active: next.active,
          mid: next.mid ?? null,
          trackId: next.trackId ?? null,
        };
        connectionDiagnostics.record('remote-video-source', peerId, {
          mediaSource: source,
          active: next.active,
          mid: next.mid ?? 'unassigned',
          trackId: next.trackId ?? 'none',
        });
        this.events.onVideoState?.(peerId, source, next.active);
        if (next.active) {
          this.publishMappedRemoteVideo(peerId, context, next.mid ?? null, next.trackId ?? null);
          this.startDiagnosticTimer(peerId, context);
        }
      }
    } catch {
      // Ignore malformed peer metadata. It never affects the media connection.
    }
  }

  private createVideoSender(
    peerId: string,
    context: PeerContext,
    source: VideoMediaSource,
    track: MediaStreamTrack,
    stream?: MediaStream,
  ) {
    const transceiver = context.connection.addTransceiver(track, {
      direction: 'sendonly',
      streams: [stream ?? new MediaStream([track])],
    });
    const videoSender = { transceiver, sender: transceiver.sender };
    context.videoSenders[source] = videoSender;
    this.configureVideoSender(peerId, videoSender, source);
    connectionDiagnostics.record('video-transceiver:created', peerId, {
      mediaSource: source,
      trackId: track.id,
      mid: transceiver.mid ?? 'unassigned',
    });
  }

  private createScreenAudioSender(
    peerId: string,
    context: PeerContext,
    track: MediaStreamTrack,
    stream: MediaStream,
  ) {
    const transceiver = context.connection.addTransceiver(track, {
      direction: 'sendonly',
      streams: [stream],
    });
    const sender = { transceiver, sender: transceiver.sender };
    context.screenAudioSender = sender;
    this.configureScreenAudioSender(peerId, sender);
    const opus = RTCRtpReceiver.getCapabilities?.('audio')?.codecs.filter(
      (codec) => codec.mimeType.toLowerCase() === 'audio/opus',
    );
    if (transceiver.setCodecPreferences && opus?.length) transceiver.setCodecPreferences(opus);
    connectionDiagnostics.record('screen-audio-transceiver:created', peerId, {
      trackId: track.id,
      streamId: stream.id,
      mid: transceiver.mid ?? 'unassigned',
    });
  }

  private configureScreenAudioSender(peerId: string, audioSender: VideoSenderContext) {
    const parameters = audioSender.sender.getParameters();
    if (!parameters.encodings?.length) parameters.encodings = [{}];
    parameters.encodings[0]!.maxBitrate = 160_000;
    parameters.encodings[0]!.priority = 'medium';
    void audioSender.sender
      .setParameters(parameters)
      .then(() =>
        connectionDiagnostics.record('screen-audio-sender:configured', peerId, {
          maxBitrate: parameters.encodings?.[0]?.maxBitrate ?? 0,
          priority: parameters.encodings?.[0]?.priority ?? 'unknown',
        }),
      )
      .catch(() => undefined);
  }

  private configureVideoSender(
    peerId: string,
    videoSender: VideoSenderContext,
    source: VideoMediaSource,
  ) {
    const parameters = videoSender.sender.getParameters();
    if (!parameters.encodings?.length) parameters.encodings = [{}];
    const screenActive = Boolean(this.localVideoTracks.screen);
    const screenProfile = screenEncodingProfile(
      this.videoPreferences,
      this.videoPreferences.screenAdaptiveQuality
        ? (this.peers.get(peerId)?.adaptiveQualityLevel ?? 0)
        : 0,
    );
    parameters.encodings[0]!.maxBitrate =
      source === 'screen' ? screenProfile.maxBitrate : screenActive ? 1_500_000 : 3_500_000;
    parameters.encodings[0]!.maxFramerate =
      source === 'screen' ? screenProfile.maxFramerate : screenActive ? 30 : 60;
    parameters.encodings[0]!.scaleResolutionDownBy =
      source === 'screen' ? screenProfile.scaleResolutionDownBy : 1;
    parameters.encodings[0]!.priority = source === 'screen' ? 'high' : 'medium';
    parameters.degradationPreference =
      source === 'screen'
        ? this.videoPreferences.screenContentMode === 'text'
          ? 'maintain-resolution'
          : this.videoPreferences.screenContentMode === 'video'
            ? 'maintain-framerate'
            : 'balanced'
        : 'maintain-framerate';
    void videoSender.sender
      .setParameters(parameters)
      .then(() =>
        connectionDiagnostics.record('video-sender:configured', peerId, {
          mediaSource: source,
          maxBitrate: parameters.encodings?.[0]?.maxBitrate ?? 0,
          maxFramerate: parameters.encodings?.[0]?.maxFramerate ?? 0,
          priority: parameters.encodings?.[0]?.priority ?? 'unknown',
          degradationPreference: parameters.degradationPreference ?? 'unknown',
        }),
      )
      .catch(() => undefined);
  }

  private async pollAdaptiveQuality(peerId: string, context: PeerContext) {
    const screenSender = context.videoSenders.screen;
    if (!screenSender?.sender.track) return;
    try {
      const stats = await context.connection.getStats();
      const screenMid = screenSender.transceiver.mid;
      let outboundId = '';
      let outboundReport: OutboundVideoStats | undefined;
      let qualityLimitationReason: string | undefined;
      let availableOutgoingBitrate: number | undefined;
      let fractionLost: number | undefined;
      let roundTripTime: number | undefined;
      let selectedCandidatePairId: string | undefined;
      for (const report of stats.values()) {
        if (
          report.type === 'outbound-rtp' &&
          (report.kind ?? report.mediaType) === 'video' &&
          report.mid === screenMid
        ) {
          outboundId = report.id;
          outboundReport = report as OutboundVideoStats;
          qualityLimitationReason = report.qualityLimitationReason as string | undefined;
        }
        if (report.type === 'transport' && report.selectedCandidatePairId) {
          selectedCandidatePairId = String(report.selectedCandidatePairId);
        }
      }
      for (const report of stats.values()) {
        if (
          report.type === 'candidate-pair' &&
          (report.id === selectedCandidatePairId ||
            (report.state === 'succeeded' && report.nominated))
        ) {
          availableOutgoingBitrate = Number(report.availableOutgoingBitrate ?? 0) || undefined;
          roundTripTime = Number(report.currentRoundTripTime ?? 0) || undefined;
          if (report.id === selectedCandidatePairId) break;
        }
      }
      for (const report of stats.values()) {
        if (report.type !== 'remote-inbound-rtp' || (report.kind ?? report.mediaType) !== 'video')
          continue;
        if (outboundId && report.localId && report.localId !== outboundId) continue;
        fractionLost = Number(report.fractionLost ?? 0);
        roundTripTime = Number(report.roundTripTime ?? roundTripTime ?? 0) || roundTripTime;
        break;
      }
      const sample: NetworkQualitySample = {
        availableOutgoingBitrate,
        fractionLost,
        roundTripTime,
        qualityLimitationReason,
      };
      const timestamp = Number(outboundReport?.timestamp ?? performance.now());
      const bytesSent = Number(outboundReport?.bytesSent ?? 0);
      const previous = context.screenStatsSnapshot;
      const elapsedMs = previous ? timestamp - previous.timestamp : 0;
      const bitrate =
        previous && elapsedMs > 0
          ? Math.max(0, Math.round(((bytesSent - previous.bytesSent) * 8 * 1_000) / elapsedMs))
          : 0;
      context.screenStatsSnapshot = { bytesSent, timestamp };
      const codec = outboundReport?.codecId ? stats.get(String(outboundReport.codecId)) : undefined;
      const trackSettings = screenSender.sender.track.getSettings();
      connectionDiagnostics.record('screen-quality:sample', peerId, {
        mode: this.videoPreferences.screenContentMode,
        adaptive: this.videoPreferences.screenAdaptiveQuality,
        level: context.adaptiveQualityLevel,
        width: Number(outboundReport?.frameWidth ?? trackSettings.width ?? 0),
        height: Number(outboundReport?.frameHeight ?? trackSettings.height ?? 0),
        framesPerSecond: Number(outboundReport?.framesPerSecond ?? trackSettings.frameRate ?? 0),
        bitrate,
        availableOutgoingBitrate: availableOutgoingBitrate ?? 0,
        fractionLost: fractionLost ?? 0,
        roundTripTime: roundTripTime ?? 0,
        qualityLimitationReason: qualityLimitationReason ?? 'none',
        codec: String(codec?.mimeType ?? 'unknown'),
      });
      if (!this.videoPreferences.screenAdaptiveQuality) return;
      const currentProfile = screenEncodingProfile(
        this.videoPreferences,
        context.adaptiveQualityLevel,
      );
      const upgradeProfile = screenEncodingProfile(
        this.videoPreferences,
        Math.max(0, context.adaptiveQualityLevel - 1),
      );
      const next = nextAdaptiveQualityLevel(
        context.adaptiveQualityLevel,
        context.adaptiveGoodSamples,
        sample,
        currentProfile.maxBitrate,
        upgradeProfile.maxBitrate,
      );
      context.adaptiveGoodSamples = next.goodSamples;
      if (next.level === context.adaptiveQualityLevel) return;
      context.adaptiveQualityLevel = next.level;
      this.configureVideoSender(peerId, screenSender, 'screen');
      connectionDiagnostics.record('screen-quality:adapted', peerId, {
        level: next.level,
        availableOutgoingBitrate: availableOutgoingBitrate ?? 0,
        fractionLost: fractionLost ?? 0,
        roundTripTime: roundTripTime ?? 0,
        reason: qualityLimitationReason ?? 'network-sample',
      });
    } catch {
      // Network adaptation must never affect media or signaling.
    }
  }

  private remoteSourceForMedia(context: PeerContext, mid: string | null, trackId: string | null) {
    return (['camera', 'screen'] as const).find(
      (source) =>
        (mid && context.remoteVideoState[source].mid === mid) ||
        (trackId && context.remoteVideoState[source].trackId === trackId),
    );
  }

  private publishMappedRemoteVideo(
    peerId: string,
    context: PeerContext,
    mid: string | null,
    trackId: string | null,
  ) {
    const source = this.remoteSourceForMedia(context, mid, trackId);
    if (!source || !context.remoteVideoState[source].active) return;
    const media =
      (mid ? context.remoteVideoTracksByMid.get(mid) : undefined) ??
      (trackId ? context.remoteVideoTracksById.get(trackId) : undefined);
    if (!media) return;
    this.events.onVideoTrack?.(peerId, source, media.stream, media.track);
    this.events.onVideoState?.(peerId, source, true);
  }

  private candidateType(candidate: string) {
    return candidate.match(/\btyp\s+(host|srflx|prflx|relay)\b/i)?.[1]?.toLowerCase();
  }

  private async collectPeerTelemetry(
    peerId: string,
    context: PeerContext,
  ): Promise<TelemetryConnectionSample> {
    const stats = await context.connection.getStats();
    let selectedPair: RTCStats | undefined;
    let bytesSent = 0;
    let bytesReceived = 0;
    const media: TelemetryConnectionSample['media'] = [];
    for (const report of stats.values()) {
      if (report.type === 'transport' && report.selectedCandidatePairId)
        selectedPair = stats.get(String(report.selectedCandidatePairId));
      if (
        !selectedPair &&
        report.type === 'candidate-pair' &&
        report.state === 'succeeded' &&
        report.nominated
      )
        selectedPair = report;
      if (report.type === 'outbound-rtp') bytesSent += Number(report.bytesSent ?? 0);
      if (report.type === 'inbound-rtp') bytesReceived += Number(report.bytesReceived ?? 0);
      if (
        (report.type !== 'outbound-rtp' && report.type !== 'inbound-rtp') ||
        (report.kind ?? report.mediaType) !== 'video'
      )
        continue;
      const direction = report.type === 'outbound-rtp' ? 'outbound' : 'inbound';
      const source =
        direction === 'outbound'
          ? (['camera', 'screen'] as const).find(
              (candidate) =>
                context.videoSenders[candidate]?.transceiver.mid === String(report.mid ?? ''),
            )
          : this.remoteSourceForMedia(context, String(report.mid ?? ''), null);
      if (!source) continue;
      const rawBytes = Number(
        direction === 'outbound' ? (report.bytesSent ?? 0) : (report.bytesReceived ?? 0),
      );
      const timestamp = Number(report.timestamp ?? performance.now());
      const rawPackets = Number(
        direction === 'outbound' ? (report.packetsSent ?? 0) : (report.packetsReceived ?? 0),
      );
      const rawPacketsLost = Math.max(0, Number(report.packetsLost ?? 0));
      const previous = context.telemetrySnapshots.get(report.id);
      const elapsedMs = previous ? timestamp - previous.timestamp : 0;
      const bitrate =
        previous && elapsedMs > 0 && rawBytes >= previous.bytes
          ? Math.round(((rawBytes - previous.bytes) * 8 * 1_000) / elapsedMs)
          : 0;
      const packetsDelta =
        previous && rawPackets >= previous.packets ? rawPackets - previous.packets : 0;
      const packetsLostDelta =
        previous && rawPacketsLost >= previous.packetsLost
          ? rawPacketsLost - previous.packetsLost
          : 0;
      const packetTotal = packetsDelta + packetsLostDelta;
      context.telemetrySnapshots.set(report.id, {
        bytes: rawBytes,
        packets: rawPackets,
        packetsLost: rawPacketsLost,
        timestamp,
      });
      const reason = String(report.qualityLimitationReason ?? 'none');
      media.push({
        source,
        direction,
        width: Math.min(8192, Math.max(0, Math.round(Number(report.frameWidth ?? 0)))),
        height: Math.min(8192, Math.max(0, Math.round(Number(report.frameHeight ?? 0)))),
        framesPerSecond: Math.min(240, Math.max(0, Number(report.framesPerSecond ?? 0))),
        bitrate: Math.min(100_000_000, Math.max(0, Math.round(bitrate))),
        packetsLost: Math.min(
          2_147_483_647,
          Math.max(0, Math.round(Number(report.packetsLost ?? 0))),
        ),
        packetsDelta: Math.min(2_147_483_647, Math.max(0, Math.round(packetsDelta))),
        packetsLostDelta: Math.min(2_147_483_647, Math.max(0, Math.round(packetsLostDelta))),
        packetLossPercent: packetTotal > 0 ? (packetsLostDelta / packetTotal) * 100 : 0,
        framesSent:
          direction === 'outbound'
            ? Math.max(0, Math.round(Number(report.framesSent ?? 0)))
            : undefined,
        framesEncoded:
          direction === 'outbound'
            ? Math.max(0, Math.round(Number(report.framesEncoded ?? 0)))
            : undefined,
        framesDropped: Math.max(0, Math.round(Number(report.framesDropped ?? 0))),
        qualityLimitationReason: (['none', 'bandwidth', 'cpu', 'other'] as const).includes(
          reason as 'none',
        )
          ? (reason as 'none' | 'bandwidth' | 'cpu' | 'other')
          : 'other',
        mode:
          source === 'screen'
            ? this.videoPreferences.screenContentMode === 'balanced'
              ? 'auto'
              : this.videoPreferences.screenContentMode
            : undefined,
      });
    }
    const pair = selectedPair as CandidatePairStats | undefined;
    const local = pair?.localCandidateId ? stats.get(pair.localCandidateId) : undefined;
    const remote = pair?.remoteCandidateId ? stats.get(pair.remoteCandidateId) : undefined;
    const localType = String(local?.candidateType ?? 'unknown');
    const remoteType = String(remote?.candidateType ?? 'unknown');
    const candidateType = (value: string) =>
      (['host', 'srflx', 'prflx', 'relay'] as const).includes(value as 'host')
        ? (value as 'host' | 'srflx' | 'prflx' | 'relay')
        : 'unknown';
    const rawProtocol = String(local?.relayProtocol ?? local?.protocol ?? 'unknown').toLowerCase();
    const protocol = (['udp', 'tcp', 'tls'] as const).includes(rawProtocol as 'udp')
      ? (rawProtocol as 'udp' | 'tcp' | 'tls')
      : 'unknown';
    return {
      peerId,
      connectionType: !pair
        ? 'unknown'
        : localType === 'relay' || remoteType === 'relay'
          ? 'turn'
          : localType === 'unknown' || remoteType === 'unknown'
            ? 'unknown'
            : 'direct',
      localCandidateType: candidateType(localType),
      remoteCandidateType: candidateType(remoteType),
      protocol,
      connectionState: context.connection.connectionState,
      iceState: context.connection.iceConnectionState,
      rttMs: pair?.currentRoundTripTime
        ? Math.min(120_000, Math.max(0, Number(pair.currentRoundTripTime) * 1_000))
        : null,
      availableOutgoingBitrate: pair?.availableOutgoingBitrate
        ? Math.min(10_000_000_000, Math.max(0, Math.round(Number(pair.availableOutgoingBitrate))))
        : null,
      availableIncomingBitrate: pair?.availableIncomingBitrate
        ? Math.min(10_000_000_000, Math.max(0, Math.round(Number(pair.availableIncomingBitrate))))
        : null,
      bytesSent: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(bytesSent))),
      bytesReceived: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(bytesReceived))),
      media: media.slice(0, 4),
    };
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
      const inboundVideoBySource = new Map<
        VideoMediaSource,
        { bytes: number; packets: number; framesDecoded: number; framesReceived: number }
      >();
      const outboundVideoBySource = new Map<
        VideoMediaSource,
        { bytes: number; packets: number; framesEncoded: number; framesSent: number }
      >();
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
          const source = this.remoteSourceForMedia(context, String(report.mid ?? ''), null);
          if (source)
            inboundVideoBySource.set(source, {
              bytes: Number(report.bytesReceived ?? 0),
              packets: Number(report.packetsReceived ?? 0),
              framesDecoded: Number(report.framesDecoded ?? 0),
              framesReceived: Number(report.framesReceived ?? 0),
            });
        }
        if (report.type === 'outbound-rtp' && report.kind === 'video') {
          const mid = String(report.mid ?? '');
          const source = (['camera', 'screen'] as const).find(
            (candidate) => context.videoSenders[candidate]?.transceiver.mid === mid,
          );
          if (source)
            outboundVideoBySource.set(source, {
              bytes: Number(report.bytesSent ?? 0),
              packets: Number(report.packetsSent ?? 0),
              framesEncoded: Number(report.framesEncoded ?? 0),
              framesSent: Number(report.framesSent ?? 0),
            });
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
      for (const [source, values] of outboundVideoBySource) {
        if ((values.bytes <= 0 && values.packets <= 0) || context.outboundVideoRecorded.has(source))
          continue;
        context.outboundVideoRecorded.add(source);
        const track = this.localVideoTracks[source];
        const settings = track?.getSettings();
        connectionDiagnostics.record('first-video-outbound-rtp', peerId, {
          mediaSource: source,
          trackId: track?.id ?? 'none',
          mid: context.videoSenders[source]?.transceiver.mid ?? 'unassigned',
          width: settings?.width ?? 0,
          height: settings?.height ?? 0,
          frameRate: settings?.frameRate ?? 0,
          bytesSent: values.bytes,
          packetsSent: values.packets,
          framesEncoded: values.framesEncoded,
          framesSent: values.framesSent,
        });
      }
      for (const [source, values] of inboundVideoBySource) {
        if ((values.bytes <= 0 && values.packets <= 0) || context.inboundVideoRecorded.has(source))
          continue;
        context.inboundVideoRecorded.add(source);
        const remote = context.remoteVideoState[source];
        const track = remote.mid
          ? context.remoteVideoTracksByMid.get(remote.mid)?.track
          : undefined;
        const settings = track?.getSettings();
        connectionDiagnostics.record('first-video-inbound-rtp', peerId, {
          mediaSource: source,
          trackId: track?.id ?? remote.trackId ?? 'none',
          mid: remote.mid ?? 'unassigned',
          width: settings?.width ?? 0,
          height: settings?.height ?? 0,
          frameRate: settings?.frameRate ?? 0,
          bytesReceived: values.bytes,
          packetsReceived: values.packets,
          framesDecoded: values.framesDecoded,
          framesReceived: values.framesReceived,
        });
      }
      const activeLocalSources = (['camera', 'screen'] as const).filter((source) =>
        Boolean(this.localVideoTracks[source]),
      );
      const activeRemoteSources = (['camera', 'screen'] as const).filter(
        (source) => context.remoteVideoState[source].active,
      );
      const videoDiagnosticsComplete =
        activeLocalSources.every((source) => context.outboundVideoRecorded.has(source)) &&
        activeRemoteSources.every((source) => context.inboundVideoRecorded.has(source));
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

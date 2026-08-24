import type { ServerMessage } from '@freetalk/protocol';
import { connectionDiagnostics } from './connection-diagnostics';
import type { VideoMediaSource } from './video-manager';

const VIDEO_STATE_CHANNEL = 'freetalk-video-state-v1';

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
  inboundVideoRecorded: Set<VideoMediaSource>;
  outboundVideoRecorded: Set<VideoMediaSource>;
  videoSenders: Partial<Record<VideoMediaSource, VideoSenderContext>>;
  videoStateChannel?: RTCDataChannel;
  remoteVideoStateChannel?: RTCDataChannel;
  remoteVideoState: Record<VideoMediaSource, RemoteVideoSourceState>;
  remoteVideoTracksByMid: Map<string, { stream: MediaStream; track: MediaStreamTrack }>;
}

const ICE_RESTART_DELAYS_MS = [1_000, 3_000, 7_000] as const;

export interface PeerEvents {
  onTrack(peerId: string, stream: MediaStream): void;
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
}

export class PeerManager {
  private readonly peers = new Map<string, PeerContext>();
  private readonly localVideoTracks: Record<VideoMediaSource, MediaStreamTrack | null> = {
    camera: null,
    screen: null,
  };

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
      inboundVideoRecorded: new Set(),
      outboundVideoRecorded: new Set(),
      videoSenders: {},
      remoteVideoState: {
        camera: { active: false, mid: null, trackId: null },
        screen: { active: false, mid: null, trackId: null },
      },
      remoteVideoTracksByMid: new Map(),
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
      if (track) this.createVideoSender(peerId, context, source, track);
    }
    if (this.localVideoTracks.camera || this.localVideoTracks.screen)
      this.ensureVideoStateChannel(peerId, context);

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
        track.onended = () => {
          const source = this.remoteSourceForMid(context, mid);
          connectionDiagnostics.record('remote-video-track:ended', peerId, {
            mediaSource: source ?? 'unknown',
            mid: mid ?? 'unassigned',
          });
          if (mid) context.remoteVideoTracksByMid.delete(mid);
          if (source) this.events.onVideoState?.(peerId, source, false);
        };
        this.publishMappedRemoteVideo(peerId, context, mid);
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
  }

  async replaceAudioTrack(track: MediaStreamTrack) {
    await Promise.all(
      [...this.peers.values()].map(async ({ connection }) => {
        const sender = connection.getSenders().find((item) => item.track?.kind === 'audio');
        if (sender) await sender.replaceTrack(track);
      }),
    );
  }

  async setVideoTrack(track: MediaStreamTrack | null, source: VideoMediaSource) {
    this.localVideoTracks[source] = track;
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
            if (track) this.configureVideoSender(peerId, existing, source);
          } else if (track) {
            this.createVideoSender(peerId, context, source, track);
          }
          this.sendVideoState(peerId, context);
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
    this.events.onVideoState?.(peerId, 'camera', false);
    this.events.onVideoState?.(peerId, 'screen', false);
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
      this.sendVideoState(peerId, context);
    };
    channel.onclose = () => connectionDiagnostics.record('video-state-channel:closed', peerId);
  }

  private sendVideoState(peerId: string, context: PeerContext) {
    if (context.videoStateChannel?.readyState !== 'open') return;
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
    context.videoStateChannel.send(JSON.stringify({ version: 2, sources }));
    connectionDiagnostics.record('video-source-map:sent', peerId, {
      cameraActive: sources.camera.active,
      cameraMid: sources.camera.mid ?? 'unassigned',
      screenActive: sources.screen.active,
      screenMid: sources.screen.mid ?? 'unassigned',
    });
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
            this.publishMappedRemoteVideo(peerId, context, onlyRemoteTrack[0]);
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
          this.publishMappedRemoteVideo(peerId, context, next.mid ?? null);
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
  ) {
    const transceiver = context.connection.addTransceiver(track, {
      direction: 'sendonly',
      streams: [new MediaStream([track])],
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

  private configureVideoSender(
    peerId: string,
    videoSender: VideoSenderContext,
    source: VideoMediaSource,
  ) {
    const parameters = videoSender.sender.getParameters();
    if (!parameters.encodings?.length) parameters.encodings = [{}];
    parameters.encodings[0]!.maxBitrate = source === 'screen' ? 4_000_000 : 3_500_000;
    parameters.encodings[0]!.maxFramerate = source === 'screen' ? 30 : 60;
    parameters.encodings[0]!.scaleResolutionDownBy = 1;
    parameters.encodings[0]!.priority = source === 'screen' ? 'low' : 'medium';
    parameters.degradationPreference =
      source === 'screen' ? 'maintain-resolution' : 'maintain-framerate';
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

  private remoteSourceForMid(context: PeerContext, mid: string | null) {
    if (!mid) return undefined;
    return (['camera', 'screen'] as const).find(
      (source) => context.remoteVideoState[source].mid === mid,
    );
  }

  private publishMappedRemoteVideo(peerId: string, context: PeerContext, mid: string | null) {
    const source = this.remoteSourceForMid(context, mid);
    if (!source || !context.remoteVideoState[source].active || !mid) return;
    const media = context.remoteVideoTracksByMid.get(mid);
    if (!media) return;
    this.events.onVideoTrack?.(peerId, source, media.stream, media.track);
    this.events.onVideoState?.(peerId, source, true);
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
          const source = this.remoteSourceForMid(context, String(report.mid ?? ''));
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

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ROOM_MAX_PARTICIPANTS } from '@freetalk/config';
import type { Participant, Reaction, RoomChatMessage } from '@freetalk/protocol';
import {
  Ban,
  Check,
  Camera,
  CameraOff,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleDot,
  Crown,
  LogOut,
  Maximize2,
  MessageCircle,
  Mic,
  MicOff,
  MonitorUp,
  Minimize2,
  MoreHorizontal,
  SmilePlus,
  ShieldCheck,
  Square,
  UserPlus,
  Volume2,
  VolumeX,
  X,
  PictureInPicture2,
  Eye,
  ImagePlus,
  SlidersHorizontal,
  Sparkles,
  Users,
} from 'lucide-react';
import type { LocalSettings } from '../lib/settings';
import type { SignalingState } from '../lib/signaling-client';
import type { LocalVideoState, VideoMediaSource } from '../lib/video-manager';
import { RoomChatPanel } from './RoomChatPanel';
import { CachedMediaImage } from './CachedMedia';
import type { ScreenRecordingState } from '../lib/screen-recorder';
import {
  createCameraEffectCapture,
  imageFileToCameraBackground,
  type CameraBackgroundMode,
  type CameraEffectCapture,
} from '../lib/camera-background';
import { cameraConstraints } from '../lib/video-manager';
import { UserProfileDialog, type UserProfileTarget } from './UserProfileDialog';
import { CallInviteFriendsDialog, type CallInviteFriend } from './CallInviteFriendsDialog';
import {
  remainingConversationWaitMs,
  WAITING_PARTICIPANT_CARD_MS,
} from '../lib/conversation-call-lifecycle';
import {
  leaveWindowFullscreen,
  toggleMediaFullscreen,
  type FullscreenMode,
} from '../lib/fullscreen';

export type PeerUiState = Record<
  string,
  { connection: RTCPeerConnectionState | 'new'; speaking: boolean; hasAudio: boolean }
>;

export type RemoteVideoUiState = Record<string, { camera?: MediaStream; screen?: MediaStream }>;

export interface WaitingCallParticipant {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
}

const SCREEN_STAGE_BOTTOM_GAP = 10;

interface RoomViewProps {
  conversation?: boolean;
  conversationType?: 'direct' | 'group';
  conversationHidden?: boolean;
  onConversationToggle?(): void;
  cameraPreviewRequest?: number;
  embedded?: boolean;
  viewerId?: string;
  roomId: string;
  selfId: string;
  participants: Participant[];
  waitingParticipants?: WaitingCallParticipant[];
  peerState: PeerUiState;
  localSpeaking: boolean;
  localVideo: LocalVideoState;
  remoteVideos: RemoteVideoUiState;
  videoBusy: boolean;
  muted: boolean;
  roomStartedAt: number;
  reactions: Array<{ id: string; participantId: string; reaction: Reaction }>;
  roomChatMessages: RoomChatMessage[];
  screenFocusMode: boolean;
  signalingState: SignalingState;
  signalStrength?: number;
  reconnectAttempt: number;
  settings: LocalSettings;
  inviteCopied: boolean;
  turnAvailable: boolean;
  recordingState: ScreenRecordingState;
  recordingBannerMessage: string;
  devices: { inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[]; cameras: MediaDeviceInfo[] };
  friends?: CallInviteFriend[];
  onCopyInvite(): void;
  onInviteFriends?(userIds: string[]): Promise<boolean>;
  onMute(): void;
  onCamera(): void;
  onInputDevice(deviceId: string): void;
  onOutputDevice(deviceId: string): void;
  onCameraDevice(deviceId: string): void;
  onCameraBackground(
    deviceId: string,
    mode: CameraBackgroundMode,
    dataUrl: string,
    previewAlways: boolean,
  ): void;
  onScreen(): void;
  onReaction(reaction: Reaction): void;
  onRoomChatSend(text: string): boolean;
  onScreenFocusChange(active: boolean): void;
  onSettings(): void;
  onRecording(): void;
  onRecordingBannerClose(): void;
  onLeave(): void;
  onPeerVolume(peerId: string, value: number): void;
  onScreenVolume(peerId: string, value: number): void;
  onPeerMute(peerId: string): void;
  onModerationMute(peerId: string, name: string): void;
}

export function RoomView({
  conversation = false,
  conversationType,
  conversationHidden = false,
  onConversationToggle,
  cameraPreviewRequest = 0,
  embedded = false,
  viewerId,
  roomId,
  selfId,
  participants,
  waitingParticipants = [],
  peerState,
  localSpeaking,
  localVideo,
  remoteVideos,
  videoBusy,
  muted,
  roomStartedAt,
  reactions,
  roomChatMessages,
  screenFocusMode,
  signalingState,
  signalStrength = 100,
  reconnectAttempt,
  settings,
  inviteCopied,
  turnAvailable,
  recordingState,
  recordingBannerMessage,
  devices,
  friends = [],
  onCopyInvite,
  onInviteFriends,
  onMute,
  onCamera,
  onInputDevice,
  onOutputDevice,
  onCameraDevice,
  onCameraBackground,
  onScreen,
  onReaction,
  onRoomChatSend,
  onScreenFocusChange,
  onSettings,
  onRecording,
  onRecordingBannerClose,
  onLeave,
  onPeerVolume,
  onScreenVolume,
  onPeerMute,
  onModerationMute,
}: RoomViewProps) {
  const [menuFor, setMenuFor] = useState<string>();
  const [reactionMenuOpen, setReactionMenuOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatClosing, setChatClosing] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [deviceMenu, setDeviceMenu] = useState<'audio' | 'camera'>();
  const [cameraPreviewOpen, setCameraPreviewOpen] = useState(false);
  useEffect(() => {
    if (cameraPreviewRequest) setCameraPreviewOpen(true);
  }, [cameraPreviewRequest]);
  const [callFullscreen, setCallFullscreen] = useState(false);
  const callFullscreenMode = useRef<FullscreenMode | 'detached-window'>('none');
  const callFullscreenBusy = useRef(false);
  const [fullscreenCameraId, setFullscreenCameraId] = useState<string>();
  const [callDetached, setCallDetached] = useState(false);
  const [callControlsVisible, setCallControlsVisible] = useState(false);
  const [presentationParticipantsVisible, setPresentationParticipantsVisible] = useState(true);
  const [fullProfileTarget, setFullProfileTarget] = useState<UserProfileTarget>();
  const [friendsInviteOpen, setFriendsInviteOpen] = useState(false);
  const [waitingCardsVisible, setWaitingCardsVisible] = useState(false);
  const roomShellRef = useRef<HTMLElement>(null);
  const participantActionDrawerRef = useRef<HTMLElement>(null);
  const callControlsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const callDetachedRef = useRef(false);
  const knownChatMessages = useRef(new Set(roomChatMessages.map((message) => message.id)));
  const chatOpenRef = useRef(chatOpen);
  const hasConversationPeer = participants.some((participant) => participant.id !== selfId);
  const conversationBuffering = conversation && !hasConversationPeer;
  const elapsed = useCallDuration(roomStartedAt);
  const ordered = [...participants].sort(
    (a, b) => Number(b.id === selfId) - Number(a.id === selfId) || a.connectedAt - b.connectedAt,
  );
  const self = participants.find((participant) => participant.id === selfId);
  const openSlots = Math.max(0, ROOM_MAX_PARTICIPANTS - participants.length);
  const visibleWaitingParticipants = waitingCardsVisible ? waitingParticipants : [];
  const participantMedia = (participant: Participant) =>
    participant.id === selfId
      ? { camera: localVideo.cameraStream, screen: localVideo.screenStream }
      : (remoteVideos[participant.id] ?? {});
  const screenPresenters = ordered.filter((participant) =>
    Boolean(participantMedia(participant).screen),
  );
  const screenPresenter = screenPresenters[0];
  const hasCamera = ordered.some((participant) => Boolean(participantMedia(participant).camera));
  const roomMode = screenPresenter ? 'presentation' : hasCamera ? 'camera' : 'audio';
  const focusedCameraParticipant = fullscreenCameraId
    ? ordered.find((participant) => participant.id === fullscreenCameraId)
    : undefined;
  const focusedCameraStream = focusedCameraParticipant
    ? participantMedia(focusedCameraParticipant).camera
    : undefined;
  const actionParticipant = menuFor
    ? ordered.find((participant) => participant.id === menuFor)
    : undefined;
  const revealCallControls = useCallback(() => {
    setCallControlsVisible(true);
    if (callControlsTimer.current) clearTimeout(callControlsTimer.current);
    callControlsTimer.current = setTimeout(() => setCallControlsVisible(false), 1000);
  }, []);

  useEffect(() => {
    if (conversation && (conversationHidden || callFullscreen)) setFriendsInviteOpen(false);
  }, [callFullscreen, conversation, conversationHidden]);

  useEffect(
    () => () => {
      if (callControlsTimer.current) clearTimeout(callControlsTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!conversation || !roomStartedAt || waitingParticipants.length === 0) {
      setWaitingCardsVisible(false);
      return;
    }
    const remaining = remainingConversationWaitMs(roomStartedAt, WAITING_PARTICIPANT_CARD_MS);
    if (remaining <= 0) {
      setWaitingCardsVisible(false);
      return;
    }
    setWaitingCardsVisible(true);
    const timer = window.setTimeout(() => setWaitingCardsVisible(false), remaining);
    return () => window.clearTimeout(timer);
  }, [conversation, roomId, roomStartedAt, waitingParticipants.length]);

  useEffect(() => {
    chatOpenRef.current = chatOpen;
    if (chatOpen) setUnreadChatCount(0);
  }, [chatOpen]);

  useEffect(() => {
    if (!deviceMenu) return;
    const closeDeviceMenu = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.dock-device-menu') || target.closest('.dock-device-arrow')) return;
      setDeviceMenu(undefined);
    };
    document.addEventListener('mousedown', closeDeviceMenu);
    return () => document.removeEventListener('mousedown', closeDeviceMenu);
  }, [deviceMenu]);

  useEffect(() => {
    let unread = 0;
    for (const message of roomChatMessages) {
      if (knownChatMessages.current.has(message.id)) continue;
      knownChatMessages.current.add(message.id);
      if (!chatOpenRef.current && message.participantId !== selfId) unread += 1;
    }
    if (unread) setUnreadChatCount((count) => Math.min(99, count + unread));
  }, [roomChatMessages, selfId]);

  useEffect(() => {
    if (!screenPresenter && screenFocusMode) onScreenFocusChange(false);
  }, [onScreenFocusChange, screenFocusMode, screenPresenter]);

  const closeFocusedCamera = useCallback(() => {
    setFullscreenCameraId(undefined);
    setMenuFor(undefined);
  }, []);

  useEffect(() => {
    if (fullscreenCameraId && !focusedCameraStream) closeFocusedCamera();
  }, [closeFocusedCamera, focusedCameraStream, fullscreenCameraId]);

  useEffect(() => {
    if (!fullscreenCameraId && !menuFor) return;
    const onFocusedCameraKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (menuFor) setMenuFor(undefined);
      else closeFocusedCamera();
    };
    window.addEventListener('keydown', onFocusedCameraKeyDown);
    return () => window.removeEventListener('keydown', onFocusedCameraKeyDown);
  }, [closeFocusedCamera, fullscreenCameraId, menuFor]);

  useEffect(() => {
    if (!menuFor) return;
    const closeParticipantActionsOutside = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (participantActionDrawerRef.current?.contains(target)) return;
      if (
        target instanceof Element &&
        target.closest('[aria-controls="participant-action-drawer"]')
      )
        return;
      setMenuFor(undefined);
    };
    document.addEventListener('mousedown', closeParticipantActionsOutside);
    return () => document.removeEventListener('mousedown', closeParticipantActionsOutside);
  }, [menuFor]);

  useEffect(() => {
    callDetachedRef.current = callDetached;
    document.documentElement.classList.toggle('call-popout-active', callDetached);
    return () => document.documentElement.classList.remove('call-popout-active');
  }, [callDetached]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen('call-popout-restored', () => {
      if (callFullscreenMode.current === 'detached-window') {
        callFullscreenMode.current = 'none';
        setCallFullscreen(false);
      }
      setCallDetached(false);
    }).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    });
    return () => {
      disposed = true;
      unlisten?.();
      document.documentElement.classList.remove('call-popout-active');
      if (callDetachedRef.current) void invoke('call_popout_restore').catch(() => undefined);
    };
  }, []);

  const toggleCallFullscreen = async () => {
    if (callFullscreenBusy.current) return;
    callFullscreenBusy.current = true;
    try {
      if (callFullscreen) {
        if (callFullscreenMode.current === 'detached-window') {
          await invoke('call_popout_set_fullscreen', { fullscreen: false }).catch(() => undefined);
        } else if (callFullscreenMode.current === 'element' && document.fullscreenElement) {
          await document.exitFullscreen().catch(() => undefined);
        } else if (callFullscreenMode.current === 'window') {
          await leaveWindowFullscreen(true);
        }
        callFullscreenMode.current = 'none';
        setCallFullscreen(false);
        return;
      }
      if (callDetached) {
        await invoke('call_popout_set_fullscreen', { fullscreen: true });
        callFullscreenMode.current = 'detached-window';
        setCallFullscreen(true);
        return;
      }
      const roomShell = roomShellRef.current;
      if (!roomShell) return;
      const mode = await toggleMediaFullscreen(roomShell).catch(() => 'none' as const);
      callFullscreenMode.current = mode;
      setCallFullscreen(mode !== 'none');
    } finally {
      callFullscreenBusy.current = false;
    }
  };

  useEffect(() => {
    const syncElementFullscreen = () => {
      if (callFullscreenMode.current !== 'element' || document.fullscreenElement) return;
      callFullscreenMode.current = 'none';
      setCallFullscreen(false);
    };
    document.addEventListener('fullscreenchange', syncElementFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', syncElementFullscreen);
      if (callFullscreenMode.current === 'detached-window')
        void invoke('call_popout_set_fullscreen', { fullscreen: false }).catch(() => undefined);
      else if (callFullscreenMode.current === 'window') void leaveWindowFullscreen(true);
      else if (callFullscreenMode.current === 'element' && document.fullscreenElement)
        void document.exitFullscreen().catch(() => undefined);
      callFullscreenMode.current = 'none';
    };
  }, []);

  const toggleCameraFullscreen = (participantId: string) => {
    setMenuFor(undefined);
    setFullscreenCameraId((active) => (active === participantId ? undefined : participantId));
  };

  const toggleCallPopout = async () => {
    if (callFullscreenBusy.current) return;
    if (callDetached && callFullscreenMode.current === 'detached-window') {
      await invoke('call_popout_set_fullscreen', { fullscreen: false }).catch(() => undefined);
      callFullscreenMode.current = 'none';
      setCallFullscreen(false);
    }
    const nextDetached = !callDetached;
    setCallDetached(nextDetached);
    await invoke(nextDetached ? 'call_popout_open' : 'call_popout_restore').catch(() => {
      setCallDetached(!nextDetached);
    });
  };

  const closeRoomChat = () => {
    if (chatOpen && !chatClosing) setChatClosing(true);
  };

  const toggleRoomChat = () => {
    if (chatOpen) closeRoomChat();
    else {
      setChatClosing(false);
      setChatOpen(true);
    }
  };

  const renderParticipant = (participant: Participant, compact = false) => {
    const isSelf = participant.id === selfId;
    const speaking = isSelf ? localSpeaking : peerState[participant.id]?.speaking;
    const connection = isSelf ? 'connected' : (peerState[participant.id]?.connection ?? 'new');
    const hasAudio = isSelf || (peerState[participant.id]?.hasAudio ?? false);
    const locallyMuted = settings.mutedPeers[participant.id] ?? false;
    const canModerate = Boolean(conversationType !== 'direct' && self?.isOwner && !isSelf);
    const media = participantMedia(participant);
    const showCamera = Boolean(media.camera);
    const cardStyle = participant.cardStyle ?? 'avatar-glass';
    const cardDecoration = participant.cardDecoration ?? 'none';
    const status = participant.muted
      ? 'Микрофон выключен'
      : speaking
        ? 'Говорит'
        : connectionLabel(connection, hasAudio);

    return (
      <article
        className={`participant-card ${compact ? 'compact-tile' : ''} ${showCamera ? 'camera-tile media-surface' : `audio-tile ${participant.avatar && cardStyle === 'avatar-glass' ? 'avatar-glass' : ''}`} ${!isSelf || canModerate ? 'has-participant-menu' : ''} ${speaking ? 'speaking' : ''} ${participant.muted ? 'mic-muted' : ''}`}
        data-camera-participant-id={showCamera ? participant.id : undefined}
        role="listitem"
        key={participant.id}
        onClick={(event) => {
          if (!showCamera) return;
          const target = event.target;
          if (target instanceof Element && target.closest('button, input, label')) return;
          toggleCameraFullscreen(participant.id);
        }}
      >
        {!showCamera && participant.avatar && cardStyle === 'avatar-glass' && (
          <span className="participant-card-ambient" aria-hidden="true">
            <CachedMediaImage src={participant.avatar} alt="" />
          </span>
        )}
        {!showCamera && cardDecoration !== 'none' && (
          <img
            className="participant-card-decoration"
            src={`/card-decorations/${cardDecoration}.png`}
            alt=""
            draggable={false}
          />
        )}
        {showCamera && (
          <ParticipantVideo
            stream={media.camera!}
            source="camera"
            name={participant.name}
            mirrored
            muted
            volume={0}
            outputDeviceId={settings.outputDeviceId}
            showExpand={false}
          />
        )}
        <div className="participant-card-top media-overlay-top">
          {participant.isOwner && conversationType !== 'direct' ? (
            <CreatorBadge compact={showCamera || compact} group={conversationType === 'group'} />
          ) : (
            <span />
          )}
          <ParticipantActions
            participant={participant}
            isSelf={isSelf}
            canModerate={canModerate}
            open={menuFor === participant.id}
            onToggle={() =>
              setMenuFor((old) => (old === participant.id ? undefined : participant.id))
            }
          />
        </div>

        {!showCamera && (
          <ParticipantAvatar
            participant={participant}
            speaking={Boolean(speaking)}
            onOpenProfile={
              viewerId && participant.avatar && participant.accountId
                ? () =>
                    setFullProfileTarget({
                      id: participant.accountId!,
                      displayName: participant.name,
                      avatarUrl: participant.avatar,
                      presence: 'online',
                    })
                : undefined
            }
          />
        )}

        <div
          className={showCamera ? 'participant-overlay media-overlay-bottom' : 'participant-info'}
        >
          <div className="participant-name-row">
            <div className="participant-name">
              <strong>{participant.name}</strong>
              {isSelf && <span>вы</span>}
            </div>
            {!compact && <VoiceWave active={Boolean(speaking)} compact />}
          </div>
          <div
            className={`participant-status ${participant.muted ? 'muted' : speaking ? 'live' : ''}`}
          >
            {participant.muted ? <MicOff size={13} /> : <i />}
            {status}
          </div>
        </div>

        {!isSelf && !compact && (
          <ParticipantVolume
            participant={participant}
            locallyMuted={locallyMuted}
            value={settings.peerVolumes[participant.id] ?? 1}
            onPeerMute={onPeerMute}
            onPeerVolume={onPeerVolume}
          />
        )}
      </article>
    );
  };

  const roomContent = (
    <main
      ref={roomShellRef}
      className={`room-shell ${conversation ? 'conversation-room' : ''} ${conversation && !conversationHidden ? 'conversation-call-compact' : ''} ${conversationHidden ? 'conversation-chat-hidden' : ''} ${embedded ? 'room-shell-embedded' : ''} ${chatOpen ? 'room-chat-open' : ''} ${screenFocusMode ? 'screen-focus-mode' : ''} ${roomMode === 'presentation' ? 'has-presentation' : ''} ${callFullscreen ? 'call-fullscreen' : ''} ${callControlsVisible || deviceMenu || reactionMenuOpen ? 'call-controls-visible' : ''}`}
      onPointerMove={revealCallControls}
    >
      <div className="room-connection-flyout">
        <ConnectionStatus
          state={signalingState}
          attempt={reconnectAttempt}
          strength={signalStrength}
          buffering={conversationBuffering}
        />
      </div>

      <div className="room-session-meta">
        <span
          className="room-security"
          title={turnAvailable ? 'WebRTC с резервным TURN-маршрутом' : 'Прямое WebRTC-соединение'}
        >
          <ShieldCheck size={14} /> Приватное соединение
        </span>
        <span
          className={`call-timer${conversationBuffering ? ' buffering' : ''}`}
          aria-label={
            conversationBuffering ? 'Ожидание подключения' : `Длительность звонка ${elapsed}`
          }
        >
          <i /> {conversationBuffering ? 'Ожидание' : elapsed}
        </span>
      </div>

      {conversation &&
        !conversationHidden &&
        !callFullscreen &&
        onInviteFriends &&
        openSlots > 0 && (
          <button
            className="conversation-invite"
            aria-label="Добавить друга в групповой звонок"
            title="Добавить друга — продолжить в группе"
            onClick={() => setFriendsInviteOpen(true)}
          >
            <UserPlus size={18} />
          </button>
        )}
      {recordingBannerMessage && (
        <div className="recording-start-banner" role="status">
          <span>
            <i /> {recordingBannerMessage}
          </span>
          <button onClick={onRecordingBannerClose}>ОК</button>
        </div>
      )}

      <div className="room-body-layout">
        <section className={`room-main room-mode-${roomMode}`}>
          <div className="participants-heading">
            <div>
              <h1>Участники</h1>
              <p>
                {participants.length} из {ROOM_MAX_PARTICIPANTS}
              </p>
            </div>
          </div>

          {screenPresenter ? (
            <div className="presentation-layout">
              <div className="presentation-stage-grid" data-count={screenPresenters.length}>
                {screenPresenters.map((presenter) => (
                  <ScreenShareStage
                    key={presenter.id}
                    presenter={presenter}
                    stream={participantMedia(presenter).screen!}
                    selfId={selfId}
                    constrainFullscreenToWorkspace={Boolean(
                      embedded && !callFullscreen && !callDetached,
                    )}
                    conversationType={conversationType}
                    outputDeviceId={settings.outputDeviceId}
                    volume={settings.screenVolumes[presenter.id] ?? 1}
                    onVolume={onScreenVolume}
                  />
                ))}
              </div>
              <div
                className={`presentation-participants ${presentationParticipantsVisible ? 'visible' : 'collapsed'}`}
              >
                <div className="participant-strip" role="list" aria-label="Участники комнаты">
                  {ordered.map((participant) => renderParticipant(participant, true))}
                  {openSlots > 0 && (!conversation || (!conversationHidden && !callFullscreen)) && (
                    <InviteCallout
                      compact
                      openSlots={openSlots}
                      onOpen={() => (onInviteFriends ? setFriendsInviteOpen(true) : onCopyInvite())}
                    />
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div
              className="participants-grid"
              data-count={participants.length + visibleWaitingParticipants.length}
              data-mode={roomMode}
              role="list"
            >
              {ordered.map((participant) => renderParticipant(participant))}
              {visibleWaitingParticipants.map((participant) => (
                <WaitingParticipantCard participant={participant} key={participant.id} />
              ))}
              {openSlots > 0 && (!conversation || (!conversationHidden && !callFullscreen)) && (
                <InviteCallout
                  openSlots={openSlots}
                  onOpen={() => (onInviteFriends ? setFriendsInviteOpen(true) : onCopyInvite())}
                />
              )}
            </div>
          )}
        </section>

        {chatOpen && (
          <RoomChatPanel
            messages={roomChatMessages.map((message) => ({
              ...message,
              senderAvatar:
                participants.find((participant) => participant.id === message.participantId)
                  ?.avatar ?? message.senderAvatar,
            }))}
            selfId={selfId}
            closing={chatClosing}
            onClose={closeRoomChat}
            onClosed={() => {
              setChatOpen(false);
              setChatClosing(false);
            }}
            onSend={onRoomChatSend}
          />
        )}
      </div>

      {focusedCameraParticipant && focusedCameraStream && (
        <section
          className={`camera-focus-overlay${embedded && !callFullscreen && !callDetached ? ' media-workspace-fullscreen-shell' : ''}`}
          aria-label={`Раскрытая камера ${focusedCameraParticipant.name}`}
          onClick={(event) => {
            const target = event.target;
            if (target instanceof Element && target.closest('button, input, label')) return;
            closeFocusedCamera();
          }}
        >
          <ParticipantVideo
            stream={focusedCameraStream}
            source="camera"
            name={focusedCameraParticipant.name}
            mirrored
            muted
            volume={0}
            outputDeviceId={settings.outputDeviceId}
            showExpand={false}
          />
          <div className="participant-card-top media-overlay-top">
            {focusedCameraParticipant.isOwner && conversationType !== 'direct' ? (
              <CreatorBadge compact group={conversationType === 'group'} />
            ) : (
              <span />
            )}
            <ParticipantActions
              participant={focusedCameraParticipant}
              isSelf={focusedCameraParticipant.id === selfId}
              canModerate={Boolean(
                conversationType !== 'direct' &&
                self?.isOwner &&
                focusedCameraParticipant.id !== selfId,
              )}
              open={menuFor === focusedCameraParticipant.id}
              onToggle={() =>
                setMenuFor((old) =>
                  old === focusedCameraParticipant.id ? undefined : focusedCameraParticipant.id,
                )
              }
            />
          </div>
          <div className="participant-overlay media-overlay-bottom">
            <div className="participant-name">
              <strong>{focusedCameraParticipant.name}</strong>
              {focusedCameraParticipant.id === selfId && <span>вы</span>}
            </div>
          </div>
        </section>
      )}

      {actionParticipant && (
        <aside
          ref={participantActionDrawerRef}
          id="participant-action-drawer"
          className="participant-action-drawer"
          role="dialog"
          aria-label={`Управление участником ${actionParticipant.name}`}
        >
          <header>
            <span className="participant-action-avatar" aria-hidden="true">
              {actionParticipant.avatar ? (
                <CachedMediaImage src={actionParticipant.avatar} alt="" />
              ) : (
                actionParticipant.name.slice(0, 1).toUpperCase()
              )}
            </span>
            <span>
              <small>Управление участником</small>
              <strong>{actionParticipant.name}</strong>
            </span>
            <button
              type="button"
              className="icon-button participant-action-close"
              aria-label="Закрыть управление участником"
              onClick={() => setMenuFor(undefined)}
            >
              <X size={17} />
            </button>
          </header>
          {actionParticipant.id !== selfId && (
            <button
              type="button"
              role="menuitem"
              aria-label={
                settings.mutedPeers[actionParticipant.id] ? 'Вернуть звук' : 'Не слышать локально'
              }
              onClick={() => {
                onPeerMute(actionParticipant.id);
                setMenuFor(undefined);
              }}
            >
              {settings.mutedPeers[actionParticipant.id] ? (
                <Volume2 size={17} />
              ) : (
                <VolumeX size={17} />
              )}
              <span>
                <strong>
                  {settings.mutedPeers[actionParticipant.id]
                    ? 'Вернуть звук'
                    : 'Не слышать локально'}
                </strong>
                <small>Изменение действует только для вас</small>
              </span>
            </button>
          )}
          {conversationType !== 'direct' && self?.isOwner && actionParticipant.id !== selfId && (
            <button
              type="button"
              role="menuitem"
              className="danger-action"
              aria-label={actionParticipant.muted ? 'Микрофон уже выключен' : 'Выключить микрофон'}
              disabled={actionParticipant.muted}
              onClick={() => {
                onModerationMute(actionParticipant.id, actionParticipant.name);
                setMenuFor(undefined);
              }}
            >
              <MicOff size={17} />
              <span>
                <strong>
                  {actionParticipant.muted ? 'Микрофон уже выключен' : 'Выключить микрофон'}
                </strong>
                <small>Для всех участников звонка</small>
              </span>
            </button>
          )}
        </aside>
      )}

      <div className="reaction-burst-layer" aria-live="polite">
        {reactions.map((item) => {
          const participant = participants.find((entry) => entry.id === item.participantId);
          return (
            <span className="reaction-burst" key={item.id}>
              <b>{item.reaction}</b>
              <small>{participant?.name ?? 'Участник'}</small>
            </span>
          );
        })}
      </div>

      {conversation && !callFullscreen && (
        <button
          className="conversation-chat-hide"
          aria-label={conversationHidden ? 'Показать чат' : 'Скрыть чат'}
          aria-expanded={!conversationHidden}
          onClick={onConversationToggle}
        >
          <MessageCircle size={14} />
          <span>{conversationHidden ? 'Показать чат' : 'Скрыть чат'}</span>
        </button>
      )}

      <div className="call-view-controls" aria-label="Режим отображения звонка">
        <button
          aria-label={
            callDetached ? 'Вернуть звонок в основное окно' : 'Открыть звонок в отдельном окне'
          }
          data-tooltip={callDetached ? 'Вернуть в основное окно' : 'В отдельном окне'}
          onClick={() => void toggleCallPopout()}
        >
          <PictureInPicture2 size={19} />
        </button>
        <button
          aria-label={
            callFullscreen ? 'Выйти из полноэкранного режима' : 'Открыть звонок во весь экран'
          }
          data-tooltip={callFullscreen ? 'Выйти из полноэкранного режима' : 'Полноэкранный режим'}
          onClick={() => void toggleCallFullscreen()}
        >
          {callFullscreen ? <Minimize2 size={19} /> : <Maximize2 size={19} />}
        </button>
      </div>

      <footer className="voice-dock" aria-label="Управление звонком">
        {screenPresenter && (
          <button
            className={`presentation-participants-dock-toggle ${presentationParticipantsVisible ? 'active' : ''}`}
            aria-expanded={presentationParticipantsVisible}
            aria-label={
              presentationParticipantsVisible ? 'Скрыть участников' : 'Показать участников'
            }
            title={presentationParticipantsVisible ? 'Скрыть участников' : 'Показать участников'}
            onMouseDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              setPresentationParticipantsVisible((visible) => !visible);
            }}
            onClick={(event) => {
              if (event.detail !== 0) return;
              setPresentationParticipantsVisible((visible) => !visible);
            }}
          >
            <Users size={19} />
            {presentationParticipantsVisible ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
        <div className="dock-island dock-primary-actions">
          <div className={`dock-split-control ${muted ? 'device-off' : 'device-on'}`}>
            <button
              className={`dock-control mic-control ${muted ? 'muted' : 'active'}`}
              aria-label={muted ? 'Включить микрофон' : 'Выключить микрофон'}
              aria-pressed={!muted}
              title={muted ? 'Включить микрофон' : 'Выключить микрофон'}
              onClick={onMute}
            >
              <span className="dock-icon">{muted ? <MicOff /> : <Mic />}</span>
            </button>
            <button
              className="dock-device-arrow"
              aria-label="Выбрать аудиоустройство"
              aria-expanded={deviceMenu === 'audio'}
              onClick={() => setDeviceMenu((menu) => (menu === 'audio' ? undefined : 'audio'))}
            >
              <ChevronUp size={15} />
            </button>
            {deviceMenu === 'audio' && (
              <DeviceMenu
                type="audio"
                devices={devices}
                settings={settings}
                onInput={onInputDevice}
                onOutput={onOutputDevice}
                onCamera={onCameraDevice}
                onClose={() => setDeviceMenu(undefined)}
              />
            )}
          </div>
          <div
            className={`dock-split-control ${localVideo.cameraEnabled ? 'device-on' : 'device-off'}`}
          >
            <button
              className={`dock-control video-control ${localVideo.cameraEnabled ? 'active' : ''}`}
              aria-busy={videoBusy}
              aria-label={localVideo.cameraEnabled ? 'Выключить камеру' : 'Включить камеру'}
              aria-pressed={localVideo.cameraEnabled}
              title={localVideo.cameraEnabled ? 'Выключить камеру' : 'Включить камеру'}
              disabled={videoBusy}
              onClick={() => {
                if (localVideo.cameraEnabled || !settings.cameraPreviewAlways) onCamera();
                else setCameraPreviewOpen(true);
              }}
            >
              <span className="dock-icon">
                {localVideo.cameraEnabled ? <Camera /> : <CameraOff />}
              </span>
            </button>
            <button
              className="dock-device-arrow"
              aria-label="Выбрать камеру"
              aria-expanded={deviceMenu === 'camera'}
              onClick={() => setDeviceMenu((menu) => (menu === 'camera' ? undefined : 'camera'))}
            >
              <ChevronUp size={15} />
            </button>
            {deviceMenu === 'camera' && (
              <DeviceMenu
                type="camera"
                devices={devices}
                settings={settings}
                onInput={onInputDevice}
                onOutput={onOutputDevice}
                onCamera={onCameraDevice}
                onCameraPreview={() => setCameraPreviewOpen(true)}
                onVideoSettings={onSettings}
                onClose={() => setDeviceMenu(undefined)}
              />
            )}
          </div>
        </div>
        <div className="dock-island dock-secondary-actions">
          <button
            className={`dock-control video-control screen-control ${localVideo.screenEnabled ? 'active sharing' : ''}`}
            aria-busy={videoBusy}
            aria-label={
              localVideo.screenEnabled ? 'Остановить демонстрацию экрана' : 'Демонстрация экрана'
            }
            aria-pressed={localVideo.screenEnabled}
            title={
              localVideo.screenEnabled ? 'Остановить демонстрацию экрана' : 'Демонстрация экрана'
            }
            disabled={videoBusy}
            onClick={onScreen}
          >
            <span className="dock-icon">
              {localVideo.screenEnabled ? <Square /> : <MonitorUp />}
            </span>
          </button>
          {(conversationType === 'direct' || self?.isOwner) && (
            <button
              className={`dock-control dock-control-secondary dock-recording-control ${recordingState.phase === 'recording' ? 'active' : ''}`}
              aria-label={
                recordingState.phase === 'recording'
                  ? 'Остановить запись экрана'
                  : recordingState.phase === 'saving'
                    ? 'Запись сохраняется'
                    : 'Начать запись экрана'
              }
              title={
                recordingState.phase === 'recording'
                  ? 'Остановить запись'
                  : recordingState.phase === 'saving'
                    ? 'Запись сохраняется'
                    : 'Запись'
              }
              disabled={recordingState.phase === 'saving'}
              onClick={onRecording}
            >
              <span className="dock-icon">
                {recordingState.phase === 'recording' ? <Square /> : <CircleDot />}
              </span>
            </button>
          )}
          <div className="reaction-control">
            <button
              className={`dock-control dock-control-secondary reaction-button ${reactionMenuOpen ? 'active' : ''}`}
              aria-label="Отправить реакцию"
              aria-expanded={reactionMenuOpen}
              title="Отправить реакцию"
              onClick={() => setReactionMenuOpen((open) => !open)}
            >
              <span className="dock-icon">
                <SmilePlus />
              </span>
            </button>
            {reactionMenuOpen && (
              <div className="reaction-menu" role="menu" aria-label="Реакции">
                {(['👍', '❤️', '😂', '🎉', '🔥'] as const).map((reaction) => (
                  <button
                    key={reaction}
                    role="menuitem"
                    aria-label={`Отправить реакцию ${reaction}`}
                    onClick={() => {
                      onReaction(reaction);
                      setReactionMenuOpen(false);
                    }}
                  >
                    {reaction}
                  </button>
                ))}
              </div>
            )}
          </div>
          {!conversation && (
            <button
              className={`dock-control dock-control-secondary room-chat-control ${(conversation ? !conversationHidden : chatOpen) ? 'active' : ''}`}
              aria-label={
                conversation
                  ? 'Показать чат'
                  : unreadChatCount > 0
                    ? `Чат комнаты, непрочитанных сообщений: ${unreadChatCount}`
                    : 'Чат комнаты'
              }
              aria-expanded={conversation ? !conversationHidden : chatOpen}
              title={conversation ? 'Показать чат' : 'Чат комнаты'}
              onClick={conversation ? onConversationToggle : toggleRoomChat}
            >
              <span className="dock-icon">
                <MessageCircle />
                {unreadChatCount > 0 && (
                  <b className="room-chat-badge" aria-hidden="true">
                    {unreadChatCount}
                  </b>
                )}
              </span>
            </button>
          )}
          <button
            className="dock-control dock-control-secondary"
            aria-label="Настройки аудио и устройств"
            title="Настройки аудио и устройств"
            onClick={onSettings}
          >
            <span className="dock-icon">
              <MoreHorizontal />
            </span>
          </button>
        </div>
        <button
          className="leave-button"
          aria-label="Выйти из комнаты"
          title="Выйти из комнаты"
          onClick={onLeave}
        >
          <LogOut size={18} />
        </button>
      </footer>
      {cameraPreviewOpen && (
        <CameraPreviewDialog
          devices={devices.cameras}
          settings={settings}
          cameraEnabled={localVideo.cameraEnabled}
          onApply={(deviceId, mode, dataUrl, previewAlways) => {
            onCameraBackground(deviceId, mode, dataUrl, previewAlways);
          }}
          onEnable={() => {
            if (!localVideo.cameraEnabled) onCamera();
          }}
          onClose={() => setCameraPreviewOpen(false)}
        />
      )}
      {viewerId ? (
        <UserProfileDialog
          viewerId={viewerId}
          target={fullProfileTarget}
          onClose={() => setFullProfileTarget(undefined)}
        />
      ) : null}
      {onInviteFriends ? (
        <CallInviteFriendsDialog
          open={friendsInviteOpen}
          friends={friends}
          participantAccountIds={participants.flatMap((participant) =>
            participant.accountId ? [participant.accountId] : [],
          )}
          participantCount={participants.length}
          capacity={ROOM_MAX_PARTICIPANTS}
          roomId={roomId}
          inviteCopied={inviteCopied}
          onClose={() => setFriendsInviteOpen(false)}
          onCopyInvite={onCopyInvite}
          onInvite={onInviteFriends}
        />
      ) : null}
    </main>
  );
  return roomContent;
}

function useCallDuration(startedAt: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const totalSeconds = startedAt > 0 ? Math.max(0, Math.floor((now - startedAt) / 1_000)) : 0;
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .filter((_, index) => hours > 0 || index > 0)
    .map((value) => value.toString().padStart(2, '0'))
    .join(':');
}

function DeviceMenu({
  type,
  devices,
  settings,
  onInput,
  onOutput,
  onCamera,
  onCameraPreview,
  onVideoSettings,
  onClose,
}: {
  type: 'audio' | 'camera';
  devices: { inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[]; cameras: MediaDeviceInfo[] };
  settings: LocalSettings;
  onInput(deviceId: string): void;
  onOutput(deviceId: string): void;
  onCamera(deviceId: string): void;
  onCameraPreview?(): void;
  onVideoSettings?(): void;
  onClose(): void;
}) {
  const [cameraListOpen, setCameraListOpen] = useState(false);
  const choose = (action: (deviceId: string) => void, deviceId: string) => {
    action(deviceId);
    onClose();
  };
  if (type === 'camera')
    return (
      <div className="dock-device-menu camera-device-menu" role="menu" aria-label="Камера">
        <strong>Камера</strong>
        <button
          type="button"
          className="dock-device-current"
          aria-expanded={cameraListOpen}
          aria-haspopup="menu"
          onClick={() => setCameraListOpen((open) => !open)}
        >
          <span>
            {devices.cameras.find((device) => device.deviceId === settings.cameraDeviceId)?.label ||
              'Системная камера'}
          </span>
          <ChevronRight size={16} />
        </button>
        {cameraListOpen && (
          <DeviceMenuItem
            label="Системная камера"
            selected={!settings.cameraDeviceId}
            onClick={() => choose(onCamera, '')}
          />
        )}
        {cameraListOpen &&
          devices.cameras.map((device, index) => (
            <DeviceMenuItem
              key={device.deviceId}
              label={device.label || `Камера ${index + 1}`}
              selected={settings.cameraDeviceId === device.deviceId}
              onClick={() => choose(onCamera, device.deviceId)}
            />
          ))}
        <div className="dock-device-menu-separator" />
        <button
          type="button"
          className="dock-camera-menu-action"
          onClick={() => {
            onClose();
            onCameraPreview?.();
          }}
        >
          <span>
            <Eye size={17} /> Предпросмотр камеры
          </span>
        </button>
        <button
          type="button"
          className="dock-camera-menu-action"
          onClick={() => {
            onClose();
            onVideoSettings?.();
          }}
        >
          <span>
            <SlidersHorizontal size={17} /> Настройки видео
          </span>
        </button>
      </div>
    );
  return (
    <div
      className="dock-device-menu audio-device-menu"
      role="menu"
      aria-label="Выбор аудиоустройства"
    >
      <strong>Микрофон</strong>
      <DeviceMenuItem
        label="Системный микрофон"
        selected={!settings.inputDeviceId}
        onClick={() => choose(onInput, '')}
      />
      {devices.inputs.map((device, index) => (
        <DeviceMenuItem
          key={device.deviceId}
          label={device.label || `Микрофон ${index + 1}`}
          selected={settings.inputDeviceId === device.deviceId}
          onClick={() => choose(onInput, device.deviceId)}
        />
      ))}
      <strong>Динамики</strong>
      <DeviceMenuItem
        label="Системные динамики"
        selected={!settings.outputDeviceId}
        onClick={() => choose(onOutput, '')}
      />
      {devices.outputs.map((device, index) => (
        <DeviceMenuItem
          key={device.deviceId}
          label={device.label || `Динамики ${index + 1}`}
          selected={settings.outputDeviceId === device.deviceId}
          onClick={() => choose(onOutput, device.deviceId)}
        />
      ))}
    </div>
  );
}

function CameraPreviewDialog({
  devices,
  settings,
  cameraEnabled,
  onApply,
  onEnable,
  onClose,
}: {
  devices: MediaDeviceInfo[];
  settings: LocalSettings;
  cameraEnabled: boolean;
  onApply(
    deviceId: string,
    mode: CameraBackgroundMode,
    dataUrl: string,
    previewAlways: boolean,
  ): void;
  onEnable(): void;
  onClose(): void;
}) {
  const [deviceId, setDeviceId] = useState(settings.cameraDeviceId);
  const [mode, setMode] = useState<CameraBackgroundMode>(settings.cameraBackgroundMode);
  const [dataUrl, setDataUrl] = useState(settings.cameraBackgroundDataUrl);
  const [previewAlways, setPreviewAlways] = useState(settings.cameraPreviewAlways);
  const [previewStream, setPreviewStream] = useState<MediaStream>();
  const [previewError, setPreviewError] = useState('');
  const [previewBusy, setPreviewBusy] = useState(true);
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const captureRef = useRef<CameraEffectCapture | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    let nextCapture: CameraEffectCapture | undefined;
    setPreviewBusy(true);
    setPreviewError('');
    setPreviewStream(undefined);
    if (!navigator.mediaDevices?.getUserMedia) {
      setPreviewError('Предпросмотр камеры недоступен в этой среде.');
      setPreviewBusy(false);
      return;
    }
    void navigator.mediaDevices
      .getUserMedia({ audio: false, video: cameraConstraints(deviceId) })
      .then((source) => createCameraEffectCapture(source, { mode, dataUrl }))
      .then((capture) => {
        nextCapture = capture;
        if (cancelled) {
          capture.dispose();
          return;
        }
        captureRef.current = capture;
        setPreviewStream(capture.stream);
      })
      .catch((error) => {
        if (!cancelled)
          setPreviewError(error instanceof Error ? error.message : 'Не удалось открыть камеру.');
      })
      .finally(() => {
        if (!cancelled) setPreviewBusy(false);
      });
    return () => {
      cancelled = true;
      if (captureRef.current === nextCapture) captureRef.current = undefined;
      nextCapture?.dispose();
    };
  }, [dataUrl, deviceId, mode]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = previewStream ?? null;
    if (previewStream) void video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [previewStream]);

  const close = () => {
    captureRef.current?.dispose();
    captureRef.current = undefined;
    onClose();
  };
  const apply = () => {
    captureRef.current?.dispose();
    captureRef.current = undefined;
    onApply(deviceId, mode, dataUrl, previewAlways);
    onEnable();
    onClose();
  };
  const chooseCustomBackground = async (file?: File) => {
    if (!file) return;
    try {
      setPreviewBusy(true);
      const value = await imageFileToCameraBackground(file);
      setDataUrl(value);
      setMode('custom');
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Не удалось выбрать фон.');
      setPreviewBusy(false);
    }
  };
  const selectedDeviceLabel =
    devices.find((device) => device.deviceId === deviceId)?.label || 'Системная камера';
  const chooseDevice = (nextDeviceId: string) => {
    setDeviceId(nextDeviceId);
    setDeviceMenuOpen(false);
  };

  return (
    <div className="camera-preview-backdrop" role="presentation" onMouseDown={close}>
      <section
        className="camera-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="camera-preview-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <h2 id="camera-preview-title">Готовы к видеочату?</h2>
          <button type="button" aria-label="Закрыть предпросмотр" onClick={close}>
            <X />
          </button>
        </header>
        <div className="camera-preview-stage">
          <video ref={videoRef} muted playsInline />
          {previewBusy && <span>Подготавливаем камеру…</span>}
          {previewError && <span className="camera-preview-error">{previewError}</span>}
        </div>
        <div className="camera-preview-device-picker">
          <button
            type="button"
            className="camera-preview-device"
            aria-label={`Выбрать камеру. ${selectedDeviceLabel}`}
            aria-haspopup="listbox"
            aria-expanded={deviceMenuOpen}
            onClick={() => setDeviceMenuOpen((open) => !open)}
          >
            <span className="camera-preview-device-icon">
              <Camera size={17} />
            </span>
            <span className="camera-preview-device-copy">
              <small>Камера</small>
              <strong>{selectedDeviceLabel}</strong>
            </span>
            <ChevronDown className="camera-preview-device-chevron" size={17} />
          </button>
          {deviceMenuOpen && (
            <div className="camera-preview-device-menu" role="listbox" aria-label="Камеры">
              <button
                type="button"
                role="option"
                aria-selected={!deviceId}
                onClick={() => chooseDevice('')}
              >
                <span className="camera-preview-device-option-icon">
                  <Camera size={16} />
                </span>
                <span>
                  <strong>Системная камера</strong>
                  <small>Выбирать автоматически</small>
                </span>
                {!deviceId && <Check size={16} />}
              </button>
              {devices.map((device, index) => {
                const label = device.label || `Камера ${index + 1}`;
                return (
                  <button
                    key={device.deviceId}
                    type="button"
                    role="option"
                    aria-selected={deviceId === device.deviceId}
                    onClick={() => chooseDevice(device.deviceId)}
                  >
                    <span className="camera-preview-device-option-icon">
                      <Camera size={16} />
                    </span>
                    <span>
                      <strong>{label}</strong>
                      <small>Видеоустройство</small>
                    </span>
                    {deviceId === device.deviceId && <Check size={16} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="camera-background-section">
          <strong>Фон видео</strong>
          <div className="camera-background-options">
            <button
              type="button"
              className={mode === 'none' ? 'selected' : ''}
              onClick={() => setMode('none')}
            >
              <Ban />
              <span>Пусто</span>
            </button>
            <button
              type="button"
              className={`camera-background-blur ${mode === 'blur' ? 'selected' : ''}`}
              onClick={() => setMode('blur')}
            >
              <Sparkles />
              <span>Размытие</span>
            </button>
            <button
              type="button"
              className={`camera-background-custom ${mode === 'custom' ? 'selected' : ''}`}
              style={
                dataUrl
                  ? {
                      backgroundImage: `linear-gradient(rgba(3, 10, 21, 0.28), rgba(3, 10, 21, 0.52)), url(${dataUrl})`,
                    }
                  : undefined
              }
              onClick={() => (dataUrl ? setMode('custom') : fileRef.current?.click())}
            >
              <ImagePlus />
              <span>Свой фон</span>
            </button>
          </div>
          <button
            type="button"
            className="camera-background-upload"
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus size={16} /> {dataUrl ? 'Заменить свой фон' : 'Выбрать изображение'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(event) => void chooseCustomBackground(event.target.files?.[0])}
          />
        </div>
        <footer>
          <label>
            <input
              type="checkbox"
              checked={previewAlways}
              onChange={(event) => setPreviewAlways(event.target.checked)}
            />
            <span>Предпросмотр видео (всегда)</span>
          </label>
          <button
            type="button"
            className="camera-preview-confirm"
            disabled={previewBusy || Boolean(previewError)}
            onClick={apply}
          >
            {cameraEnabled ? 'Применить' : 'Включить камеру'}
          </button>
        </footer>
      </section>
    </div>
  );
}

function DeviceMenuItem({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick(): void;
}) {
  return (
    <button role="menuitemradio" aria-checked={selected} onClick={onClick}>
      <span>{label}</span>
      {selected && <Check size={15} />}
    </button>
  );
}

function ScreenShareStage({
  presenter,
  stream,
  selfId,
  constrainFullscreenToWorkspace,
  conversationType,
  outputDeviceId,
  volume,
  onVolume,
}: {
  presenter: Participant;
  stream: MediaStream;
  selfId: string;
  constrainFullscreenToWorkspace: boolean;
  conversationType?: 'direct' | 'group';
  outputDeviceId: string;
  volume: number;
  onVolume(participantId: string, volume: number): void;
}) {
  const slotRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>();
  const [fullscreen, setFullscreen] = useState(false);
  const [playbackMetrics, setPlaybackMetrics] = useState({ width: 0, height: 0, fps: 0 });
  const updatePlaybackMetrics = useCallback(
    (metrics: { width: number; height: number; fps: number }) =>
      setPlaybackMetrics((current) =>
        current.width === metrics.width &&
        current.height === metrics.height &&
        current.fps === metrics.fps
          ? current
          : metrics,
      ),
    [],
  );

  useEffect(() => {
    const slot = slotRef.current;
    if (!slot || typeof ResizeObserver === 'undefined') return;
    const resize = () => {
      const bounds = slot.getBoundingClientRect();
      const roomBounds = slot.closest<HTMLElement>('.room-shell')?.getBoundingClientRect();
      const viewportHeight = Math.min(
        window.innerHeight,
        document.documentElement.clientHeight || window.innerHeight,
      );
      const visibleBottom = Math.min(viewportHeight, roomBounds?.bottom ?? viewportHeight);
      const availableWidth = Math.max(0, bounds.width);
      const availableHeight = Math.max(
        0,
        Math.min(bounds.height, visibleBottom - bounds.top) - SCREEN_STAGE_BOTTOM_GAP,
      );
      const width = Math.min(availableWidth, availableHeight * aspectRatio);
      const height = width / aspectRatio;
      setStageSize((current) =>
        current && Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
          ? current
          : { width, height },
      );
    };
    const observer = new ResizeObserver(resize);
    observer.observe(slot);
    window.addEventListener('resize', resize);
    resize();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [aspectRatio]);

  const toggleFullscreen = () => setFullscreen((active) => !active);

  return (
    <div className="presentation-stage-slot" ref={slotRef}>
      <div
        className={`screen-stage-shell ${fullscreen ? `media-fullscreen-shell${constrainFullscreenToWorkspace ? ' media-workspace-fullscreen-shell' : ''}` : ''}`}
        style={
          {
            '--screen-aspect-ratio': aspectRatio,
            ...(stageSize
              ? { width: `${stageSize.width}px`, height: `${stageSize.height}px` }
              : {}),
          } as CSSProperties
        }
      >
        <div className="screen-stage-toolbar">
          <span className="screen-stage-title">
            <MonitorUp size={15} />
            <span>
              <strong>{presenter.name}</strong>
              <small>Демонстрация экрана</small>
            </span>
          </span>
          <span className="screen-stage-creator">
            {presenter.isOwner && conversationType !== 'direct' && (
              <CreatorBadge compact group={conversationType === 'group'} />
            )}
          </span>
          <span className="screen-stage-quality">
            <span aria-label="Параметры демонстрации экрана">
              {playbackMetrics.width > 0 && playbackMetrics.height > 0
                ? `${playbackMetrics.width}×${playbackMetrics.height}`
                : 'Определяем качество'}
              {playbackMetrics.fps > 0 && ` · ${playbackMetrics.fps} FPS`}
            </span>
            <button
              type="button"
              className="screen-stage-expand"
              aria-label={
                fullscreen ? 'Свернуть демонстрацию экрана' : 'Развернуть демонстрацию экрана'
              }
              aria-pressed={fullscreen}
              onClick={(event) => {
                event.stopPropagation();
                toggleFullscreen();
              }}
            >
              {fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
            </button>
          </span>
        </div>
        <article
          ref={stageRef}
          className={`screen-stage media-surface ${fullscreen ? 'screen-stage-window-fullscreen' : ''}`}
          aria-label={`Демонстрация экрана ${presenter.name}`}
          onClick={(event) => {
            const target = event.target;
            if (target instanceof Element && target.closest('.screen-stage-volume')) return;
            toggleFullscreen();
          }}
        >
          <ParticipantVideo
            stream={stream}
            source="screen"
            name={presenter.name}
            muted
            volume={0}
            outputDeviceId={outputDeviceId}
            showExpand={false}
            onAspectRatioChange={setAspectRatio}
            onPlaybackMetrics={updatePlaybackMetrics}
          />
          {presenter.id !== selfId && (
            <label className="screen-stage-volume">
              <Volume2 size={15} aria-hidden="true" />
              <span>Звук демонстрации</span>
              <input
                aria-label={`Громкость демонстрации ${presenter.name}`}
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(event) => onVolume(presenter.id, Number(event.target.value))}
              />
              <output>{Math.round(volume * 100)}%</output>
            </label>
          )}
        </article>
      </div>
    </div>
  );
}

function ParticipantVideo({
  stream,
  source,
  name,
  mirrored,
  muted,
  volume,
  outputDeviceId,
  expanded = false,
  showExpand = true,
  onAspectRatioChange,
  onPlaybackMetrics,
  onExpand,
}: {
  stream: MediaStream;
  source: VideoMediaSource;
  name: string;
  mirrored?: boolean;
  muted: boolean;
  volume: number;
  outputDeviceId: string;
  expanded?: boolean;
  showExpand?: boolean;
  onAspectRatioChange?(aspectRatio: number): void;
  onPlaybackMetrics?(metrics: { width: number; height: number; fps: number }): void;
  onExpand?(): void;
}) {
  const [element, setElement] = useState<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (!element) return;
    element.srcObject = stream;
    void element.play().catch(() => undefined);
    return () => {
      if (element.srcObject === stream) element.srcObject = null;
    };
  }, [element, stream]);
  useEffect(() => {
    if (!element) return;
    element.muted = muted;
    element.volume = Math.min(1, Math.max(0, volume));
    if (outputDeviceId && 'setSinkId' in element)
      void (element as HTMLVideoElement & { setSinkId(deviceId: string): Promise<void> })
        .setSinkId(outputDeviceId)
        .catch(() => undefined);
  }, [element, muted, outputDeviceId, volume]);
  useEffect(() => {
    if (!element || !onPlaybackMetrics) return;
    const mediaStream = stream as MediaStream & {
      getVideoTracks?(): Array<{ getSettings?(): MediaTrackSettings }>;
    };
    const settings = mediaStream.getVideoTracks?.()[0]?.getSettings?.();
    let width = element.videoWidth || Number(settings?.width) || 0;
    let height = element.videoHeight || Number(settings?.height) || 0;
    let fps = Math.round(Number(settings?.frameRate) || 0);
    let frameCount = 0;
    let sampleStartedAt = performance.now();
    let callbackId = 0;
    const video = element as HTMLVideoElement & {
      requestVideoFrameCallback?(callback: (now: number) => void): number;
      cancelVideoFrameCallback?(id: number): void;
    };
    const emit = () => onPlaybackMetrics({ width, height, fps });
    emit();

    const measureFrame = (now: number) => {
      frameCount += 1;
      width = element.videoWidth || width;
      height = element.videoHeight || height;
      const elapsedMs = now - sampleStartedAt;
      if (elapsedMs >= 750) {
        fps = Math.max(1, Math.round((frameCount * 1000) / elapsedMs));
        frameCount = 0;
        sampleStartedAt = now;
        emit();
      }
      callbackId = video.requestVideoFrameCallback?.(measureFrame) ?? 0;
    };
    callbackId = video.requestVideoFrameCallback?.(measureFrame) ?? 0;
    return () => {
      if (callbackId) video.cancelVideoFrameCallback?.(callbackId);
    };
  }, [element, onPlaybackMetrics, stream]);

  return (
    <div className={`participant-video ${source}`}>
      <video
        ref={setElement}
        className={mirrored ? 'mirrored' : undefined}
        aria-label={`${source === 'screen' ? 'Экран' : 'Камера'} ${name}`}
        autoPlay
        muted={muted}
        playsInline
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          if (video.videoWidth > 0 && video.videoHeight > 0)
            onAspectRatioChange?.(video.videoWidth / video.videoHeight);
          const trackSettings = (
            stream as MediaStream & {
              getVideoTracks?(): Array<{ getSettings?(): MediaTrackSettings }>;
            }
          )
            .getVideoTracks?.()[0]
            ?.getSettings?.();
          onPlaybackMetrics?.({
            width: video.videoWidth,
            height: video.videoHeight,
            fps: Math.round(Number(trackSettings?.frameRate) || 0),
          });
        }}
        onResize={(event) => {
          const video = event.currentTarget;
          if (video.videoWidth > 0 && video.videoHeight > 0)
            onAspectRatioChange?.(video.videoWidth / video.videoHeight);
        }}
      />
      {showExpand && onExpand && (
        <button
          className="video-fullscreen"
          aria-label={`${expanded ? 'Свернуть' : 'Раскрыть'} ${source === 'screen' ? 'демонстрацию экрана' : 'камеру'} ${name}`}
          aria-pressed={expanded}
          title={
            source === 'screen'
              ? expanded
                ? 'Вернуть обычный вид'
                : 'Развернуть демонстрацию'
              : 'Развернуть камеру'
          }
          onClick={onExpand}
        >
          {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      )}
    </div>
  );
}

function ParticipantActions({
  participant,
  isSelf,
  canModerate,
  open,
  onToggle,
}: {
  participant: Participant;
  isSelf: boolean;
  canModerate: boolean;
  open: boolean;
  onToggle(): void;
}) {
  if (!canModerate && isSelf) return null;
  return (
    <button
      className="icon-button participant-menu-button"
      aria-label={`Действия для ${participant.name}`}
      aria-expanded={open}
      aria-controls="participant-action-drawer"
      onClick={onToggle}
    >
      <MoreHorizontal size={19} />
    </button>
  );
}

function ParticipantVolume({
  participant,
  locallyMuted,
  value,
  onPeerMute,
  onPeerVolume,
}: {
  participant: Participant;
  locallyMuted: boolean;
  value: number;
  onPeerMute(peerId: string): void;
  onPeerVolume(peerId: string, value: number): void;
}) {
  return (
    <div className="participant-volume">
      <button
        className="inline-icon"
        aria-label={locallyMuted ? 'Включить звук участника' : 'Заглушить участника локально'}
        onClick={() => onPeerMute(participant.id)}
      >
        {locallyMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
      </button>
      <input
        aria-label={`Громкость ${participant.name}`}
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={value}
        onChange={(event) => onPeerVolume(participant.id, Number(event.target.value))}
      />
    </div>
  );
}

function WaitingParticipantCard({ participant }: { participant: WaitingCallParticipant }) {
  const variant = [...participant.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 4;
  return (
    <article
      className="participant-card audio-tile waiting-participant-card"
      role="listitem"
      aria-label={`${participant.displayName} — ожидаем подключения`}
    >
      <span className="waiting-participant-shade" aria-hidden="true" />
      <div className="participant-card-top">
        <span className="waiting-participant-label">Вызов отправлен</span>
      </div>
      <div
        className="participant-avatar waiting-participant-avatar"
        data-variant={variant}
        aria-hidden="true"
      >
        {participant.avatarUrl ? (
          <CachedMediaImage src={participant.avatarUrl} alt="" />
        ) : (
          <span>{initials(participant.displayName)}</span>
        )}
        <i />
      </div>
      <div className="participant-info">
        <div className="participant-name-row">
          <div className="participant-name">
            <strong>{participant.displayName}</strong>
          </div>
        </div>
        <div className="participant-status waiting">
          <i /> Ожидаем подключения
        </div>
      </div>
    </article>
  );
}

function InviteCallout({
  compact = false,
  openSlots,
  onOpen,
}: {
  compact?: boolean;
  openSlots: number;
  onOpen(): void;
}) {
  return (
    <button className={`invite-empty ${compact ? 'compact' : ''}`} onClick={onOpen}>
      <span className="invite-empty-icon">
        <UserPlus size={compact ? 18 : 20} />
      </span>
      <span className="invite-copy">
        <strong>{compact ? 'Пригласить' : 'Добавить друзей'}</strong>
        <small>{slotsLabel(openSlots)}</small>
      </span>
      <UserPlus size={15} />
    </button>
  );
}

function ConnectionStatus({
  state,
  attempt,
  strength,
  buffering = false,
}: {
  state: SignalingState;
  attempt: number;
  strength: number;
  buffering?: boolean;
}) {
  void attempt;
  if (buffering)
    return (
      <span
        className="connection-pill"
        data-state="connecting"
        data-quality="connecting"
        role="status"
      >
        <i />
        <span>Подключение…</span>
      </span>
    );
  const score = state === 'connected' ? Math.max(0, Math.min(100, Math.round(strength))) : 0;
  const quality =
    score >= 90
      ? 'excellent'
      : score >= 75
        ? 'good'
        : score >= 55
          ? 'normal'
          : score >= 30
            ? 'poor'
            : 'offline';
  const label =
    quality === 'excellent'
      ? 'Сигнал отличный'
      : quality === 'good'
        ? 'Сигнал хороший'
        : quality === 'normal'
          ? 'Сигнал нормальный'
          : quality === 'poor'
            ? 'Сигнал плохой'
            : 'Нет интернета';
  return (
    <span className="connection-pill" data-state={state} data-quality={quality} role="status">
      <i />
      <span>{label}</span>
    </span>
  );
}

function CreatorBadge({ compact = false, group = false }: { compact?: boolean; group?: boolean }) {
  return (
    <span className={`creator-badge ${compact ? 'compact' : ''}`}>
      <Crown size={13} /> {group ? 'Создатель группы' : compact ? 'Создатель' : 'Создатель комнаты'}
    </span>
  );
}

function ParticipantAvatar({
  participant,
  speaking,
  onOpenProfile,
}: {
  participant: Participant;
  speaking: boolean;
  onOpenProfile?(): void;
}) {
  const variant = [...participant.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 4;
  const content = (
    <>
      {participant.avatar ? (
        <CachedMediaImage src={participant.avatar} alt={`Аватар ${participant.name}`} />
      ) : (
        <span>{initials(participant.name)}</span>
      )}
      <i aria-label="В сети" />
    </>
  );
  const className = `participant-avatar ${speaking ? 'speaking' : ''}${onOpenProfile ? ' profile-trigger' : ''}`;
  return onOpenProfile ? (
    <button
      type="button"
      className={className}
      data-variant={variant}
      aria-label={`Открыть полный профиль ${participant.name}`}
      onClick={onOpenProfile}
    >
      {content}
    </button>
  ) : (
    <div className={className} data-variant={variant}>
      {content}
    </div>
  );
}

function VoiceWave({ active, compact = false }: { active: boolean; compact?: boolean }) {
  return (
    <div
      className={`voice-wave ${compact ? 'compact' : ''} ${active ? 'active' : ''}`}
      aria-hidden="true"
    >
      {Array.from({ length: compact ? 8 : 18 }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function connectionLabel(state: string, hasAudio: boolean) {
  if (state === 'connected') return hasAudio ? 'Слушает' : 'Подключён';
  return (
    (
      {
        connecting: 'Подключается',
        new: 'Ожидание',
        disconnected: 'Связь прервана',
        failed: 'Нет прямой связи',
        closed: 'Отключён',
      } as Record<string, string>
    )[state] ?? state
  );
}

function slotsLabel(value: number) {
  if (value === 1) return '1 свободное место';
  if (value < 5) return `${value} свободных места`;
  return `${value} свободных мест`;
}

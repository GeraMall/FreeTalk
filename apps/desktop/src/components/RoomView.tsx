import { createPortal } from 'react-dom';
import { t } from '../lib/app-language';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ROOM_MAX_PARTICIPANTS } from '@freetalk/config';
import type {
  Participant,
  PresenceStatus,
  Reaction,
  RoomActivity,
  RoomActivityAction,
  RoomChatMessage,
} from '@freetalk/protocol';
import { useRoomPresence } from '../lib/use-room-presence';
import { AWAY_AFTER_MS } from '../lib/chat-realtime';
import {
  Ban,
  Check,
  Camera,
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
  HeadphoneOff,
  MonitorUp,
  Minimize2,
  MoreHorizontal,
  SmilePlus,
  ShieldCheck,
  Shapes,
  Square,
  UserPlus,
  UserRound,
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
import { CallActivity } from './CallActivity';
import { DeviceControlIcon } from './CallDock';
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
  onCallToolbarTarget?(target: HTMLDivElement | null): void;
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
  deafened?: boolean;
  roomStartedAt: number;
  reactions: Array<{ id: string; participantId: string; reaction: Reaction }>;
  roomChatMessages: RoomChatMessage[];
  activity?: RoomActivity;
  activityUnlocked?: boolean;
  onActivity?(action: RoomActivityAction): void;
  onTabletVisibilityChange?(visible: boolean): void;
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
  conversationHidden: preferredConversationHidden = false,
  onCallToolbarTarget,
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
  deafened = false,
  roomStartedAt,
  reactions,
  roomChatMessages,
  activity,
  activityUnlocked = false,
  onActivity,
  onTabletVisibilityChange,
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
  const accountPresence = useRoomPresence(viewerId, participants);
  const [menuFor, setMenuFor] = useState<string>();
  const [reactionMenuOpen, setReactionMenuOpen] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [activityHint, setActivityHint] = useState(0);
  useEffect(() => {
    if (!activityHint) return;
    const timer = window.setTimeout(() => setActivityHint(0), 2400);
    return () => window.clearTimeout(timer);
  }, [activityHint]);
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
  const [callControlsVisible, setCallControlsVisible] = useState(true);
  const [presentationParticipantsVisible, setPresentationParticipantsVisible] = useState(true);
  const [fullProfileTarget, setFullProfileTarget] = useState<UserProfileTarget>();
  const [friendsInviteOpen, setFriendsInviteOpen] = useState(false);
  const [waitingCardsVisible, setWaitingCardsVisible] = useState(false);
  const roomShellRef = useRef<HTMLElement>(null);
  const participantActionDrawerRef = useRef<HTMLElement>(null);
  const participantActionAnchorRef = useRef<HTMLButtonElement>(null);
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
  const [joinedActivity, setJoinedActivity] = useState<string>();
  const joiningActivity = useRef(false);
  const activitySession = `${roomId}:${activity?.sessionId ?? 'legacy'}`;
  const tabletVisible = Boolean(activity?.open && joinedActivity === activitySession);
  const conversationHidden = preferredConversationHidden || tabletVisible;
  const roomChatVisible = chatOpen && !tabletVisible;
  const joinTablet = () => setJoinedActivity(activitySession);
  useLayoutEffect(() => {
    if (!activity?.open) {
      setJoinedActivity(undefined);
      return;
    }
    if (joiningActivity.current || activity.startedBy === selfId) {
      joiningActivity.current = false;
      setJoinedActivity(activitySession);
    }
  }, [activity?.open, activity?.startedBy, activitySession, selfId]);
  useLayoutEffect(() => {
    onTabletVisibilityChange?.(tabletVisible);
  }, [tabletVisible, onTabletVisibilityChange]);
  useLayoutEffect(() => () => onTabletVisibilityChange?.(false), [onTabletVisibilityChange]);
  const activityStarter = participants.find(
    (participant) => participant.id === activity?.startedBy,
  );
  const activityButton = (layoutClass: string) => (
    <button
      type="button"
      className={`dock-control activity-control ${layoutClass} ${activity?.open ? 'active' : ''}`}
      aria-label={t('Активность')}
      aria-pressed={tabletVisible}
      data-tooltip={t('Активность')}
      disabled={(activityUnlocked || activity?.open) && signalingState !== 'connected'}
      onClick={() => {
        if (activity?.open) {
          if (tabletVisible) setJoinedActivity(undefined);
          else joinTablet();
        } else if (activityUnlocked) {
          joiningActivity.current = true;
          onActivity?.({ kind: 'open' });
        } else setActivityHint((current) => current + 1);
      }}
    >
      <span className="dock-icon">
        <Shapes aria-hidden="true" />
      </span>
      {layoutClass === 'activity-control-mobile' && (
        <span className="dock-mobile-label">{t('Активность')}</span>
      )}
    </button>
  );
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

  useEffect(() => {
    setCallControlsVisible(true);
    callControlsTimer.current = setTimeout(() => setCallControlsVisible(false), 3500);
    return () => {
      if (callControlsTimer.current) clearTimeout(callControlsTimer.current);
    };
  }, [roomId]);

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
    chatOpenRef.current = roomChatVisible;
    if (roomChatVisible) setUnreadChatCount(0);
  }, [roomChatVisible]);

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

  useLayoutEffect(() => {
    const anchor = participantActionAnchorRef.current;
    const panel = participantActionDrawerRef.current;
    if (!actionParticipant || !anchor || !panel) return;

    const positionMenu = () => {
      const trigger = anchor.getBoundingClientRect();
      const gutter = 10;
      const gap = 8;
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const card = anchor.closest('.participant-card')?.getBoundingClientRect();
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      const below = viewportHeight - trigger.bottom - gap;
      const above = trigger.top - gap;
      const opensUp = height + gutter > below && above > below;
      let side = opensUp ? 'above' : 'below';
      let left = trigger.right - width;
      let top = opensUp ? trigger.top - gap - height : trigger.bottom + gap;

      if (card?.width) {
        if (card.right + gap + width <= viewportWidth - gutter) {
          side = 'right';
          left = card.right + gap;
          top = trigger.top;
        } else if (card.left - gap - width >= gutter) {
          side = 'left';
          left = card.left - gap - width;
          top = trigger.top;
        } else if (card.bottom + gap + height <= viewportHeight - gutter) {
          side = 'below';
          top = card.bottom + gap;
        } else if (card.top - gap - height >= gutter) {
          side = 'above';
          top = card.top - gap - height;
        }
      }

      panel.style.left = Math.max(gutter, Math.min(left, viewportWidth - width - gutter)) + 'px';
      panel.style.top = Math.max(gutter, Math.min(top, viewportHeight - height - gutter)) + 'px';
      panel.dataset.side = side;
    };

    positionMenu();
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(positionMenu);
    observer?.observe(panel);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [actionParticipant]);

  const toggleParticipantActions = (id: string, anchor: HTMLButtonElement) => {
    participantActionAnchorRef.current = anchor;
    setMenuFor((previous) => (previous === id ? undefined : id));
  };

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
    if (!('__TAURI_INTERNALS__' in window)) return;
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

  const [recentSpeech, setRecentSpeech] = useState<{
    room: string;
    until: ReadonlyMap<string, number>;
  }>();

  useEffect(() => {
    const now = Date.now();
    setRecentSpeech((previous) => {
      const existing = previous?.room === roomId ? previous.until : undefined;
      const until = new Map<string, number>();
      for (const participant of participants) {
        const speaking =
          !participant.muted &&
          (participant.id === selfId ? localSpeaking : peerState[participant.id]?.speaking);
        const prior = existing?.get(participant.id);
        if (speaking) until.set(participant.id, Infinity);
        else if (prior === Infinity) until.set(participant.id, now + AWAY_AFTER_MS);
        else if (prior !== undefined && prior > now) until.set(participant.id, prior);
      }
      if (
        existing?.size === until.size &&
        [...until].every(([id, expiry]) => existing.get(id) === expiry)
      ) {
        return previous;
      }
      return { room: roomId, until };
    });
  }, [localSpeaking, participants, peerState, roomId, selfId]);

  useEffect(() => {
    if (!recentSpeech || recentSpeech.room !== roomId) return;
    const nextExpiry = Math.min(...recentSpeech.until.values());
    if (!Number.isFinite(nextExpiry)) return;
    const timer = window.setTimeout(
      () => {
        const now = Date.now();
        setRecentSpeech((current) => {
          if (!current || current.room !== roomId) return current;
          return {
            room: roomId,
            until: new Map([...current.until].filter(([, expiry]) => expiry > now)),
          };
        });
      },
      Math.max(0, nextExpiry - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [recentSpeech, roomId]);

  const renderParticipant = (source: Participant, compact = false) => {
    const participant = source.id === selfId ? { ...source, muted, deafened } : source;
    const accountStatus = participant.accountId
      ? (accountPresence[participant.accountId] ?? 'online')
      : 'online';
    const isSelf = participant.id === selfId;
    const speaking =
      !participant.muted && (isSelf ? localSpeaking : peerState[participant.id]?.speaking);
    const speechIsRecent = recentSpeech?.room === roomId && recentSpeech.until.has(participant.id);
    const presence =
      (speaking || speechIsRecent) && accountStatus === 'away' ? 'online' : accountStatus;
    const connection = isSelf ? 'connected' : (peerState[participant.id]?.connection ?? 'new');
    const hasAudio = isSelf || (peerState[participant.id]?.hasAudio ?? false);
    const locallyMuted = settings.mutedPeers[participant.id] ?? false;
    const canModerate = Boolean(conversationType !== 'direct' && self?.isOwner && !isSelf);
    const media = participantMedia(participant);
    const showCamera = Boolean(media.camera);
    const cardStyle = participant.cardStyle ?? 'avatar-glass';
    const connectionInterrupted = ['failed', 'disconnected', 'closed'].includes(connection);
    const status = connectionInterrupted
      ? connectionLabel(connection, hasAudio)
      : participant.muted
        ? 'Микрофон выключен'
        : speaking
          ? 'Говорит'
          : presence === 'away'
            ? 'Нет на месте'
            : presence === 'dnd'
              ? 'Не беспокоить'
              : presence === 'offline'
                ? 'Не в сети'
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
        {showCamera && (
          <ParticipantVideo
            stream={media.camera!}
            source="camera"
            name={participant.name}
            mirrored={isSelf && settings.mirrorSelfVideo}
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
            onToggle={(event) => toggleParticipantActions(participant.id, event.currentTarget)}
          />
        </div>

        {!showCamera && (
          <ParticipantAvatar
            participant={participant}
            speaking={Boolean(speaking)}
            presence={presence}
            onOpenProfile={
              viewerId && participant.avatar && participant.accountId
                ? () =>
                    setFullProfileTarget({
                      id: participant.accountId!,
                      displayName: participant.name,
                      avatarUrl: participant.avatar,
                      presence,
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
              {isSelf && <span>{t('вы')}</span>}
            </div>
            {!compact && <VoiceWave active={Boolean(speaking)} compact />}
          </div>
          <div
            className={`participant-status ${participant.muted ? 'muted' : speaking ? 'live' : ''}`}
            data-presence={presence}
          >
            {!connectionInterrupted && (participant.muted || participant.deafened) ? (
              <span className="participant-disabled-media">
                {participant.muted && (
                  <span aria-label={t('Микрофон выключен')} data-tooltip={t('Микрофон выключен')}>
                    <MicOff size={18} />
                  </span>
                )}
                {participant.deafened && (
                  <span aria-label={t('Наушники выключены')} data-tooltip={t('Наушники выключены')}>
                    <HeadphoneOff size={18} />
                  </span>
                )}
              </span>
            ) : (
              <>
                <i />
                {t(status)}
              </>
            )}
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

  const conversationInvite =
    onInviteFriends && openSlots > 0 ? (
      <button
        className="conversation-invite"
        aria-label={t('Добавить друга в групповой звонок')}
        data-tooltip={t('Добавить друга — продолжить в группе')}
        onClick={() => setFriendsInviteOpen(true)}
      >
        <UserPlus size={18} />
      </button>
    ) : null;

  const roomContent = (
    <main
      ref={roomShellRef}
      className={`room-shell ${conversation ? `conversation-room${conversationType ? ` conversation-${conversationType}` : ''}` : ''} ${conversation && !conversationHidden ? 'conversation-call-compact' : ''} ${conversationHidden ? 'conversation-chat-hidden' : ''} ${embedded ? 'room-shell-embedded' : ''} ${roomChatVisible ? 'room-chat-open' : ''} ${screenFocusMode ? 'screen-focus-mode' : ''} ${roomMode === 'presentation' ? 'has-presentation' : ''} ${callFullscreen ? 'call-fullscreen' : ''} ${callControlsVisible || deviceMenu || reactionMenuOpen || mobileActionsOpen || activityHint ? 'call-controls-visible' : ''}`}
      onPointerMove={revealCallControls}
    >
      <div className="room-connection-flyout">
        <ConnectionStatus
          state={signalingState}
          attempt={reconnectAttempt}
          strength={signalStrength}
          buffering={
            conversationBuffering ||
            (hasConversationPeer &&
              participants.some(
                (person) =>
                  person.id !== selfId &&
                  (!peerState[person.id] ||
                    ['new', 'connecting'].includes(peerState[person.id]!.connection)),
              ) &&
              !participants.some(
                (person) =>
                  person.id !== selfId && peerState[person.id]?.connection === 'connected',
              ))
          }
        />
      </div>

      <div className="room-session-meta">
        <span
          className="room-security"
          data-tooltip={
            turnAvailable ? t('WebRTC с резервным TURN-маршрутом') : t('Прямое WebRTC-соединение')
          }
        >
          <ShieldCheck size={14} /> {t('Приватное соединение')}
        </span>
        <span
          className={`call-timer${conversationBuffering ? ' buffering' : ''}`}
          aria-label={
            conversationBuffering
              ? t('Ожидание подключения')
              : t('Длительность звонка {p0}', { p0: elapsed })
          }
        >
          <i />
          {conversationBuffering ? t('Ожидание') : elapsed}
        </span>
      </div>

      {conversation &&
        !callFullscreen &&
        (onCallToolbarTarget ? (
          <div className="conversation-toolbar active-chat-actions" ref={onCallToolbarTarget}>
            {conversationInvite}
          </div>
        ) : (
          !conversationHidden && conversationInvite
        ))}
      {recordingBannerMessage && (
        <div className="recording-start-banner" role="status">
          <span>
            <i />
            {recordingBannerMessage}
          </span>
          <button onClick={onRecordingBannerClose}>{t('ОК')}</button>
        </div>
      )}

      <div className="room-body-layout">
        <section className={`room-main room-mode-${roomMode}`}>
          <div className="participants-heading">
            <div>
              <h1>{t('Участники')}</h1>
              <p>
                {participants.length} {t('из')} {ROOM_MAX_PARTICIPANTS}
              </p>
            </div>
            {openSlots > 0 && (!conversation || (!conversationHidden && !callFullscreen)) && (
              <button
                className="mobile-participants-invite"
                aria-label={t('Добавить друзей в звонок')}
                data-tooltip={t('Добавить друзей')}
                onClick={() => (onInviteFriends ? setFriendsInviteOpen(true) : onCopyInvite())}
              >
                <UserPlus aria-hidden="true" />
                <span>{t('Добавить')}</span>
              </button>
            )}
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
                <div className="participant-strip" role="list" aria-label={t('Участники комнаты')}>
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
          ) : tabletVisible && activity ? (
            <CallActivity
              activity={activity}
              selfId={selfId}
              participants={participants.map((person) => ({
                ...person,
                speaking:
                  !person.muted &&
                  !person.deafened &&
                  (person.id === selfId ? localSpeaking : peerState[person.id]?.speaking),
                cameraStream:
                  person.id === selfId ? localVideo.cameraStream : remoteVideos[person.id]?.camera,
              }))}
              onAction={onActivity}
              onClose={() => setJoinedActivity(undefined)}
              onEnd={activityUnlocked ? () => onActivity?.({ kind: 'close' }) : undefined}
            />
          ) : (
            <div
              className="participants-grid"
              data-count={
                participants.length +
                visibleWaitingParticipants.length +
                (activity?.open && !tabletVisible ? 1 : 0)
              }
              data-mode={roomMode}
              role="list"
            >
              {ordered.map((participant) => renderParticipant(participant))}
              {activity?.open && !tabletVisible && (
                <article
                  className={`participant-card ${roomMode === 'camera' ? 'camera-tile' : 'audio-tile'} activity-invitation`}
                  role="listitem"
                >
                  <div className="activity-invitation-content">
                    <span className="activity-invitation-icon">
                      <Shapes size={27} />
                    </span>
                    <strong>{t('Общий планшет')}</strong>
                    <span>
                      {t('{name} приглашает играть вместе', {
                        name: activityStarter?.name ?? 'TRLKA',
                      })}
                    </span>
                    <button type="button" onClick={joinTablet}>
                      {t('Присоединиться')}
                    </button>
                  </div>
                </article>
              )}

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

        {screenPresenter && tabletVisible && (
          <div className="activity-presentation-note" role="status">
            {t('Планшет свёрнут на время демонстрации')}
          </div>
        )}

        {roomChatVisible && (
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
          aria-label={t('Раскрытая камера {p0}', { p0: focusedCameraParticipant.name })}
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
            mirrored={focusedCameraParticipant.id === selfId && settings.mirrorSelfVideo}
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
              onToggle={(event) =>
                toggleParticipantActions(focusedCameraParticipant.id, event.currentTarget)
              }
            />
          </div>
          <div className="participant-overlay media-overlay-bottom">
            <div className="participant-name">
              <strong>{focusedCameraParticipant.name}</strong>
              {focusedCameraParticipant.id === selfId && <span>{t('вы')}</span>}
            </div>
          </div>
        </section>
      )}

      {actionParticipant &&
        createPortal(
          <aside
            key={actionParticipant.id}
            ref={participantActionDrawerRef}
            id="participant-action-drawer"
            className="participant-action-drawer"
            role="dialog"
            aria-label={t('Управление участником {p0}', { p0: actionParticipant.name })}
          >
            <header>
              <strong>{actionParticipant.name}</strong>
              <button
                type="button"
                className="icon-button participant-action-close"
                aria-label={t('Закрыть управление участником')}
                onClick={() => setMenuFor(undefined)}
              >
                <X size={15} />
              </button>
            </header>
            {viewerId && actionParticipant.accountId && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setFullProfileTarget({
                    id: actionParticipant.accountId!,
                    displayName: actionParticipant.name,
                    avatarUrl: actionParticipant.avatar,
                    presence: accountPresence[actionParticipant.accountId!] ?? 'online',
                  });
                  setMenuFor(undefined);
                }}
              >
                <UserRound size={16} />
                <strong>{t('Полный профиль')}</strong>
              </button>
            )}
            {actionParticipant.id !== selfId && (
              <button
                type="button"
                role="menuitem"
                aria-label={
                  settings.mutedPeers[actionParticipant.id]
                    ? t('Вернуть звук')
                    : t('Не слышать локально')
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
                      ? t('Вернуть звук')
                      : t('Не слышать локально')}
                  </strong>
                  <small>{t('Изменение действует только для вас')}</small>
                </span>
              </button>
            )}
            {conversationType !== 'direct' && self?.isOwner && actionParticipant.id !== selfId && (
              <button
                type="button"
                role="menuitem"
                className="danger-action"
                aria-label={
                  actionParticipant.muted ? t('Микрофон уже выключен') : t('Выключить микрофон')
                }
                disabled={actionParticipant.muted}
                onClick={() => {
                  onModerationMute(actionParticipant.id, actionParticipant.name);
                  setMenuFor(undefined);
                }}
              >
                <MicOff size={17} />
                <span>
                  <strong>
                    {actionParticipant.muted ? t('Микрофон уже выключен') : t('Выключить микрофон')}
                  </strong>
                  <small>{t('Для всех участников звонка')}</small>
                </span>
              </button>
            )}
          </aside>,
          document.fullscreenElement ?? document.body,
        )}

      {createPortal(
        <div className="reaction-burst-layer" aria-live="polite">
          {reactions.map((item) => {
            const participant = participants.find((entry) => entry.id === item.participantId);
            return (
              <span className="reaction-burst" key={item.id}>
                <b>{item.reaction}</b>
                <small>{participant?.name ?? t('Участник')}</small>
              </span>
            );
          })}
        </div>,
        document.fullscreenElement ?? document.body,
      )}

      {conversation && !callFullscreen && !tabletVisible && (
        <button
          className="conversation-chat-hide"
          aria-label={conversationHidden ? t('Показать чат') : t('Скрыть чат')}
          aria-expanded={!conversationHidden}
          onClick={onConversationToggle}
        >
          <MessageCircle size={14} />
          <span>{conversationHidden ? t('Показать чат') : t('Скрыть чат')}</span>
        </button>
      )}

      <div className="call-view-controls" aria-label={t('Режим отображения звонка')}>
        <button
          className="call-popout-action"
          aria-label={
            callDetached
              ? t('Вернуть звонок в основное окно')
              : t('Открыть звонок в отдельном окне')
          }
          data-tooltip={callDetached ? t('Вернуть в основное окно') : t('В отдельном окне')}
          onClick={() => void toggleCallPopout()}
        >
          <PictureInPicture2 size={19} />
        </button>
        <button
          className="call-fullscreen-action"
          aria-label={
            callFullscreen ? t('Выйти из полноэкранного режима') : t('Открыть звонок во весь экран')
          }
          data-tooltip={
            callFullscreen ? t('Выйти из полноэкранного режима') : t('Полноэкранный режим')
          }
          onClick={() => void toggleCallFullscreen()}
        >
          {callFullscreen ? <Minimize2 size={19} /> : <Maximize2 size={19} />}
        </button>
      </div>

      <footer
        className={`voice-dock ${mobileActionsOpen ? 'mobile-actions-open' : ''}`}
        aria-label={t('Управление звонком')}
      >
        {screenPresenter && (
          <button
            className={`presentation-participants-dock-toggle ${presentationParticipantsVisible ? 'active' : ''}`}
            aria-expanded={presentationParticipantsVisible}
            aria-label={
              presentationParticipantsVisible ? t('Скрыть участников') : t('Показать участников')
            }
            data-tooltip={
              presentationParticipantsVisible ? t('Скрыть участников') : t('Показать участников')
            }
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
              aria-label={muted ? t('Включить микрофон') : t('Выключить микрофон')}
              aria-pressed={!muted}
              data-tooltip={muted ? t('Включить микрофон') : t('Выключить микрофон')}
              onClick={onMute}
            >
              <span className="dock-icon">
                <DeviceControlIcon icon={Mic} off={muted} />
              </span>
              <span className="dock-mobile-label">{t('Микрофон')}</span>
            </button>
            <button
              className="dock-device-arrow"
              aria-label={t('Выбрать аудиоустройство')}
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
              aria-label={localVideo.cameraEnabled ? t('Выключить камеру') : t('Включить камеру')}
              aria-pressed={localVideo.cameraEnabled}
              data-tooltip={localVideo.cameraEnabled ? t('Выключить камеру') : t('Включить камеру')}
              disabled={videoBusy}
              onClick={() => {
                if (localVideo.cameraEnabled || !settings.cameraPreviewAlways) onCamera();
                else setCameraPreviewOpen(true);
              }}
            >
              <span className="dock-icon">
                <DeviceControlIcon icon={Camera} off={!localVideo.cameraEnabled} />
              </span>
              <span className="dock-mobile-label">{t('Камера')}</span>
            </button>
            <button
              className="dock-device-arrow"
              aria-label={t('Выбрать камеру')}
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
        {activityButton('activity-control-mobile')}
        {activityHint > 0 && (
          <span className="call-activity-hint" key={activityHint} role="status">
            {t('Скоро')}
          </span>
        )}
        <button
          className={`mobile-call-more-toggle ${mobileActionsOpen ? 'active' : ''}`}
          aria-label={mobileActionsOpen ? t('Скрыть дополнительные действия') : t('Показать ещё')}
          aria-expanded={mobileActionsOpen}
          onClick={() => setMobileActionsOpen((open) => !open)}
        >
          <MoreHorizontal aria-hidden="true" />
          <span className="dock-mobile-label">{t('Ещё')}</span>
        </button>
        <div className="dock-island dock-secondary-actions">
          {activityButton('activity-control-desktop')}
          <button
            className={`dock-control video-control screen-control ${localVideo.screenEnabled ? 'active sharing' : ''}`}
            aria-busy={videoBusy}
            aria-label={
              localVideo.screenEnabled
                ? t('Остановить демонстрацию экрана')
                : t('Демонстрация экрана')
            }
            aria-pressed={localVideo.screenEnabled}
            data-tooltip={
              localVideo.screenEnabled
                ? t('Остановить демонстрацию экрана')
                : t('Демонстрация экрана')
            }
            disabled={videoBusy}
            onClick={onScreen}
          >
            <span className="dock-icon">
              {localVideo.screenEnabled ? <Square /> : <MonitorUp />}
            </span>
            <span className="dock-mobile-label">{t('Экран')}</span>
          </button>
          {(conversationType === 'direct' || self?.isOwner) && (
            <button
              className={`dock-control dock-control-secondary dock-recording-control ${recordingState.phase === 'recording' ? 'active' : ''}`}
              aria-label={
                recordingState.phase === 'recording'
                  ? t('Остановить запись экрана')
                  : recordingState.phase === 'saving'
                    ? t('Запись сохраняется')
                    : t('Начать запись экрана')
              }
              data-tooltip={
                recordingState.phase === 'recording'
                  ? t('Остановить запись')
                  : recordingState.phase === 'saving'
                    ? t('Запись сохраняется')
                    : t('Запись')
              }
              disabled={recordingState.phase === 'saving'}
              onClick={onRecording}
            >
              <span className="dock-icon">
                {recordingState.phase === 'recording' ? <Square /> : <CircleDot />}
              </span>
              <span className="dock-mobile-label">{t('Запись')}</span>
            </button>
          )}
          <div className="reaction-control">
            <button
              className={`dock-control dock-control-secondary reaction-button ${reactionMenuOpen ? 'active' : ''}`}
              aria-label={t('Отправить реакцию')}
              aria-expanded={reactionMenuOpen}
              data-tooltip={t('Отправить реакцию')}
              onClick={() => setReactionMenuOpen((open) => !open)}
            >
              <span className="dock-icon">
                <SmilePlus />
              </span>
              <span className="dock-mobile-label">{t('Реакции')}</span>
            </button>
            {reactionMenuOpen && (
              <div className="reaction-menu" role="menu" aria-label={t('Реакции')}>
                {(['👍', '❤️', '😂', '🎉', '🔥'] as const).map((reaction) => (
                  <button
                    key={reaction}
                    role="menuitem"
                    aria-label={t('Отправить реакцию {p0}', { p0: reaction })}
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
              className={`dock-control dock-control-secondary room-chat-control ${roomChatVisible ? 'active' : ''}`}
              aria-label={
                conversation
                  ? t('Показать чат')
                  : unreadChatCount > 0
                    ? t('Чат комнаты, непрочитанных сообщений: {p0}', { p0: unreadChatCount })
                    : t('Чат комнаты')
              }
              aria-expanded={roomChatVisible}
              data-tooltip={conversation ? t('Показать чат') : t('Чат комнаты')}
              onClick={() => {
                if (tabletVisible) setJoinedActivity(undefined);
                else toggleRoomChat();
              }}
            >
              <span className="dock-icon">
                <MessageCircle />
                {unreadChatCount > 0 && (
                  <b className="room-chat-badge" aria-hidden="true">
                    {unreadChatCount}
                  </b>
                )}
              </span>
              <span className="dock-mobile-label">{t('Чат')}</span>
            </button>
          )}
          <button
            className="dock-control dock-control-secondary dock-settings-control"
            aria-label={t('Настройки аудио и устройств')}
            data-tooltip={t('Настройки аудио и устройств')}
            onClick={onSettings}
          >
            <span className="dock-icon">
              <MoreHorizontal className="dock-desktop-more-icon" />
              <SlidersHorizontal className="dock-mobile-settings-icon" />
            </span>
            <span className="dock-mobile-label">{t('Настройки')}</span>
          </button>
        </div>
        <button
          className="leave-button"
          aria-label={t('Выйти из комнаты')}
          data-tooltip={t('Выйти из комнаты')}
          onClick={onLeave}
        >
          <LogOut size={18} />
          <span className="dock-mobile-label">{t('Выйти')}</span>
        </button>
      </footer>
      {cameraPreviewOpen && (
        <CameraPreviewDialog
          workspace={
            embedded && !callFullscreen
              ? roomShellRef.current?.closest('.account-room-workspace')
              : undefined
          }
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
      <div className="dock-device-menu camera-device-menu" role="menu" aria-label={t('Камера')}>
        <strong>{t('Камера')}</strong>
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
            label={t('Системная камера')}
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
            <Eye size={17} /> {t('Предпросмотр камеры')}
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
            <SlidersHorizontal size={17} /> {t('Настройки видео')}
          </span>
        </button>
      </div>
    );
  return (
    <div
      className="dock-device-menu audio-device-menu"
      role="menu"
      aria-label={t('Выбор аудиоустройства')}
    >
      <strong>{t('Микрофон')}</strong>
      <DeviceMenuItem
        label={t('Системный микрофон')}
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
      <strong>{t('Динамики')}</strong>
      <DeviceMenuItem
        label={t('Системные динамики')}
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
  workspace,
  devices,
  settings,
  cameraEnabled,
  onApply,
  onEnable,
  onClose,
}: {
  workspace?: Element | null;
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
  const [bounds, setBounds] = useState<DOMRect>();
  useLayoutEffect(() => {
    if (!workspace) {
      setBounds(undefined);
      return;
    }
    const update = () => setBounds(workspace.getBoundingClientRect());
    update();
    const observer = new ResizeObserver(update);
    observer.observe(workspace);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [workspace]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose]);
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

  return createPortal(
    <div
      className="camera-preview-backdrop"
      role="presentation"
      onMouseDown={close}
      style={
        bounds
          ? {
              left: bounds.left,
              top: bounds.top,
              width: bounds.width,
              height: bounds.height,
              right: 'auto',
              bottom: 'auto',
            }
          : undefined
      }
    >
      <section
        className="camera-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="camera-preview-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <h2 id="camera-preview-title">{t('Готовы к видеочату?')}</h2>
          <button type="button" aria-label={t('Закрыть предпросмотр')} onClick={close}>
            <X />
          </button>
        </header>
        <div className="camera-preview-stage">
          <video
            ref={videoRef}
            className={settings.mirrorSelfVideo ? 'mirrored' : undefined}
            muted
            playsInline
          />
          {previewBusy && <span>{t('Подготавливаем камеру…')}</span>}
          {previewError && <span className="camera-preview-error">{previewError}</span>}
        </div>
        <div className="camera-preview-device-picker">
          <button
            type="button"
            className="camera-preview-device"
            aria-label={t('Выбрать камеру. {p0}', { p0: selectedDeviceLabel })}
            aria-haspopup="listbox"
            aria-expanded={deviceMenuOpen}
            onClick={() => setDeviceMenuOpen((open) => !open)}
          >
            <span className="camera-preview-device-icon">
              <Camera size={17} />
            </span>
            <span className="camera-preview-device-copy">
              <small>{t('Камера')}</small>
              <strong>{selectedDeviceLabel}</strong>
            </span>
            <ChevronDown className="camera-preview-device-chevron" size={17} />
          </button>
          {deviceMenuOpen && (
            <div className="camera-preview-device-menu" role="listbox" aria-label={t('Камеры')}>
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
                  <strong>{t('Системная камера')}</strong>
                  <small>{t('Выбирать автоматически')}</small>
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
                      <small>{t('Видеоустройство')}</small>
                    </span>
                    {deviceId === device.deviceId && <Check size={16} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="camera-background-section">
          <strong>{t('Фон видео')}</strong>
          <div className="camera-background-options">
            <button
              type="button"
              className={mode === 'none' ? 'selected' : ''}
              onClick={() => setMode('none')}
            >
              <Ban />
              <span>{t('Пусто')}</span>
            </button>
            <button
              type="button"
              className={`camera-background-blur ${mode === 'blur' ? 'selected' : ''}`}
              onClick={() => setMode('blur')}
            >
              <Sparkles />
              <span>{t('Размытие')}</span>
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
              <span>{t('Свой фон')}</span>
            </button>
          </div>
          <button
            type="button"
            className="camera-background-upload"
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus size={16} />
            {dataUrl ? t('Заменить свой фон') : t('Выбрать изображение')}
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
            <span>{t('Предпросмотр видео (всегда)')}</span>
          </label>
          <button
            type="button"
            className="camera-preview-confirm"
            disabled={previewBusy || Boolean(previewError)}
            onClick={apply}
          >
            {cameraEnabled ? t('Применить') : t('Включить камеру')}
          </button>
        </footer>
      </section>
    </div>,
    document.fullscreenElement ?? document.body,
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
      if (width < 1) return;
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
              <small>{t('Демонстрация экрана')}</small>
            </span>
          </span>
          <span className="screen-stage-creator">
            {presenter.isOwner && conversationType !== 'direct' && (
              <CreatorBadge compact group={conversationType === 'group'} />
            )}
          </span>
          <span className="screen-stage-quality">
            <span aria-label={t('Параметры демонстрации экрана')}>
              {playbackMetrics.width > 0 && playbackMetrics.height > 0
                ? `${playbackMetrics.width}×${playbackMetrics.height}`
                : t('Определяем качество')}
              {playbackMetrics.fps > 0 && ` · ${playbackMetrics.fps} FPS`}
            </span>
            <button
              type="button"
              className="screen-stage-expand"
              aria-label={
                fullscreen ? t('Свернуть демонстрацию экрана') : t('Развернуть демонстрацию экрана')
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
          aria-label={t('Демонстрация экрана {p0}', { p0: presenter.name })}
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
              <span>{t('Звук демонстрации')}</span>
              <input
                aria-label={t('Громкость демонстрации {p0}', { p0: presenter.name })}
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
  const [playback, setPlayback] = useState<'waiting' | 'playing' | 'failed'>('waiting');
  const play = useCallback(() => {
    if (!element) return;
    void element.play().catch((error: unknown) => {
      if (
        element.srcObject === stream &&
        !(error instanceof DOMException && error.name === 'AbortError')
      )
        setPlayback('failed');
    });
  }, [element, stream]);
  useEffect(() => {
    if (!element) return;
    setPlayback('waiting');
    element.srcObject = stream;
    play();
    return () => {
      if (element.srcObject === stream) element.srcObject = null;
    };
  }, [element, play, stream]);
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
        onPlaying={() => setPlayback('playing')}
        onError={() => setPlayback('failed')}
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
      {source === 'screen' && playback !== 'playing' && (
        <div className="screen-stage-waiting" role="status">
          <span>{playback === 'failed' ? t('Демонстрация экрана') : t('Подключение…')}</span>
          {playback === 'failed' && (
            <button
              type="button"
              className="secondary"
              onClick={(event) => {
                event.stopPropagation();
                setPlayback('waiting');
                play();
              }}
            >
              {t('Повторить подключение')}
            </button>
          )}
        </div>
      )}
      {showExpand && onExpand && (
        <button
          className="video-fullscreen"
          aria-label={`${expanded ? 'Свернуть' : 'Раскрыть'} ${source === 'screen' ? 'демонстрацию экрана' : 'камеру'} ${name}`}
          aria-pressed={expanded}
          data-tooltip={
            source === 'screen'
              ? expanded
                ? t('Вернуть обычный вид')
                : t('Развернуть демонстрацию')
              : t('Развернуть камеру')
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
  onToggle(event: ReactMouseEvent<HTMLButtonElement>): void;
}) {
  if (!canModerate && isSelf) return null;
  return (
    <button
      type="button"
      className="icon-button participant-menu-button"
      aria-label={t('Действия для {p0}', { p0: participant.name })}
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
        aria-label={locallyMuted ? t('Включить звук участника') : t('Заглушить участника локально')}
        onClick={() => onPeerMute(participant.id)}
      >
        {locallyMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
      </button>
      <input
        aria-label={t('Громкость {p0}', { p0: participant.name })}
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
      aria-label={t('{p0} — ожидаем подключения', { p0: participant.displayName })}
    >
      <div className="participant-card-top">
        <span className="waiting-participant-label">{t('Вызов отправлен')}</span>
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
          <i /> {t('Ожидаем подключения')}
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
        <strong>{compact ? t('Пригласить') : t('Добавить друзей')}</strong>
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
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  if (!online || state === 'offline')
    return (
      <span className="connection-pill" data-state="offline" data-quality="offline" role="status">
        <i />
        <span>{t(!online ? 'Нет интернета' : 'Связь с сервером прервана')}</span>
      </span>
    );
  if (
    buffering ||
    state === 'connecting' ||
    state === 'reconnecting' ||
    (state === 'connected' && strength <= 0)
  )
    return (
      <span
        className="connection-pill"
        data-state="connecting"
        data-quality="connecting"
        role="status"
      >
        <i />
        <span>{t('Подключение…')}</span>
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
            : 'Сигнал плохой';
  return (
    <span className="connection-pill" data-state={state} data-quality={quality} role="status">
      <i />
      <span>{t(label)}</span>
    </span>
  );
}

function CreatorBadge({ compact = false, group = false }: { compact?: boolean; group?: boolean }) {
  return (
    <span className={`creator-badge ${compact ? 'compact' : ''}`}>
      <Crown size={13} />
      {group ? t('Создатель группы') : compact ? t('Создатель') : t('Создатель комнаты')}
    </span>
  );
}

function ParticipantAvatar({
  participant,
  speaking,
  presence,
  onOpenProfile,
}: {
  participant: Participant;
  speaking: boolean;
  presence: PresenceStatus;
  onOpenProfile?(): void;
}) {
  const variant = [...participant.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 4;
  const content = (
    <>
      {participant.avatar ? (
        <CachedMediaImage
          src={participant.avatar}
          alt={t('Аватар {p0}', { p0: participant.name })}
        />
      ) : (
        <span>{initials(participant.name)}</span>
      )}
      <i
        aria-label={
          presence === 'away'
            ? t('Нет на месте')
            : presence === 'dnd'
              ? t('Не беспокоить')
              : presence === 'offline'
                ? t('Не в сети')
                : t('В сети')
        }
      />
    </>
  );
  const className = `participant-avatar ${speaking ? 'speaking' : ''}${onOpenProfile ? ' profile-trigger' : ''}`;
  return onOpenProfile ? (
    <button
      type="button"
      className={className}
      data-variant={variant}
      data-presence={presence}
      aria-label={t('Открыть полный профиль {p0}', { p0: participant.name })}
      onClick={onOpenProfile}
    >
      {content}
    </button>
  ) : (
    <div className={className} data-variant={variant} data-presence={presence}>
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

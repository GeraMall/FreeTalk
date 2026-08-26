import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_ICE_SERVERS } from '@freetalk/config';
import type { ClientMessage, Participant, Reaction, ServerMessage } from '@freetalk/protocol';
import { AudioManager } from './lib/audio-manager';
import { connectionDiagnostics } from './lib/connection-diagnostics';
import { hasTurnServer } from './lib/ice-config';
import { DEFAULT_INVITE_BASE_URL, roomInviteUrl, subscribeToRoomDeepLinks } from './lib/deep-link';
import { NotificationSounds, ParticipantNotificationTracker } from './lib/notification-sounds';
import { PeerManager } from './lib/peer-manager';
import { RemoteAudio } from './lib/remote-audio';
import { generateRoomCode, parseRoomCode } from './lib/room-code';
import { defaultSettings, loadSettings, saveSettings, type LocalSettings } from './lib/settings';
import { nextProfileChangeHistory } from './lib/profile';
import { SignalingClient, type SignalingState } from './lib/signaling-client';
import { VideoManager, type LocalVideoState, type VideoMediaSource } from './lib/video-manager';
import type { VideoPreferences } from './lib/video-quality';
import {
  checkForUpdate,
  currentVersion,
  installPendingUpdate,
  type UpdateStatus,
} from './lib/updater';
import { RoomView, type PeerUiState, type RemoteVideoUiState } from './components/RoomView';
import { SettingsPanel } from './components/SettingsPanel';
import { WelcomeScreen } from './components/WelcomeScreen';
import { HomeView } from './components/HomeView';
import {
  AccountSidebar,
  type AccountDestination,
  type AccountPage,
} from './components/AccountSidebar';
import { accountClient, ApiError, type AccountUser } from './lib/api-client';
import mascot from './assets/freetalk-mascot.png';
const signalingUrl = import.meta.env.VITE_SIGNALING_URL || 'ws://127.0.0.1:8787/ws';
const inviteBaseUrl = import.meta.env.VITE_INVITE_BASE_URL || DEFAULT_INVITE_BASE_URL;
const NO_LOCAL_VIDEO: LocalVideoState = {
  cameraEnabled: false,
  screenEnabled: false,
  screenAudioEnabled: false,
  source: 'none',
};

interface EnterRoomOptions {
  room?: string;
  authToken?: string;
  displayName?: string;
  guest?: boolean;
}

function processingSettings(settings: LocalSettings) {
  return {
    transmissionMode: settings.transmissionMode,
    vadThreshold: settings.vadThreshold,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
    echoCancellation: settings.echoCancellation,
    comfortNoise: settings.comfortNoise,
  };
}

function videoPreferences(settings: LocalSettings): VideoPreferences {
  return {
    cameraDeviceId: settings.cameraDeviceId,
    screenResolution: settings.screenResolution,
    screenFrameRate: settings.screenFrameRate,
    screenAudioByDefault: settings.screenAudioByDefault,
    screenAdaptiveQuality: settings.screenAdaptiveQuality,
  };
}

function storedIdentity(key: string) {
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const value = crypto.randomUUID();
  sessionStorage.setItem(key, value);
  return value;
}

export function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [accountUser, setAccountUser] = useState<AccountUser>();
  const [accountReady, setAccountReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [guestMode, setGuestMode] = useState(false);
  const [lockedFeatureOpen, setLockedFeatureOpen] = useState(false);
  const [name, setName] = useState(settings.displayName);
  const [roomId, setRoomId] = useState<string>();
  const [roomDestination, setRoomDestination] = useState<AccountDestination>('room');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [peerState, setPeerState] = useState<PeerUiState>({});
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [signalState, setSignalState] = useState<SignalingState>('offline');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [joining, setJoining] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [pendingInviteRoom, setPendingInviteRoom] = useState<string>();
  const [devices, setDevices] = useState<{
    inputs: MediaDeviceInfo[];
    outputs: MediaDeviceInfo[];
    cameras: MediaDeviceInfo[];
  }>({ inputs: [], outputs: [], cameras: [] });
  const [muted, setMuted] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ kind: 'idle' });
  const [appVersion, setAppVersion] = useState('0.4.0-beta.1');
  const [turnAvailable, setTurnAvailable] = useState(false);
  const [localVideo, setLocalVideo] = useState<LocalVideoState>(NO_LOCAL_VIDEO);
  const [remoteVideos, setRemoteVideos] = useState<RemoteVideoUiState>({});
  const [videoBusy, setVideoBusy] = useState(false);
  const [roomStartedAt, setRoomStartedAt] = useState(0);
  const [reactions, setReactions] = useState<
    Array<{ id: string; participantId: string; reaction: Reaction }>
  >([]);
  const selfId = useRef(storedIdentity('freetalk.clientId'));
  const sessionId = useRef(storedIdentity('freetalk.sessionId'));
  const audio = useRef<AudioManager | undefined>(undefined);
  const video = useRef<VideoManager | undefined>(undefined);
  const remoteVideoStreams = useRef(
    new Map<string, Partial<Record<VideoMediaSource, MediaStream>>>(),
  );
  const peers = useRef<PeerManager | undefined>(undefined);
  const signaling = useRef<SignalingClient | undefined>(undefined);
  const currentIceServers = useRef<RTCIceServer[]>(DEFAULT_ICE_SERVERS);
  const notificationSounds = useRef(new NotificationSounds());
  const participantNotifications = useRef(new ParticipantNotificationTracker());
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const moderationPending = useRef<{ id: string; name: string } | undefined>(undefined);
  const listeningDiagnostics = useRef(new Set<string>());
  const pendingRoomId = useRef<string | undefined>(undefined);
  const enterRoomRef = useRef<(create: boolean, options?: EnterRoomOptions) => Promise<void>>(
    async () => undefined,
  );
  const joinedRoom = useRef(false);
  const awaitingRejoin = useRef(false);
  const joinTimer = useRef<number | undefined>(undefined);
  const reactionTimers = useRef(new Map<string, number>());
  const guestWarningTimer = useRef<number | undefined>(undefined);
  const remoteAudio = useRef(
    new RemoteAudio((peerId, speaking) =>
      setPeerState((old) => ({
        ...old,
        [peerId]: {
          connection: old[peerId]?.connection ?? 'new',
          speaking,
          hasAudio: old[peerId]?.hasAudio ?? false,
        },
      })),
    ),
  );
  const remoteScreenAudio = useRef(new RemoteAudio());

  const updateSettings = useCallback((patch: Partial<LocalSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  useEffect(() => {
    void accountClient.restore().then((user) => {
      if (user) {
        setAccountUser(user);
        setName(user.displayName);
      }
      setAccountReady(true);
    });
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void subscribeToRoomDeepLinks((code) => {
      setPendingInviteRoom(code);
      setNotice(`Открыто приглашение в комнату ${code}`);
    }, inviteBaseUrl)
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const cleanup = useCallback(() => {
    if (joinTimer.current) window.clearTimeout(joinTimer.current);
    joinTimer.current = undefined;
    pendingRoomId.current = undefined;
    joinedRoom.current = false;
    awaitingRejoin.current = false;
    signaling.current?.close();
    signaling.current = undefined;
    peers.current?.closeAll();
    peers.current = undefined;
    video.current?.dispose();
    video.current = undefined;
    audio.current?.stop();
    audio.current = undefined;
    remoteAudio.current.closeAll();
    remoteScreenAudio.current.closeAll();
    notificationSounds.current.stop();
    participantNotifications.current.clear();
    listeningDiagnostics.current.clear();
    remoteVideoStreams.current.clear();
    currentIceServers.current = DEFAULT_ICE_SERVERS;
    for (const timer of reactionTimers.current.values()) window.clearTimeout(timer);
    if (guestWarningTimer.current) window.clearTimeout(guestWarningTimer.current);
    guestWarningTimer.current = undefined;
    reactionTimers.current.clear();
    setRoomId(undefined);
    setRoomDestination('room');
    setParticipants([]);
    setPeerState({});
    setMuted(false);
    setSignalState('offline');
    setJoining(false);
    setTurnAvailable(false);
    setLocalVideo(NO_LOCAL_VIDEO);
    setRemoteVideos({});
    setVideoBusy(false);
    setRoomStartedAt(0);
    setReactions([]);
  }, []);

  useEffect(() => {
    remoteAudio.current.setMasterVolume(settings.outputVolume);
    remoteScreenAudio.current.setMasterVolume(settings.outputVolume);
  }, [settings.outputVolume]);

  useEffect(() => {
    remoteAudio.current.setDucking(
      settings.echoDucking && localSpeaking,
      settings.echoDuckingLevel,
    );
  }, [localSpeaking, settings.echoDucking, settings.echoDuckingLevel]);

  useEffect(() => {
    void currentVersion().then((version) => setAppVersion(version));
    const timer = window.setTimeout(() => {
      void checkForUpdate().then((status) => {
        if (status.kind === 'available') {
          setUpdateStatus(status);
          setNotice(`Доступно обновление FreeTalk ${status.version}`);
        }
      });
    }, 2500);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const leave = () => {
      signaling.current?.close();
      peers.current?.closeAll();
      video.current?.dispose();
      audio.current?.stop();
      remoteAudio.current.closeAll();
      remoteScreenAudio.current.closeAll();
      notificationSounds.current.stop();
    };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, []);

  useEffect(() => {
    // NetworkInformation.change also fires when WebView merely updates its
    // estimated RTT/downlink. Reconnecting on that signal caused a complete
    // room rejoin roughly every 35 seconds on otherwise healthy calls.
    const recoverAfterNetworkReturn = () => signaling.current?.reconnectNow('online');
    window.addEventListener('online', recoverAfterNetworkReturn);
    return () => window.removeEventListener('online', recoverAfterNetworkReturn);
  }, []);

  useEffect(() => {
    const targetIsEditable = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.matches('input, textarea, select') || target.isContentEditable);
    const down = (event: KeyboardEvent) => {
      if (
        settings.transmissionMode !== 'push-to-talk' ||
        event.code !== settings.pushToTalkKey ||
        event.repeat ||
        targetIsEditable(event.target)
      ) {
        if (settings.typingAttenuation && targetIsEditable(event.target)) {
          audio.current?.setTypingSuppressed(true);
          if (typingTimer.current) clearTimeout(typingTimer.current);
          typingTimer.current = setTimeout(() => audio.current?.setTypingSuppressed(false), 180);
        }
        return;
      }
      event.preventDefault();
      audio.current?.setPushToTalkPressed(true);
    };
    const up = (event: KeyboardEvent) => {
      if (settings.transmissionMode !== 'push-to-talk' || event.code !== settings.pushToTalkKey)
        return;
      event.preventDefault();
      audio.current?.setPushToTalkPressed(false);
    };
    const blur = () => {
      audio.current?.setPushToTalkPressed(false);
      audio.current?.setTypingSuppressed(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      if (typingTimer.current) clearTimeout(typingTimer.current);
    };
  }, [settings.pushToTalkKey, settings.transmissionMode, settings.typingAttenuation]);

  const refreshDevices = useCallback(async () => {
    try {
      setDevices(await AudioManager.listDevices());
    } catch {
      /* permission is requested on join */
    }
  }, []);
  useEffect(() => {
    void refreshDevices();
    navigator.mediaDevices?.addEventListener('devicechange', refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices);
  }, [refreshDevices]);

  useEffect(() => {
    for (const [peerId, state] of Object.entries(peerState)) {
      if (
        state.connection === 'connected' &&
        state.hasAudio &&
        !listeningDiagnostics.current.has(peerId)
      ) {
        listeningDiagnostics.current.add(peerId);
        connectionDiagnostics.record('ui-listening', peerId);
      }
    }
  }, [peerState]);

  const handleServerMessage = useCallback(
    async (message: ServerMessage) => {
      if (message.type === 'error') {
        setJoining(false);
        if (message.fatal) cleanup();
        setError(
          message.code === 'ROOM_NOT_FOUND' ? 'Комнаты больше не существует' : message.message,
        );
        return;
      }
      if (message.type === 'ice-config') {
        currentIceServers.current = message.iceServers;
        setTurnAvailable(hasTurnServer(message.iceServers));
        // During a signaling rejoin the next joined-room message replaces all
        // peer connections. Restarting the old peer here creates a ghost offer
        // whose late answer can be delivered to the replacement connection.
        if (!awaitingRejoin.current) peers.current?.updateIceServers(message.iceServers);
        return;
      }
      if (message.type === 'joined-room') {
        awaitingRejoin.current = false;
        joinedRoom.current = true;
        if (joinTimer.current) window.clearTimeout(joinTimer.current);
        joinTimer.current = undefined;
        if (pendingRoomId.current) setRoomId(pendingRoomId.current);
        setRoomDestination('room');
        setJoining(false);
        setParticipants(message.participants);
        setRoomStartedAt(message.roomStartedAt ?? Date.now());
        participantNotifications.current.reset(
          message.participants.map((participant) => participant.id),
        );
        peers.current?.closeAll();
        remoteAudio.current.closeAll();
        remoteScreenAudio.current.closeAll();
        remoteVideoStreams.current.clear();
        setRemoteVideos({});
        const localStream = audio.current?.getStream();
        if (!localStream) return;
        const peerManager = new PeerManager(
          selfId.current,
          currentIceServers.current,
          localStream,
          (signal) => {
            const { from: _from, ...clientSignal } = signal;
            void _from;
            signaling.current?.send(clientSignal as ClientMessage);
          },
          {
            onTrack: (peerId, stream) => {
              setPeerState((old) => ({
                ...old,
                [peerId]: {
                  connection: old[peerId]?.connection ?? 'new',
                  speaking: old[peerId]?.speaking ?? false,
                  hasAudio: true,
                },
              }));
              connectionDiagnostics.record('remote-audio-attach:start', peerId);
              void remoteAudio.current
                .attach(
                  peerId,
                  stream,
                  settings.peerVolumes[peerId] ?? 1,
                  settings.mutedPeers[peerId] ?? false,
                  settings.outputDeviceId,
                )
                .then(() => connectionDiagnostics.record('remote-audio-attach:end', peerId))
                .catch(() => connectionDiagnostics.record('remote-audio-attach:error', peerId));
            },
            onScreenAudioTrack: (peerId, stream) => {
              connectionDiagnostics.record('remote-screen-audio-attach:start', peerId);
              void remoteScreenAudio.current
                .attach(
                  peerId,
                  stream,
                  settings.screenVolumes[peerId] ?? 1,
                  settings.mutedPeers[peerId] ?? false,
                  settings.outputDeviceId,
                )
                .then(() => connectionDiagnostics.record('remote-screen-audio-attach:end', peerId))
                .catch(() =>
                  connectionDiagnostics.record('remote-screen-audio-attach:error', peerId),
                );
            },
            onVideoTrack: (peerId, source, stream) => {
              const streams = remoteVideoStreams.current.get(peerId) ?? {};
              streams[source] = stream;
              remoteVideoStreams.current.set(peerId, streams);
              setRemoteVideos((old) => ({
                ...old,
                [peerId]: {
                  ...old[peerId],
                  [source]: stream,
                },
              }));
            },
            onVideoState: (peerId, source, active) => {
              if (source === 'screen' && !active) remoteScreenAudio.current.remove(peerId);
              setRemoteVideos((old) => ({
                ...old,
                [peerId]: {
                  ...old[peerId],
                  [source]: active ? remoteVideoStreams.current.get(peerId)?.[source] : undefined,
                },
              }));
            },
            onState: (peerId, connection) =>
              setPeerState((old) => ({
                ...old,
                [peerId]: {
                  connection,
                  speaking: old[peerId]?.speaking ?? false,
                  hasAudio: old[peerId]?.hasAudio ?? false,
                },
              })),
          },
          videoPreferences(settings),
        );
        peers.current = peerManager;
        const currentVideo = video.current?.getTracks();
        if (currentVideo?.camera) void peerManager.setVideoTrack(currentVideo.camera, 'camera');
        if (currentVideo?.screen)
          void peerManager.setVideoTrack(currentVideo.screen, 'screen', currentVideo.screenStream);
        for (const participant of message.participants)
          if (participant.id !== selfId.current) peerManager.ensure(participant.id);
        return;
      }
      if (message.type === 'participant-joined') {
        const shouldNotify = participantNotifications.current.joined(
          message.participant.id,
          selfId.current,
        );
        setParticipants((old) => [
          ...old.filter((item) => item.id !== message.participant.id),
          message.participant,
        ]);
        peers.current?.ensure(message.participant.id);
        if (shouldNotify) void notificationSounds.current.playJoined();
        return;
      }
      if (message.type === 'participant-updated') {
        setParticipants((old) =>
          old.map((participant) =>
            participant.id === message.participant.id ? message.participant : participant,
          ),
        );
        return;
      }
      if (message.type === 'reaction') {
        setReactions((old) => [...old.filter((item) => item.id !== message.id), message]);
        const existing = reactionTimers.current.get(message.id);
        if (existing) window.clearTimeout(existing);
        reactionTimers.current.set(
          message.id,
          window.setTimeout(() => {
            setReactions((old) => old.filter((item) => item.id !== message.id));
            reactionTimers.current.delete(message.id);
          }, 2_850),
        );
        return;
      }
      if (message.type === 'participant-left') {
        const shouldNotify = participantNotifications.current.disconnected(
          message.participantId,
          selfId.current,
        );
        setParticipants((old) => old.filter((item) => item.id !== message.participantId));
        peers.current?.remove(message.participantId);
        remoteAudio.current.remove(message.participantId);
        remoteScreenAudio.current.remove(message.participantId);
        remoteVideoStreams.current.delete(message.participantId);
        setRemoteVideos((old) => {
          const next = { ...old };
          delete next[message.participantId];
          return next;
        });
        if (shouldNotify) void notificationSounds.current.playDisconnected();
        return;
      }
      if (message.type === 'participants') {
        setParticipants(message.participants);
        participantNotifications.current.reset(
          message.participants.map((participant) => participant.id),
        );
        return;
      }
      if (message.type === 'mute-changed') {
        setParticipants((old) =>
          old.map((item) =>
            item.id === message.participantId ? { ...item, muted: message.muted } : item,
          ),
        );
        if (message.muted && moderationPending.current?.id === message.participantId) {
          setNotice(`Микрофон ${moderationPending.current.name} выключен`);
          moderationPending.current = undefined;
        }
        return;
      }
      if (message.type === 'force-mute') {
        setMuted(true);
        audio.current?.setMuted(true);
        setNotice('Создатель комнаты выключил ваш микрофон');
        return;
      }
      if (message.type === 'owner-changed') {
        setParticipants((old) =>
          old.map((participant) => ({
            ...participant,
            isOwner: participant.id === message.ownerId,
          })),
        );
        if (message.ownerId === selfId.current)
          setNotice('Вы стали создателем комнаты и получили управление участниками');
        return;
      }
      if (
        message.type === 'offer' ||
        message.type === 'answer' ||
        message.type === 'ice-candidate'
      ) {
        try {
          await peers.current?.handle(message);
        } catch {
          setError('Не удалось согласовать прямое медиасоединение. Возможно, сети требуется TURN.');
        }
      }
      if (message.type === 'room-closed' || message.type === 'participant-disconnected') {
        setError(message.reason);
        cleanup();
      }
    },
    [cleanup, settings],
  );

  const enterRoom = async (create: boolean, options: EnterRoomOptions = {}) => {
    setError('');
    setNotice('');
    const cleanName = (options.displayName ?? accountUser?.displayName ?? name).trim();
    if (
      !cleanName ||
      cleanName.length > 32 ||
      cleanName.includes('<') ||
      cleanName.includes('>') ||
      [...cleanName].some((character) => character.charCodeAt(0) < 32)
    ) {
      setError('Введите имя от 1 до 32 символов без < и >.');
      return;
    }
    const code = create ? (options.room ?? generateRoomCode()) : parseRoomCode(options.room ?? '');
    if (!code) {
      setError('Введите корректный 12-символьный код или ссылку-приглашение.');
      return;
    }
    connectionDiagnostics.startSession({
      action: create ? 'create-room' : 'join-room',
      roomId: code,
      peerId: selfId.current,
    });
    void notificationSounds.current.prepare(settings.outputDeviceId);
    setJoining(true);
    try {
      const manager = new AudioManager(
        setLocalSpeaking,
        setInputLevel,
        processingSettings(settings),
      );
      const stream = await manager.start(settings.inputDeviceId);
      void stream;
      manager.setMuted(false);
      audio.current = manager;
      video.current = new VideoManager(
        async (track, source, stream) => {
          await peers.current?.setVideoTrack(track, source, stream);
        },
        setLocalVideo,
        setError,
        setNotice,
        videoPreferences(settings),
      );
      await refreshDevices();
      updateSettings({ displayName: cleanName });
      setName(cleanName);
      pendingRoomId.current = code;
      joinedRoom.current = false;
      const client = new SignalingClient(signalingUrl, handleServerMessage, (state, attempt) => {
        if (state === 'reconnecting') awaitingRejoin.current = true;
        setSignalState(state);
        setReconnectAttempt(attempt ?? 0);
        if (state === 'reconnecting') setNotice('Сеть недоступна — пытаемся переподключиться…');
        else if (state === 'connected') setNotice('');
        else if (state === 'offline' && joinedRoom.current) {
          setError('Соединение с сервером потеряно. Выйдите из комнаты и подключитесь снова.');
        }
      });
      signaling.current = client;
      client.connect({
        type: create ? 'create-room' : 'join-room',
        roomId: code,
        clientId: selfId.current,
        sessionId: sessionId.current,
        authToken: options.authToken ?? accountClient.signalingToken,
        name: cleanName,
        avatar: settings.avatarDataUrl || undefined,
      });
      setGuestMode(Boolean(options.guest));
      if (options.guest) {
        guestWarningTimer.current = window.setTimeout(
          () => setNotice('Осталось 5 минут. Зарегистрируйтесь, чтобы общаться без ограничений.'),
          25 * 60_000,
        );
      }
      joinTimer.current = window.setTimeout(() => {
        if (joinedRoom.current) return;
        cleanup();
        setError('Сервер голосовых комнат недоступен. Проверьте интернет или адрес сигналинга.');
      }, 20_000);
    } catch (caught) {
      setJoining(false);
      setError(caught instanceof Error ? caught.message : 'Не удалось войти в комнату');
      cleanup();
    }
  };
  enterRoomRef.current = enterRoom;

  useEffect(() => {
    if (!pendingInviteRoom || !accountReady || joining) return;
    if (roomId) {
      if (roomId !== pendingInviteRoom)
        setNotice('Сначала выйдите из текущей комнаты, затем откройте приглашение ещё раз');
      setPendingInviteRoom(undefined);
      return;
    }
    if (!accountUser) return;
    const code = pendingInviteRoom;
    setPendingInviteRoom(undefined);
    void enterRoomRef.current(false, { room: code });
  }, [accountReady, accountUser, joining, pendingInviteRoom, roomId]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    audio.current?.setMuted(next);
    signaling.current?.send({ type: 'mute-changed', muted: next });
  };

  const runVideoAction = async (action: 'camera' | 'screen') => {
    if (guestMode) {
      setLockedFeatureOpen(true);
      return;
    }
    if (!video.current || videoBusy) return;
    setError('');
    setVideoBusy(true);
    try {
      if (action === 'camera') await video.current.toggleCamera();
      else await video.current.toggleScreen(settings.screenAudioByDefault);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось изменить источник видео');
    } finally {
      setVideoBusy(false);
    }
  };

  const loginAccount = async (login: string, password: string, captchaToken?: string) => {
    setAuthBusy(true);
    setError('');
    try {
      const user = await accountClient.login(login, password, captchaToken);
      setAccountUser(user);
      setName(user.displayName);
      setGuestMode(false);
      setCaptchaRequired(false);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'CAPTCHA_REQUIRED')
        setCaptchaRequired(true);
      setError(caught instanceof Error ? caught.message : 'Не удалось войти');
    } finally {
      setAuthBusy(false);
    }
  };

  const registerAccount = async (input: Parameters<typeof accountClient.register>[0]) => {
    setAuthBusy(true);
    setError('');
    try {
      await accountClient.register(input);
      setNotice('Код подтверждения отправлен на почту');
      return true;
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'CAPTCHA_REQUIRED')
        setCaptchaRequired(true);
      setError(caught instanceof Error ? caught.message : 'Не удалось создать аккаунт');
      return false;
    } finally {
      setAuthBusy(false);
    }
  };

  const resendVerificationAccount = async (email: string) => {
    setAuthBusy(true);
    setError('');
    try {
      await accountClient.resendVerification(email);
      setNotice('Новый код отправлен. Он действует 30 минут.');
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось отправить письмо');
      return false;
    } finally {
      setAuthBusy(false);
    }
  };

  const verifyEmailAccount = async (email: string, code: string) => {
    setAuthBusy(true);
    setError('');
    try {
      const user = await accountClient.verifyEmail(email, code);
      setAccountUser(user);
      setName(user.displayName);
      setGuestMode(false);
      setNotice('Почта подтверждена. Добро пожаловать в FreeTalk!');
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Код неверный или истёк');
      return false;
    } finally {
      setAuthBusy(false);
    }
  };

  const joinAsGuest = async (input: string, captchaToken: string) => {
    const code = parseRoomCode(input);
    if (!code) return setError('Введите корректный код или ссылку комнаты.');
    setAuthBusy(true);
    setError('');
    try {
      const anonymousUserId =
        localStorage.getItem('freetalk.anonymousUserId') || crypto.randomUUID();
      localStorage.setItem('freetalk.anonymousUserId', anonymousUserId);
      const guest = await accountClient.guestJoinToken(anonymousUserId, code, captchaToken);
      await enterRoom(false, {
        room: code,
        authToken: guest.guestJoinToken,
        displayName: guest.displayName,
        guest: true,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось войти как гость');
    } finally {
      setAuthBusy(false);
    }
  };

  const logoutAccount = async () => {
    cleanup();
    await accountClient.logout();
    setAccountUser(undefined);
    setGuestMode(false);
    setNotice('Вы вышли из аккаунта');
  };

  const copyInvite = async () => {
    if (!roomId) return;
    try {
      await navigator.clipboard.writeText(roomInviteUrl(roomId, inviteBaseUrl));
      setNotice('Ссылка-приглашение скопирована');
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 1800);
    } catch {
      setNotice(`Код комнаты: ${roomId}`);
    }
  };

  const selectInput = async (deviceId: string) => {
    updateSettings({ inputDeviceId: deviceId });
    try {
      const stream = await audio.current?.switchInput(deviceId, processingSettings(settings));
      const track = stream?.getAudioTracks()[0];
      if (track) await peers.current?.replaceAudioTrack(track);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось переключить микрофон');
    }
  };

  const changeAudioSettings = async (patch: Partial<LocalSettings>, restart: boolean) => {
    const next = { ...settings, ...patch };
    updateSettings(patch);
    if (!audio.current) return;
    try {
      if (restart) {
        const stream = await audio.current.switchInput(
          next.inputDeviceId,
          processingSettings(next),
        );
        const track = stream.getAudioTracks()[0];
        if (track) await peers.current?.replaceAudioTrack(track);
        audio.current.setMuted(muted);
      } else {
        audio.current.setSettings(processingSettings(next));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось применить аудионастройки');
    }
  };

  const changeVideoSettings = async (patch: Partial<LocalSettings>) => {
    const next = { ...settings, ...patch };
    updateSettings(patch);
    const preferences = videoPreferences(next);
    video.current?.setPreferences(preferences);
    peers.current?.setVideoPreferences(preferences);
  };

  const selectCamera = async (deviceId: string) => {
    const next = { ...settings, cameraDeviceId: deviceId };
    updateSettings({ cameraDeviceId: deviceId });
    video.current?.setPreferences(videoPreferences(next));
    try {
      await video.current?.setCameraDevice(deviceId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось переключить камеру');
    }
  };

  const runUpdateCheck = async () => {
    setUpdateStatus({ kind: 'checking' });
    setUpdateStatus(await checkForUpdate());
  };

  const installUpdate = async () => {
    try {
      await installPendingUpdate(setUpdateStatus);
    } catch (caught) {
      setUpdateStatus({
        kind: 'error',
        message: caught instanceof Error ? caught.message : 'Не удалось установить обновление.',
      });
    }
  };

  const moderationMute = (participantId: string, participantName: string) => {
    moderationPending.current = { id: participantId, name: participantName };
    const sent = signaling.current?.send({
      type: 'moderation-mute',
      targetParticipantId: participantId,
    });
    if (!sent) {
      moderationPending.current = undefined;
      setError('Не удалось выключить микрофон участника');
    }
  };

  const resetAudioSettings = () => {
    const reset = {
      ...defaultSettings(),
      displayName: settings.displayName,
      avatarDataUrl: settings.avatarDataUrl,
      profileChangeTimestamps: settings.profileChangeTimestamps,
    };
    void changeAudioSettings(reset, true);
    video.current?.setPreferences(videoPreferences(reset));
    peers.current?.setVideoPreferences(videoPreferences(reset));
    setNotice('Настройки сброшены');
  };
  const saveProfile = async (
    displayName: string,
    avatarDataUrl: string,
    username: string | undefined,
    bio: string,
    coverDataUrl: string,
  ) => {
    if (
      displayName === settings.displayName &&
      avatarDataUrl === (accountUser?.avatarUrl ?? settings.avatarDataUrl) &&
      (!username || username === accountUser?.username) &&
      bio === (accountUser?.bio ?? '') &&
      coverDataUrl === (accountUser?.coverUrl ?? '')
    )
      return;
    const history = nextProfileChangeHistory(settings.profileChangeTimestamps);
    if (!history) throw new Error('Профиль можно изменить не более трёх раз за пять часов.');
    let savedAccountUser = accountUser;
    if (accountUser) {
      const updated = await accountClient.updateProfile({
        displayName,
        ...(username && username !== accountUser.username ? { username } : {}),
        bio: bio.trim() || null,
      });
      let mediaChanged = false;
      if (avatarDataUrl !== (accountUser.avatarUrl ?? '')) {
        if (avatarDataUrl) await accountClient.uploadAvatar(avatarDataUrl);
        else await accountClient.deleteAvatar();
        mediaChanged = true;
      }
      if (coverDataUrl !== (accountUser.coverUrl ?? '')) {
        if (coverDataUrl) await accountClient.uploadCover(coverDataUrl);
        else await accountClient.deleteCover();
        mediaChanged = true;
      }
      savedAccountUser = mediaChanged ? await accountClient.getMe() : updated;
      setAccountUser(savedAccountUser);
    }
    const savedAvatar = savedAccountUser?.avatarUrl ?? avatarDataUrl;
    if (roomId) {
      const sent = signaling.current?.send({
        type: 'update-profile',
        name: displayName,
        avatar: savedAvatar || undefined,
      });
      if (!sent) throw new Error('Нет соединения с сервером. Попробуйте ещё раз.');
    }
    updateSettings({ displayName, avatarDataUrl: savedAvatar, profileChangeTimestamps: history });
    setName(displayName);
    setParticipants((old) =>
      old.map((participant) =>
        participant.id === selfId.current
          ? { ...participant, name: displayName, avatar: savedAvatar || undefined }
          : participant,
      ),
    );
  };

  const sendReaction = (reaction: Reaction) => {
    const sent = signaling.current?.send({ type: 'reaction', id: crypto.randomUUID(), reaction });
    if (!sent) setNotice('Не удалось отправить реакцию');
  };

  const selectOutput = async (deviceId: string) => {
    updateSettings({ outputDeviceId: deviceId });
    await Promise.all([
      remoteAudio.current.setOutput(deviceId),
      remoteScreenAudio.current.setOutput(deviceId),
      notificationSounds.current.setOutput(deviceId),
    ]);
  };
  const setPeerVolume = (peerId: string, value: number) => {
    const peerVolumes = { ...settings.peerVolumes, [peerId]: value };
    updateSettings({ peerVolumes });
    remoteAudio.current.setVolume(peerId, value);
  };
  const setScreenVolume = (peerId: string, value: number) => {
    updateSettings({ screenVolumes: { ...settings.screenVolumes, [peerId]: value } });
    remoteScreenAudio.current.setVolume(peerId, value);
  };
  const togglePeerMute = (peerId: string) => {
    const value = !(settings.mutedPeers[peerId] ?? false);
    const mutedPeers = { ...settings.mutedPeers, [peerId]: value };
    updateSettings({ mutedPeers });
    remoteAudio.current.setMuted(peerId, value);
    remoteScreenAudio.current.setMuted(peerId, value);
  };
  const saveConnectionDiagnostics = async () => {
    return invoke<string>('save_connection_diagnostics', {
      contents: connectionDiagnostics.toText(),
    });
  };

  const settingsPanel = settingsOpen ? (
    <SettingsPanel
      settings={settings}
      devices={devices}
      inputLevel={inputLevel}
      appVersion={appVersion}
      updateStatus={updateStatus}
      turnAvailable={turnAvailable}
      outputSupported={remoteAudio.current.supportsOutputSelection()}
      accountUser={accountUser}
      guestMode={guestMode}
      onClose={() => setSettingsOpen(false)}
      onInput={(value) => void selectInput(value)}
      onOutput={(value) => void selectOutput(value)}
      onCamera={(value) => void selectCamera(value)}
      onSetting={(patch, restart) => void changeAudioSettings(patch, restart)}
      onVideoSetting={(patch) => void changeVideoSettings(patch)}
      onKey={(value) => updateSettings({ pushToTalkKey: value })}
      onReset={resetAudioSettings}
      onCheckUpdate={() => void runUpdateCheck()}
      onInstallUpdate={() => void installUpdate()}
      onSaveDiagnostics={saveConnectionDiagnostics}
      onSaveProfile={saveProfile}
      onAccountLogout={() => void logoutAccount()}
      onDeleteAccount={async (password) => {
        await accountClient.deleteAccount(password);
        cleanup();
        setAccountUser(undefined);
        setSettingsOpen(false);
        setNotice('Аккаунт удалён');
      }}
      onChangePassword={async (currentPassword, newPassword) => {
        await accountClient.changePassword(currentPassword, newPassword);
        setNotice('Пароль изменён, остальные сессии завершены');
      }}
    />
  ) : null;

  if (!roomId) {
    return (
      <>
        {!accountReady ? (
          <main className="account-loading" aria-label="Восстанавливаем сессию">
            <img className="account-loading-mascot" src={mascot} alt="" aria-hidden="true" />
          </main>
        ) : accountUser ? (
          <HomeView
            user={accountUser}
            busy={joining}
            error={error}
            onClearError={() => setError('')}
            onCreateRoom={(code) => void enterRoom(true, { room: code })}
            onJoinRoom={(code) => void enterRoom(false, { room: code })}
            onSettings={() => setSettingsOpen(true)}
            onLogout={() => void logoutAccount()}
          />
        ) : (
          <WelcomeScreen
            error={error}
            busy={authBusy || joining}
            captchaRequired={captchaRequired}
            updateStatus={updateStatus}
            savedDisplayName={name}
            initialRoomCode={pendingInviteRoom}
            onLogin={(login, password, captcha) => void loginAccount(login, password, captcha)}
            onRegister={registerAccount}
            onResendVerification={resendVerificationAccount}
            onVerifyEmail={verifyEmailAccount}
            onGuestJoin={(code, captcha) => {
              setPendingInviteRoom(undefined);
              void joinAsGuest(code, captcha);
            }}
            onForgotPassword={(email) =>
              void accountClient
                .forgotPassword(email)
                .then((result) => setNotice(result.message))
                .catch((caught: unknown) =>
                  setError(
                    caught instanceof Error ? caught.message : 'Не удалось отправить письмо',
                  ),
                )
            }
            onResetPassword={(token, password) =>
              void accountClient
                .resetPassword(token, password)
                .then(() => setNotice('Пароль изменён. Теперь войдите с новым паролем.'))
                .catch((caught: unknown) =>
                  setError(caught instanceof Error ? caught.message : 'Не удалось изменить пароль'),
                )
            }
            onSettings={() => setSettingsOpen(true)}
          />
        )}
        {settingsPanel}
        <AppToast message={notice} onClose={() => setNotice('')} />
      </>
    );
  }

  const roomView = (
    <RoomView
      embedded={Boolean(accountUser)}
      roomId={roomId}
      participants={participants}
      selfId={selfId.current}
      peerState={peerState}
      localSpeaking={localSpeaking}
      localVideo={localVideo}
      remoteVideos={remoteVideos}
      videoBusy={videoBusy}
      muted={muted}
      roomStartedAt={roomStartedAt}
      reactions={reactions}
      settings={settings}
      signalingState={signalState}
      reconnectAttempt={reconnectAttempt}
      inviteCopied={inviteCopied}
      turnAvailable={turnAvailable}
      onCopyInvite={() => void copyInvite()}
      onMute={toggleMute}
      onCamera={() => void runVideoAction('camera')}
      onScreen={() => void runVideoAction('screen')}
      onReaction={sendReaction}
      onSettings={() => setSettingsOpen(true)}
      onLeave={cleanup}
      onPeerVolume={setPeerVolume}
      onScreenVolume={setScreenVolume}
      onPeerMute={togglePeerMute}
      onModerationMute={moderationMute}
    />
  );

  return (
    <>
      {accountUser ? (
        <main className="account-shell room-account-shell">
          <AccountSidebar
            user={accountUser}
            activePage={roomDestination}
            roomActive
            onNavigate={setRoomDestination}
            onSettings={() => setSettingsOpen(true)}
            onLogout={() => void logoutAccount()}
          />
          <section className="account-room-workspace">
            <div className={`room-view-slot ${roomDestination === 'room' ? '' : 'is-hidden'}`}>
              {roomView}
            </div>
            {roomDestination !== 'room' && (
              <HomeView
                embedded
                page={roomDestination as AccountPage}
                user={accountUser}
                busy={joining}
                error={error}
                onClearError={() => setError('')}
                onPageChange={(page) => setRoomDestination(page)}
                onCreateRoom={() => {
                  setNotice('Вы уже находитесь в звонке');
                  setRoomDestination('room');
                }}
                onJoinRoom={() => setNotice('Сначала завершите текущий звонок')}
                onSettings={() => setSettingsOpen(true)}
                onLogout={() => void logoutAccount()}
              />
            )}
          </section>
        </main>
      ) : (
        roomView
      )}
      {settingsPanel}
      <AppToast
        message={error || notice}
        error={Boolean(error)}
        onClose={() => {
          setError('');
          setNotice('');
        }}
      />
      {lockedFeatureOpen && (
        <div
          className="modal-backdrop locked-feature-backdrop"
          onMouseDown={() => setLockedFeatureOpen(false)}
        >
          <section
            className="locked-feature-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="locked-feature-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="locked-feature-title">Эта функция доступна после регистрации</h2>
            <p>
              Создайте аккаунт, чтобы включать камеру и демонстрацию экрана без гостевых
              ограничений.
            </p>
            <div>
              <button className="secondary" onClick={() => setLockedFeatureOpen(false)}>
                Остаться в комнате
              </button>
              <button
                className="primary"
                onClick={() => {
                  setLockedFeatureOpen(false);
                  cleanup();
                }}
              >
                Создать аккаунт
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function AppToast({
  message,
  error = false,
  onClose,
}: {
  message: string;
  error?: boolean;
  onClose(): void;
}) {
  if (!message) return null;
  return (
    <div className={`toast ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>
      <span>{message}</span>
      <button aria-label="Закрыть сообщение" onClick={onClose}>
        <X size={16} />
      </button>
    </div>
  );
}

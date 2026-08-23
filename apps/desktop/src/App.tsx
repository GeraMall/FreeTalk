import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { DEFAULT_ICE_SERVERS } from '@freetalk/config';
import type { ClientMessage, Participant, ServerMessage } from '@freetalk/protocol';
import { AudioManager } from './lib/audio-manager';
import { PeerManager } from './lib/peer-manager';
import { RemoteAudio } from './lib/remote-audio';
import { generateRoomCode, parseRoomCode } from './lib/room-code';
import { defaultSettings, loadSettings, saveSettings, type LocalSettings } from './lib/settings';
import { SignalingClient, type SignalingState } from './lib/signaling-client';
import {
  checkForUpdate,
  currentVersion,
  installPendingUpdate,
  type UpdateStatus,
} from './lib/updater';
import { RoomView, type PeerUiState } from './components/RoomView';
import { SettingsPanel } from './components/SettingsPanel';
import { WelcomeScreen } from './components/WelcomeScreen';
const signalingUrl = import.meta.env.VITE_SIGNALING_URL || 'ws://127.0.0.1:8787/ws';

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

function storedIdentity(key: string) {
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const value = crypto.randomUUID();
  sessionStorage.setItem(key, value);
  return value;
}

export function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [name, setName] = useState(settings.displayName);
  const [roomInput, setRoomInput] = useState('');
  const [roomId, setRoomId] = useState<string>();
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
  const [devices, setDevices] = useState<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }>(
    { inputs: [], outputs: [] },
  );
  const [muted, setMuted] = useState(false);
  const [pttPressed, setPttPressed] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ kind: 'idle' });
  const [appVersion, setAppVersion] = useState('0.3.3');
  const selfId = useRef(storedIdentity('freetalk.clientId'));
  const sessionId = useRef(storedIdentity('freetalk.sessionId'));
  const audio = useRef<AudioManager | undefined>(undefined);
  const peers = useRef<PeerManager | undefined>(undefined);
  const signaling = useRef<SignalingClient | undefined>(undefined);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const moderationPending = useRef<{ id: string; name: string } | undefined>(undefined);
  const pendingRoomId = useRef<string | undefined>(undefined);
  const joinedRoom = useRef(false);
  const joinTimer = useRef<number | undefined>(undefined);
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

  const updateSettings = useCallback((patch: Partial<LocalSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const cleanup = useCallback(() => {
    if (joinTimer.current) window.clearTimeout(joinTimer.current);
    joinTimer.current = undefined;
    pendingRoomId.current = undefined;
    joinedRoom.current = false;
    signaling.current?.close();
    signaling.current = undefined;
    peers.current?.closeAll();
    peers.current = undefined;
    audio.current?.stop();
    audio.current = undefined;
    remoteAudio.current.closeAll();
    setRoomId(undefined);
    setParticipants([]);
    setPeerState({});
    setMuted(false);
    setSignalState('offline');
    setJoining(false);
  }, []);

  useEffect(() => {
    remoteAudio.current.setMasterVolume(settings.outputVolume);
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
      audio.current?.stop();
      remoteAudio.current.closeAll();
    };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
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
      setPttPressed(true);
      audio.current?.setPushToTalkPressed(true);
    };
    const up = (event: KeyboardEvent) => {
      if (settings.transmissionMode !== 'push-to-talk' || event.code !== settings.pushToTalkKey)
        return;
      event.preventDefault();
      setPttPressed(false);
      audio.current?.setPushToTalkPressed(false);
    };
    const blur = () => {
      setPttPressed(false);
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

  const handleServerMessage = useCallback(
    async (message: ServerMessage) => {
      if (message.type === 'error') {
        setJoining(false);
        if (message.fatal) cleanup();
        setError(message.message);
        return;
      }
      if (message.type === 'ice-config') {
        peers.current?.updateIceServers(message.iceServers);
        return;
      }
      if (message.type === 'joined-room') {
        joinedRoom.current = true;
        if (joinTimer.current) window.clearTimeout(joinTimer.current);
        joinTimer.current = undefined;
        if (pendingRoomId.current) setRoomId(pendingRoomId.current);
        setJoining(false);
        setParticipants(message.participants);
        peers.current?.closeAll();
        const localStream = audio.current?.getStream();
        if (!localStream) return;
        peers.current = new PeerManager(
          selfId.current,
          DEFAULT_ICE_SERVERS,
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
              void remoteAudio.current.attach(
                peerId,
                stream,
                settings.peerVolumes[peerId] ?? 1,
                settings.mutedPeers[peerId] ?? false,
                settings.outputDeviceId,
              );
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
        );
        for (const participant of message.participants)
          if (participant.id !== selfId.current) peers.current.ensure(participant.id);
        return;
      }
      if (message.type === 'participant-joined') {
        setParticipants((old) => [
          ...old.filter((item) => item.id !== message.participant.id),
          message.participant,
        ]);
        peers.current?.ensure(message.participant.id);
        return;
      }
      if (message.type === 'participant-left') {
        setParticipants((old) => old.filter((item) => item.id !== message.participantId));
        peers.current?.remove(message.participantId);
        remoteAudio.current.remove(message.participantId);
        return;
      }
      if (message.type === 'participants') {
        setParticipants(message.participants);
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
          setError('Не удалось согласовать прямое аудиосоединение. Возможно, сети требуется TURN.');
        }
      }
      if (message.type === 'room-closed' || message.type === 'participant-disconnected') {
        setError(message.reason);
        cleanup();
      }
    },
    [cleanup, settings.mutedPeers, settings.outputDeviceId, settings.peerVolumes],
  );

  const enterRoom = async (create: boolean) => {
    setError('');
    setNotice('');
    const cleanName = name.trim();
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
    const code = create ? generateRoomCode() : parseRoomCode(roomInput);
    if (!code) {
      setError('Введите корректный 12-символьный код или ссылку-приглашение.');
      return;
    }
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
      await refreshDevices();
      updateSettings({ displayName: cleanName });
      setName(cleanName);
      pendingRoomId.current = code;
      joinedRoom.current = false;
      const client = new SignalingClient(
        signalingUrl,
        (message) => {
          void handleServerMessage(message);
        },
        (state, attempt) => {
          setSignalState(state);
          setReconnectAttempt(attempt ?? 0);
          if (state === 'reconnecting') setNotice('Сеть недоступна — пытаемся переподключиться…');
          else if (state === 'connected') setNotice('');
          else if (state === 'offline' && joinedRoom.current) {
            setError('Соединение с сервером потеряно. Выйдите из комнаты и подключитесь снова.');
          }
        },
      );
      signaling.current = client;
      client.connect({
        type: create ? 'create-room' : 'join-room',
        roomId: code,
        clientId: selfId.current,
        sessionId: sessionId.current,
        name: cleanName,
      });
      joinTimer.current = window.setTimeout(() => {
        if (joinedRoom.current) return;
        cleanup();
        setError('Сервер голосовых комнат недоступен. Проверьте интернет или адрес сигналинга.');
      }, 12_000);
    } catch (caught) {
      setJoining(false);
      setError(caught instanceof Error ? caught.message : 'Не удалось войти в комнату');
      cleanup();
    }
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    audio.current?.setMuted(next);
    signaling.current?.send({ type: 'mute-changed', muted: next });
  };

  const setTransmissionMode = (mode: LocalSettings['transmissionMode']) => {
    updateSettings({ transmissionMode: mode });
    audio.current?.setSettings(processingSettings({ ...settings, transmissionMode: mode }));
    setPttPressed(false);
  };

  const copyInvite = async () => {
    if (!roomId) return;
    try {
      await navigator.clipboard.writeText(`freetalk://join/${roomId}`);
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
    const reset = { ...defaultSettings(), displayName: settings.displayName };
    void changeAudioSettings(reset, true);
    setNotice('Настройки звука сброшены');
  };

  const selectOutput = async (deviceId: string) => {
    updateSettings({ outputDeviceId: deviceId });
    await remoteAudio.current.setOutput(deviceId);
  };
  const setPeerVolume = (peerId: string, value: number) => {
    const peerVolumes = { ...settings.peerVolumes, [peerId]: value };
    updateSettings({ peerVolumes });
    remoteAudio.current.setVolume(peerId, value);
  };
  const togglePeerMute = (peerId: string) => {
    const value = !(settings.mutedPeers[peerId] ?? false);
    const mutedPeers = { ...settings.mutedPeers, [peerId]: value };
    updateSettings({ mutedPeers });
    remoteAudio.current.setMuted(peerId, value);
  };

  const settingsPanel = settingsOpen ? (
    <SettingsPanel
      settings={settings}
      devices={devices}
      inputLevel={inputLevel}
      appVersion={appVersion}
      updateStatus={updateStatus}
      outputSupported={remoteAudio.current.supportsOutputSelection()}
      onClose={() => setSettingsOpen(false)}
      onInput={(value) => void selectInput(value)}
      onOutput={(value) => void selectOutput(value)}
      onSetting={(patch, restart) => void changeAudioSettings(patch, restart)}
      onKey={(value) => updateSettings({ pushToTalkKey: value })}
      onReset={resetAudioSettings}
      onCheckUpdate={() => void runUpdateCheck()}
      onInstallUpdate={() => void installUpdate()}
    />
  ) : null;

  if (!roomId) {
    return (
      <>
        <WelcomeScreen
          name={name}
          roomInput={roomInput}
          error={error}
          joining={joining}
          updateStatus={updateStatus}
          onName={setName}
          onRoomInput={setRoomInput}
          onCreate={() => void enterRoom(true)}
          onJoin={() => void enterRoom(false)}
          onSettings={() => setSettingsOpen(true)}
        />
        {settingsPanel}
        <AppToast message={notice} onClose={() => setNotice('')} />
      </>
    );
  }

  return (
    <>
      <RoomView
        roomId={roomId}
        participants={participants}
        selfId={selfId.current}
        peerState={peerState}
        localSpeaking={localSpeaking}
        muted={muted}
        pttPressed={pttPressed}
        settings={settings}
        signalingState={signalState}
        reconnectAttempt={reconnectAttempt}
        inviteCopied={inviteCopied}
        onCopyInvite={() => void copyInvite()}
        onMute={toggleMute}
        onTransmissionMode={() =>
          setTransmissionMode(
            settings.transmissionMode === 'push-to-talk' ? 'voice-activation' : 'push-to-talk',
          )
        }
        onSettings={() => setSettingsOpen(true)}
        onLeave={cleanup}
        onPeerVolume={setPeerVolume}
        onPeerMute={togglePeerMute}
        onModerationMute={moderationMute}
      />
      {settingsPanel}
      <AppToast
        message={error || notice}
        error={Boolean(error)}
        onClose={() => {
          setError('');
          setNotice('');
        }}
      />
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

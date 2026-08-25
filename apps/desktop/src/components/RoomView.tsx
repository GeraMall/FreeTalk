import { useCallback, useEffect, useRef, useState } from 'react';
import type { Participant, Reaction } from '@freetalk/protocol';
import {
  Check,
  Camera,
  CameraOff,
  Copy,
  Crown,
  LogOut,
  Maximize2,
  Mic,
  MicOff,
  MonitorUp,
  MoreHorizontal,
  Radio,
  SmilePlus,
  Settings,
  ShieldCheck,
  Square,
  UserPlus,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { LocalSettings } from '../lib/settings';
import type { SignalingState } from '../lib/signaling-client';
import type { LocalVideoState, VideoMediaSource } from '../lib/video-manager';
import { leaveWindowFullscreen, toggleMediaFullscreen } from '../lib/fullscreen';

export type PeerUiState = Record<
  string,
  { connection: RTCPeerConnectionState | 'new'; speaking: boolean; hasAudio: boolean }
>;

export type RemoteVideoUiState = Record<string, { camera?: MediaStream; screen?: MediaStream }>;

interface ExpandedMedia {
  type: VideoMediaSource;
  participantId: string;
}

interface RoomViewProps {
  roomId: string;
  selfId: string;
  participants: Participant[];
  peerState: PeerUiState;
  localSpeaking: boolean;
  localVideo: LocalVideoState;
  remoteVideos: RemoteVideoUiState;
  videoBusy: boolean;
  muted: boolean;
  roomStartedAt: number;
  reactions: Array<{ id: string; participantId: string; reaction: Reaction }>;
  signalingState: SignalingState;
  reconnectAttempt: number;
  settings: LocalSettings;
  inviteCopied: boolean;
  turnAvailable: boolean;
  onCopyInvite(): void;
  onMute(): void;
  onCamera(): void;
  onScreen(): void;
  onReaction(reaction: Reaction): void;
  onSettings(): void;
  onLeave(): void;
  onPeerVolume(peerId: string, value: number): void;
  onScreenVolume(peerId: string, value: number): void;
  onPeerMute(peerId: string): void;
  onModerationMute(peerId: string, name: string): void;
}

export function RoomView({
  roomId,
  selfId,
  participants,
  peerState,
  localSpeaking,
  localVideo,
  remoteVideos,
  videoBusy,
  muted,
  roomStartedAt,
  reactions,
  signalingState,
  reconnectAttempt,
  settings,
  inviteCopied,
  turnAvailable,
  onCopyInvite,
  onMute,
  onCamera,
  onScreen,
  onReaction,
  onSettings,
  onLeave,
  onPeerVolume,
  onScreenVolume,
  onPeerMute,
  onModerationMute,
}: RoomViewProps) {
  const [menuFor, setMenuFor] = useState<string>();
  const [expandedMedia, setExpandedMedia] = useState<ExpandedMedia>();
  const [presentedScreenId, setPresentedScreenId] = useState<string>();
  const [reactionMenuOpen, setReactionMenuOpen] = useState(false);
  const elapsed = useCallDuration(roomStartedAt);
  const ordered = [...participants].sort(
    (a, b) => Number(b.id === selfId) - Number(a.id === selfId) || a.connectedAt - b.connectedAt,
  );
  const self = participants.find((participant) => participant.id === selfId);
  const openSlots = Math.max(0, 6 - participants.length);
  const participantMedia = (participant: Participant) =>
    participant.id === selfId
      ? { camera: localVideo.cameraStream, screen: localVideo.screenStream }
      : (remoteVideos[participant.id] ?? {});
  const screenPresenters = ordered.filter((participant) =>
    Boolean(participantMedia(participant).screen),
  );
  const screenPresenter =
    screenPresenters.find((participant) => participant.id === presentedScreenId) ??
    screenPresenters[0];
  const hasCamera = ordered.some((participant) => Boolean(participantMedia(participant).camera));
  const roomMode = screenPresenter ? 'presentation' : hasCamera ? 'camera' : 'audio';
  const expandedParticipant = expandedMedia
    ? participants.find((participant) => participant.id === expandedMedia.participantId)
    : undefined;
  const expandedStream =
    expandedParticipant && expandedMedia
      ? participantMedia(expandedParticipant)[expandedMedia.type]
      : undefined;

  useEffect(() => {
    if (expandedMedia && (!expandedParticipant || !expandedStream)) setExpandedMedia(undefined);
  }, [expandedMedia, expandedParticipant, expandedStream]);

  const renderParticipant = (participant: Participant, compact = false) => {
    const isSelf = participant.id === selfId;
    const speaking = isSelf ? localSpeaking : peerState[participant.id]?.speaking;
    const connection = isSelf ? 'connected' : (peerState[participant.id]?.connection ?? 'new');
    const hasAudio = isSelf || (peerState[participant.id]?.hasAudio ?? false);
    const locallyMuted = settings.mutedPeers[participant.id] ?? false;
    const canModerate = Boolean(self?.isOwner && !isSelf);
    const media = participantMedia(participant);
    const showCamera = Boolean(media.camera);
    const status = participant.muted
      ? 'Микрофон выключен'
      : speaking
        ? 'Говорит'
        : connectionLabel(connection, hasAudio);

    return (
      <article
        className={`participant-card ${compact ? 'compact-tile' : ''} ${showCamera ? 'camera-tile media-surface' : 'audio-tile'} ${!isSelf || canModerate ? 'has-participant-menu' : ''} ${speaking ? 'speaking' : ''} ${participant.muted ? 'mic-muted' : ''}`}
        role="listitem"
        key={participant.id}
      >
        {showCamera && (
          <ParticipantVideo
            stream={media.camera!}
            source="camera"
            name={participant.name}
            mirrored
            muted
            volume={0}
            outputDeviceId={settings.outputDeviceId}
            onExpand={() => setExpandedMedia({ type: 'camera', participantId: participant.id })}
          />
        )}
        {compact && media.screen && participant.id !== screenPresenter?.id && (
          <button
            className="participant-screen-switch"
            aria-label={`Показать экран ${participant.name}`}
            onClick={() => setPresentedScreenId(participant.id)}
          >
            <MonitorUp size={13} /> Экран
          </button>
        )}

        <div className="participant-card-top media-overlay-top">
          {participant.isOwner ? <CreatorBadge compact={showCamera || compact} /> : <span />}
          <ParticipantActions
            participant={participant}
            isSelf={isSelf}
            canModerate={canModerate}
            locallyMuted={locallyMuted}
            open={menuFor === participant.id}
            onToggle={() =>
              setMenuFor((old) => (old === participant.id ? undefined : participant.id))
            }
            onClose={() => setMenuFor(undefined)}
            onPeerMute={onPeerMute}
            onModerationMute={onModerationMute}
          />
        </div>

        {!showCamera && (
          <ParticipantAvatar participant={participant} speaking={Boolean(speaking)} />
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

  return (
    <main className="room-shell">
      <header className="room-header">
        <div className="wordmark room-wordmark">
          <Radio size={20} />
          <span>FreeTalk</span>
        </div>
        <div className="room-identity">
          <div>
            <strong>Голосовая комната</strong>
            <span aria-hidden="true">•</span>
            <code>{roomId}</code>
            <button
              className="inline-icon"
              aria-label="Скопировать код комнаты"
              onClick={onCopyInvite}
            >
              {inviteCopied ? <Check size={15} /> : <Copy size={15} />}
            </button>
          </div>
          <ConnectionStatus state={signalingState} attempt={reconnectAttempt} />
        </div>
        <button className="invite-button" onClick={onCopyInvite}>
          {inviteCopied ? <Check size={18} /> : <Copy size={18} />}
          {inviteCopied ? 'Скопировано' : 'Пригласить'}
        </button>
      </header>

      <section className={`room-main room-mode-${roomMode}`}>
        <div className="participants-heading">
          <div>
            <h1>Участники</h1>
            <p>{participants.length} из 6</p>
          </div>
          <span className="room-session-meta">
            <span className="call-timer" aria-label={`Длительность звонка ${elapsed}`}>
              <i /> {elapsed}
            </span>
            <span
              className="room-security"
              title={
                turnAvailable ? 'WebRTC с резервным TURN-маршрутом' : 'Прямое WebRTC-соединение'
              }
            >
              <ShieldCheck size={14} /> Приватное соединение
            </span>
          </span>
        </div>

        {screenPresenter ? (
          <div className="presentation-layout">
            <article className="screen-stage media-surface">
              <ParticipantVideo
                stream={participantMedia(screenPresenter).screen!}
                source="screen"
                name={screenPresenter.name}
                muted={
                  screenPresenter.id === selfId || Boolean(settings.mutedPeers[screenPresenter.id])
                }
                volume={
                  (settings.screenVolumes[screenPresenter.id] ?? 1) *
                  settings.outputVolume *
                  (settings.echoDucking && localSpeaking ? settings.echoDuckingLevel : 1)
                }
                outputDeviceId={settings.outputDeviceId}
                onExpand={() =>
                  setExpandedMedia({ type: 'screen', participantId: screenPresenter.id })
                }
              />
              <div className="screen-stage-top">
                <span className="screen-stage-title">
                  <MonitorUp size={15} />
                  <span>
                    <strong>{screenPresenter.name}</strong>
                    <small>Демонстрация экрана</small>
                  </span>
                </span>
                {screenPresenter.isOwner && <CreatorBadge compact />}
              </div>
              {screenPresenter.id !== selfId && (
                <label className="screen-stage-volume">
                  <Volume2 size={15} aria-hidden="true" />
                  <span>Звук демонстрации</span>
                  <input
                    aria-label={`Громкость демонстрации ${screenPresenter.name}`}
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings.screenVolumes[screenPresenter.id] ?? 1}
                    onChange={(event) =>
                      onScreenVolume(screenPresenter.id, Number(event.target.value))
                    }
                  />
                  <output>
                    {Math.round((settings.screenVolumes[screenPresenter.id] ?? 1) * 100)}%
                  </output>
                </label>
              )}
            </article>
            <div className="participant-strip" role="list" aria-label="Участники комнаты">
              {ordered.map((participant) => renderParticipant(participant, true))}
              {openSlots > 0 && (
                <InviteCallout compact openSlots={openSlots} onCopyInvite={onCopyInvite} />
              )}
            </div>
          </div>
        ) : (
          <div
            className="participants-grid"
            data-count={participants.length}
            data-mode={roomMode}
            role="list"
          >
            {ordered.map((participant) => renderParticipant(participant))}
            {openSlots > 0 && <InviteCallout openSlots={openSlots} onCopyInvite={onCopyInvite} />}
          </div>
        )}
      </section>

      {expandedMedia && expandedParticipant && expandedStream && (
        <ExpandedMediaView
          type={expandedMedia.type}
          stream={expandedStream}
          participantName={expandedParticipant.name}
          mirrored={expandedMedia.type === 'camera'}
          speaking={
            expandedParticipant.id === selfId
              ? localSpeaking
              : Boolean(peerState[expandedParticipant.id]?.speaking)
          }
          onClose={() => setExpandedMedia(undefined)}
        />
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

      <footer className="voice-dock">
        <button className={`dock-control mic-control ${muted ? 'muted' : ''}`} onClick={onMute}>
          <span className="dock-icon">{muted ? <MicOff /> : <Mic />}</span>
          <span>
            <strong>Микрофон</strong>
            <small>{muted ? 'Выключен' : 'Включён'}</small>
          </span>
        </button>
        <div className="dock-divider" />
        <button
          className={`dock-control video-control ${localVideo.cameraEnabled ? 'active' : ''}`}
          disabled={videoBusy}
          onClick={onCamera}
        >
          <span className="dock-icon">{localVideo.cameraEnabled ? <Camera /> : <CameraOff />}</span>
          <span>
            <strong>Камера</strong>
            <small>{localVideo.cameraEnabled ? 'Включена' : 'Выключена'}</small>
          </span>
        </button>
        <div className="dock-divider" />
        <button
          className={`dock-control video-control screen-control ${localVideo.screenEnabled ? 'active sharing' : ''}`}
          disabled={videoBusy}
          onClick={onScreen}
        >
          <span className="dock-icon">{localVideo.screenEnabled ? <Square /> : <MonitorUp />}</span>
          <span>
            <strong>{localVideo.screenEnabled ? 'Стоп' : 'Экран'}</strong>
            <small>{localVideo.screenEnabled ? 'Демонстрация' : 'Поделиться'}</small>
          </span>
        </button>
        <div className="dock-divider" />
        <div className="reaction-control">
          <button
            className={`dock-control reaction-button ${reactionMenuOpen ? 'active' : ''}`}
            aria-expanded={reactionMenuOpen}
            onClick={() => setReactionMenuOpen((open) => !open)}
          >
            <span className="dock-icon">
              <SmilePlus />
            </span>
            <span>
              <strong>Реакция</strong>
              <small>Ответить эмоцией</small>
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
        <div className="dock-divider" />
        <button className="dock-control settings-control" onClick={onSettings}>
          <span className="dock-icon">
            <Settings />
          </span>
          <span>
            <strong>Настройки</strong>
            <small>Аудио и устройства</small>
          </span>
        </button>
        <div className="dock-spacer" />
        <button className="leave-button" onClick={onLeave}>
          <LogOut size={18} /> Выйти из комнаты
        </button>
      </footer>
    </main>
  );
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

function ParticipantVideo({
  stream,
  source,
  name,
  mirrored,
  muted,
  volume,
  outputDeviceId,
  onExpand,
}: {
  stream: MediaStream;
  source: VideoMediaSource;
  name: string;
  mirrored?: boolean;
  muted: boolean;
  volume: number;
  outputDeviceId: string;
  onExpand(): void;
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

  return (
    <div className={`participant-video ${source}`}>
      <video
        ref={setElement}
        className={mirrored ? 'mirrored' : undefined}
        aria-label={`${source === 'screen' ? 'Экран' : 'Камера'} ${name}`}
        autoPlay
        muted={muted}
        playsInline
      />
      <button
        className="video-fullscreen"
        aria-label={`Раскрыть ${source === 'screen' ? 'демонстрацию экрана' : 'камеру'} ${name}`}
        onClick={onExpand}
      >
        <Maximize2 size={16} />
      </button>
    </div>
  );
}

function ExpandedMediaView({
  type,
  stream,
  participantName,
  mirrored,
  speaking,
  onClose,
}: {
  type: VideoMediaSource;
  stream: MediaStream;
  participantName: string;
  mirrored: boolean;
  speaking: boolean;
  onClose(): void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const nativeFullscreen = useRef(false);
  const [closing, setClosing] = useState(false);
  const [windowFullscreen, setWindowFullscreen] = useState(false);
  const close = useCallback(() => {
    void leaveWindowFullscreen(nativeFullscreen.current);
    nativeFullscreen.current = false;
    setWindowFullscreen(false);
    setClosing(true);
  }, []);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.fullscreenElement) close();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      void leaveWindowFullscreen(nativeFullscreen.current);
    };
  }, [close]);

  return (
    <div
      className={`expanded-media-backdrop ${windowFullscreen ? 'native-fullscreen' : ''} ${closing ? 'closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`${type === 'screen' ? 'Демонстрация экрана' : 'Камера'} ${participantName}`}
      onAnimationEnd={(event) => {
        if (closing && event.currentTarget === event.target) onClose();
      }}
    >
      <div className={`expanded-media-view ${type}`} ref={surface}>
        <ParticipantVideoSurface
          stream={stream}
          source={type}
          name={participantName}
          mirrored={mirrored}
        />
        <div className="expanded-media-header">
          <span>
            {type === 'screen' ? <MonitorUp size={17} /> : <Camera size={17} />}
            <span>
              <strong>{participantName}</strong>
              <small>
                {speaking ? 'Говорит' : type === 'screen' ? 'Демонстрация экрана' : 'Камера'}
              </small>
            </span>
          </span>
          <div>
            <button
              aria-label="Открыть в полноэкранном режиме"
              onClick={() => {
                if (!surface.current) return;
                void toggleMediaFullscreen(surface.current)
                  .then((mode) => {
                    nativeFullscreen.current = mode === 'window';
                    setWindowFullscreen(mode === 'window');
                  })
                  .catch(() => undefined);
              }}
            >
              <Maximize2 size={17} />
            </button>
            <button aria-label="Закрыть раскрытое видео" onClick={close}>
              <X size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ParticipantVideoSurface({
  stream,
  source,
  name,
  mirrored,
}: {
  stream: MediaStream;
  source: VideoMediaSource;
  name: string;
  mirrored: boolean;
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
  return (
    <video
      ref={setElement}
      className={`expanded-media-video ${mirrored ? 'mirrored' : ''}`}
      aria-label={`${source === 'screen' ? 'Экран' : 'Камера'} ${name}`}
      autoPlay
      muted
      playsInline
    />
  );
}

function ParticipantActions({
  participant,
  isSelf,
  canModerate,
  locallyMuted,
  open,
  onToggle,
  onClose,
  onPeerMute,
  onModerationMute,
}: {
  participant: Participant;
  isSelf: boolean;
  canModerate: boolean;
  locallyMuted: boolean;
  open: boolean;
  onToggle(): void;
  onClose(): void;
  onPeerMute(peerId: string): void;
  onModerationMute(peerId: string, name: string): void;
}) {
  if (!canModerate && isSelf) return null;
  return (
    <>
      <button
        className="icon-button participant-menu-button"
        aria-label={`Действия для ${participant.name}`}
        aria-expanded={open}
        onClick={onToggle}
      >
        <MoreHorizontal size={19} />
      </button>
      {open && (
        <div className="participant-menu" role="menu">
          <button
            role="menuitem"
            onClick={() => {
              onPeerMute(participant.id);
              onClose();
            }}
          >
            {locallyMuted ? <Volume2 size={16} /> : <VolumeX size={16} />}
            {locallyMuted ? 'Вернуть звук' : 'Не слышать локально'}
          </button>
          {canModerate && (
            <button
              className="danger-action"
              role="menuitem"
              disabled={participant.muted}
              onClick={() => {
                onModerationMute(participant.id, participant.name);
                onClose();
              }}
            >
              <MicOff size={16} />
              {participant.muted ? 'Микрофон уже выключен' : 'Выключить микрофон'}
            </button>
          )}
        </div>
      )}
    </>
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

function InviteCallout({
  compact = false,
  openSlots,
  onCopyInvite,
}: {
  compact?: boolean;
  openSlots: number;
  onCopyInvite(): void;
}) {
  return (
    <button className={`invite-empty ${compact ? 'compact' : ''}`} onClick={onCopyInvite}>
      <span className="invite-empty-icon">
        <UserPlus size={compact ? 18 : 20} />
      </span>
      <span className="invite-copy">
        <strong>{compact ? 'Пригласить' : 'Добавить друзей'}</strong>
        <small>{slotsLabel(openSlots)}</small>
      </span>
      <Copy size={15} />
    </button>
  );
}

function ConnectionStatus({ state, attempt }: { state: SignalingState; attempt: number }) {
  return (
    <span className="connection-pill" data-state={state} role="status">
      <i />
      {state === 'connected'
        ? 'Сигналинг подключён'
        : state === 'reconnecting'
          ? `Переподключение · ${attempt}`
          : 'Подключение…'}
    </span>
  );
}

function CreatorBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`creator-badge ${compact ? 'compact' : ''}`}>
      <Crown size={13} /> {compact ? 'Создатель' : 'Создатель комнаты'}
    </span>
  );
}

function ParticipantAvatar({
  participant,
  speaking,
}: {
  participant: Participant;
  speaking: boolean;
}) {
  const variant = [...participant.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 4;
  return (
    <div className={`participant-avatar ${speaking ? 'speaking' : ''}`} data-variant={variant}>
      {participant.avatar ? (
        <img src={participant.avatar} alt={`Аватар ${participant.name}`} />
      ) : (
        <span>{initials(participant.name)}</span>
      )}
      <i aria-label="В сети" />
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

import { useEffect, useRef, useState } from 'react';
import type { Participant } from '@freetalk/protocol';
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
  Settings,
  ShieldCheck,
  Square,
  UserPlus,
  Volume2,
  VolumeX,
  Waves,
  X,
} from 'lucide-react';
import type { LocalSettings } from '../lib/settings';
import type { SignalingState } from '../lib/signaling-client';
import type { LocalVideoState, VideoMediaSource } from '../lib/video-manager';

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
  pttPressed: boolean;
  signalingState: SignalingState;
  reconnectAttempt: number;
  settings: LocalSettings;
  inviteCopied: boolean;
  turnAvailable: boolean;
  onCopyInvite(): void;
  onMute(): void;
  onCamera(): void;
  onScreen(): void;
  onTransmissionMode(): void;
  onSettings(): void;
  onLeave(): void;
  onPeerVolume(peerId: string, value: number): void;
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
  pttPressed,
  signalingState,
  reconnectAttempt,
  settings,
  inviteCopied,
  turnAvailable,
  onCopyInvite,
  onMute,
  onCamera,
  onScreen,
  onTransmissionMode,
  onSettings,
  onLeave,
  onPeerVolume,
  onPeerMute,
  onModerationMute,
}: RoomViewProps) {
  const [menuFor, setMenuFor] = useState<string>();
  const [expandedMedia, setExpandedMedia] = useState<ExpandedMedia>();
  const [presentedScreenId, setPresentedScreenId] = useState<string>();
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
          <span
            className="room-security"
            title={turnAvailable ? 'WebRTC с резервным TURN-маршрутом' : 'Прямое WebRTC-соединение'}
          >
            <ShieldCheck size={14} /> Приватное соединение
          </span>
        </div>

        {screenPresenter ? (
          <div className="presentation-layout">
            <article className="screen-stage media-surface">
              <ParticipantVideo
                stream={participantMedia(screenPresenter).screen!}
                source="screen"
                name={screenPresenter.name}
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
        <button
          className={`dock-control ptt-control ${pttPressed ? 'pressed' : ''}`}
          onClick={onTransmissionMode}
        >
          <span className="dock-icon">
            <Waves />
          </span>
          <span>
            <strong>{transmissionLabel(settings.transmissionMode)}</strong>
            <small>Режим передачи</small>
          </span>
        </button>
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

function ParticipantVideo({
  stream,
  source,
  name,
  mirrored,
  onExpand,
}: {
  stream: MediaStream;
  source: VideoMediaSource;
  name: string;
  mirrored?: boolean;
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

  return (
    <div className={`participant-video ${source}`}>
      <video
        ref={setElement}
        className={mirrored ? 'mirrored' : undefined}
        aria-label={`${source === 'screen' ? 'Экран' : 'Камера'} ${name}`}
        autoPlay
        muted
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
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.fullscreenElement) setClosing(true);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div
      className={`expanded-media-backdrop ${closing ? 'closing' : ''}`}
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
              onClick={() => void surface.current?.requestFullscreen?.()}
            >
              <Maximize2 size={17} />
            </button>
            <button aria-label="Закрыть раскрытое видео" onClick={() => setClosing(true)}>
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
      <span>{initials(participant.name)}</span>
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

function transmissionLabel(mode: LocalSettings['transmissionMode']) {
  if (mode === 'push-to-talk') return 'Нажми и говори';
  if (mode === 'continuous') return 'Постоянная передача';
  return 'По голосу (VAD)';
}

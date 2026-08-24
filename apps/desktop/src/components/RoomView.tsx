import { useEffect, useState } from 'react';
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
} from 'lucide-react';
import type { LocalSettings } from '../lib/settings';
import type { SignalingState } from '../lib/signaling-client';
import type { LocalVideoSource, LocalVideoState } from '../lib/video-manager';

export type PeerUiState = Record<
  string,
  { connection: RTCPeerConnectionState | 'new'; speaking: boolean; hasAudio: boolean }
>;

export type RemoteVideoUiState = Record<string, { source: LocalVideoSource; stream?: MediaStream }>;

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
  const ordered = [...participants].sort(
    (a, b) => Number(b.id === selfId) - Number(a.id === selfId) || a.connectedAt - b.connectedAt,
  );
  const self = participants.find((participant) => participant.id === selfId);
  const openSlots = Math.max(0, 6 - participants.length);
  const participantMedia = (participant: Participant) =>
    participant.id === selfId
      ? { source: localVideo.source, stream: localVideo.previewStream }
      : (remoteVideos[participant.id] ?? { source: 'none' as const });
  const screenPresenter = ordered.find(
    (participant) => participantMedia(participant).source === 'screen',
  );
  const hasCamera = ordered.some(
    (participant) => participantMedia(participant).source === 'camera',
  );
  const roomMode = screenPresenter ? 'presentation' : hasCamera ? 'camera' : 'audio';

  const renderParticipant = (participant: Participant, compact = false) => {
    const isSelf = participant.id === selfId;
    const speaking = isSelf ? localSpeaking : peerState[participant.id]?.speaking;
    const connection = isSelf ? 'connected' : (peerState[participant.id]?.connection ?? 'new');
    const hasAudio = isSelf || (peerState[participant.id]?.hasAudio ?? false);
    const locallyMuted = settings.mutedPeers[participant.id] ?? false;
    const canModerate = Boolean(self?.isOwner && !isSelf);
    const media = participantMedia(participant);
    const showCamera = media.source === 'camera' && Boolean(media.stream);
    const status = participant.muted
      ? 'Микрофон выключен'
      : speaking
        ? 'Говорит'
        : connectionLabel(connection, hasAudio);

    return (
      <article
        className={`participant-card ${compact ? 'compact-tile' : ''} ${showCamera ? 'camera-tile media-surface' : 'audio-tile'} ${speaking ? 'speaking' : ''} ${participant.muted ? 'mic-muted' : ''}`}
        role="listitem"
        key={participant.id}
      >
        {showCamera && (
          <ParticipantVideo stream={media.stream!} source="camera" name={participant.name} />
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
                stream={participantMedia(screenPresenter).stream!}
                source="screen"
                name={screenPresenter.name}
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
}: {
  stream: MediaStream;
  source: Exclude<LocalVideoSource, 'none'>;
  name: string;
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
        aria-label={`${source === 'screen' ? 'Экран' : 'Камера'} ${name}`}
        autoPlay
        muted
        playsInline
      />
      <button
        className="video-fullscreen"
        aria-label="Открыть видео на весь экран"
        onClick={(event) => {
          const container = event.currentTarget.closest<HTMLElement>('.media-surface');
          void container?.requestFullscreen?.();
        }}
      >
        <Maximize2 size={16} />
      </button>
    </div>
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

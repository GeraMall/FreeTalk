import { useState } from 'react';
import type { Participant } from '@freetalk/protocol';
import {
  Check,
  Copy,
  Crown,
  LogOut,
  Mic,
  MicOff,
  MoreHorizontal,
  Radio,
  Settings,
  UserPlus,
  Volume2,
  VolumeX,
  Waves,
} from 'lucide-react';
import type { LocalSettings } from '../lib/settings';
import type { SignalingState } from '../lib/signaling-client';

export type PeerUiState = Record<
  string,
  { connection: RTCPeerConnectionState | 'new'; speaking: boolean; hasAudio: boolean }
>;

interface RoomViewProps {
  roomId: string;
  selfId: string;
  participants: Participant[];
  peerState: PeerUiState;
  localSpeaking: boolean;
  muted: boolean;
  pttPressed: boolean;
  signalingState: SignalingState;
  reconnectAttempt: number;
  settings: LocalSettings;
  inviteCopied: boolean;
  turnAvailable: boolean;
  onCopyInvite(): void;
  onMute(): void;
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
  muted,
  pttPressed,
  signalingState,
  reconnectAttempt,
  settings,
  inviteCopied,
  turnAvailable,
  onCopyInvite,
  onMute,
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

      <section className="room-main">
        <div className="participants-heading">
          <div>
            <h1>Участники</h1>
            <p>{participants.length} из 6</p>
          </div>
          <span className="room-security">
            <Radio size={14} /> {turnAvailable ? 'WebRTC · TURN резерв' : 'WebRTC · прямое'}
          </span>
        </div>

        <div className="participants-grid" data-count={participants.length} role="list">
          {ordered.map((participant) => {
            const isSelf = participant.id === selfId;
            const speaking = isSelf ? localSpeaking : peerState[participant.id]?.speaking;
            const connection = isSelf
              ? 'connected'
              : (peerState[participant.id]?.connection ?? 'new');
            const hasAudio = isSelf || (peerState[participant.id]?.hasAudio ?? false);
            const locallyMuted = settings.mutedPeers[participant.id] ?? false;
            const canModerate = Boolean(self?.isOwner && !isSelf);
            return (
              <article
                className={`participant-card ${speaking ? 'speaking' : ''} ${participant.muted ? 'mic-muted' : ''}`}
                role="listitem"
                key={participant.id}
              >
                <div className="participant-card-top">
                  {participant.isOwner ? <CreatorBadge /> : <span />}
                  {(canModerate || !isSelf) && (
                    <button
                      className="icon-button participant-menu-button"
                      aria-label={`Действия для ${participant.name}`}
                      aria-expanded={menuFor === participant.id}
                      onClick={() =>
                        setMenuFor((old) => (old === participant.id ? undefined : participant.id))
                      }
                    >
                      <MoreHorizontal size={19} />
                    </button>
                  )}
                  {menuFor === participant.id && (
                    <div className="participant-menu" role="menu">
                      <button
                        role="menuitem"
                        onClick={() => {
                          onPeerMute(participant.id);
                          setMenuFor(undefined);
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
                            setMenuFor(undefined);
                          }}
                        >
                          <MicOff size={16} />
                          {participant.muted ? 'Микрофон уже выключен' : 'Выключить микрофон'}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <ParticipantAvatar participant={participant} speaking={Boolean(speaking)} />
                <div className="participant-name">
                  <strong>{participant.name}</strong>
                  {isSelf && <span>вы</span>}
                </div>
                <div
                  className={`participant-status ${participant.muted ? 'muted' : speaking ? 'live' : ''}`}
                >
                  {participant.muted ? <MicOff size={14} /> : <i />}
                  {participant.muted
                    ? 'Микрофон выключен'
                    : speaking
                      ? 'Говорит'
                      : connectionLabel(connection, hasAudio)}
                </div>
                <VoiceWave active={Boolean(speaking)} />

                {!isSelf && (
                  <div className="participant-volume">
                    <button
                      className="inline-icon"
                      aria-label={
                        locallyMuted ? 'Включить звук участника' : 'Заглушить участника локально'
                      }
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
                      value={settings.peerVolumes[participant.id] ?? 1}
                      onChange={(event) => onPeerVolume(participant.id, Number(event.target.value))}
                    />
                  </div>
                )}
              </article>
            );
          })}

          {openSlots > 0 && (
            <button className="invite-empty" onClick={onCopyInvite}>
              <span className="invite-empty-icon">
                <UserPlus size={24} />
              </span>
              <strong>Пригласите друзей</strong>
              <span>В комнате ещё {slotsLabel(openSlots)}</span>
              <em>
                <Copy size={15} /> Скопировать приглашение
              </em>
            </button>
          )}
        </div>
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
          className={`dock-control ${pttPressed ? 'pressed' : ''}`}
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
        <button className="dock-control" onClick={onSettings}>
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

function CreatorBadge() {
  return (
    <span className="creator-badge">
      <Crown size={14} /> Создатель комнаты
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

function VoiceWave({ active }: { active: boolean }) {
  return (
    <div className={`voice-wave ${active ? 'active' : ''}`} aria-hidden="true">
      {Array.from({ length: 18 }, (_, index) => (
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

import { DoorOpen, Download, Radio, Settings, ShieldCheck } from 'lucide-react';
import type { UpdateStatus } from '../lib/updater';
import { AuroraBackground } from './AuroraBackground';

interface WelcomeScreenProps {
  name: string;
  roomInput: string;
  error: string;
  joining: boolean;
  updateStatus: UpdateStatus;
  onName(value: string): void;
  onRoomInput(value: string): void;
  onCreate(): void;
  onJoin(): void;
  onSettings(): void;
}

export function WelcomeScreen({
  name,
  roomInput,
  error,
  joining,
  updateStatus,
  onName,
  onRoomInput,
  onCreate,
  onJoin,
  onSettings,
}: WelcomeScreenProps) {
  return (
    <main className="welcome-shell">
      <AuroraBackground />
      <div className="welcome-topbar">
        <div className="wordmark">
          <Radio size={18} />
          <span>FreeTalk</span>
        </div>
        <button className="icon-button quiet" aria-label="Открыть настройки" onClick={onSettings}>
          <Settings size={21} />
        </button>
      </div>
      <section className="welcome-card" aria-labelledby="welcome-title">
        <div className="brand-mark">
          <Radio size={30} />
        </div>
        <p className="eyebrow">БЕСПЛАТНАЯ ГОЛОСОВАЯ СВЯЗЬ</p>
        {updateStatus.kind === 'available' && (
          <button className="update-banner" onClick={onSettings}>
            <Download size={16} /> Доступна версия {updateStatus.version}
          </button>
        )}
        <h1 id="welcome-title">FreeTalk</h1>
        <p className="lead">
          Закрытая голосовая комната для вашей компании.
          <br /> Без аккаунтов и записи разговоров.
        </p>
        <label className="field-label">
          Ваше имя
          <input
            autoFocus
            value={name}
            maxLength={32}
            placeholder="Например, Ирина"
            disabled={joining}
            onChange={(event) => onName(event.target.value)}
          />
        </label>
        <button className="primary wide" disabled={joining} onClick={onCreate}>
          {joining ? <span className="spinner" /> : <DoorOpen size={18} />}
          {joining ? 'Создание…' : 'Создать комнату'}
        </button>
        <div className="divider">
          <span>или войдите по приглашению</span>
        </div>
        <div className="join-row">
          <input
            aria-label="Код или ссылка комнаты"
            value={roomInput}
            placeholder="Код или ссылка"
            disabled={joining}
            onChange={(event) => onRoomInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onJoin();
            }}
          />
          <button disabled={joining} onClick={onJoin}>
            Войти
          </button>
        </div>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        <div className="privacy-note">
          <ShieldCheck size={19} />
          <span>
            Аудио идёт напрямую между участниками через WebRTC.
            <small>Сигнальный сервер не получает и не записывает разговоры.</small>
          </span>
        </div>
      </section>
    </main>
  );
}

import { useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  Download,
  Info,
  ImagePlus,
  Mic2,
  MonitorSpeaker,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import type { LocalSettings } from '../lib/settings';
import { prepareAvatar, remainingProfileChanges } from '../lib/profile';
import type { UpdateStatus } from '../lib/updater';

type SettingsTab = 'audio' | 'profile' | 'devices' | 'about';

interface SettingsPanelProps {
  settings: LocalSettings;
  devices: { inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] };
  inputLevel: number;
  appVersion: string;
  updateStatus: UpdateStatus;
  turnAvailable: boolean;
  outputSupported: boolean;
  onClose(): void;
  onInput(value: string): void;
  onOutput(value: string): void;
  onSetting(patch: Partial<LocalSettings>, restart: boolean): void;
  onKey(value: string): void;
  onReset(): void;
  onCheckUpdate(): void;
  onInstallUpdate(): void;
  onSaveDiagnostics(): Promise<string>;
  onSaveProfile(name: string, avatar: string): Promise<void>;
}

export function SettingsPanel({
  settings,
  devices,
  inputLevel,
  appVersion,
  updateStatus,
  turnAvailable,
  outputSupported,
  onClose,
  onInput,
  onOutput,
  onSetting,
  onKey,
  onReset,
  onCheckUpdate,
  onInstallUpdate,
  onSaveDiagnostics,
  onSaveProfile,
}: SettingsPanelProps) {
  const [tab, setTab] = useState<SettingsTab>('audio');
  const [capturing, setCapturing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState('');
  const [testError, setTestError] = useState('');
  const [diagnosticPath, setDiagnosticPath] = useState('');
  const [diagnosticError, setDiagnosticError] = useState('');
  const testStream = useRef<MediaStream | undefined>(undefined);
  const testRecorder = useRef<MediaRecorder | undefined>(undefined);
  const recordingUrlRef = useRef('');

  useEffect(
    () => () => {
      if (testRecorder.current?.state === 'recording') {
        testRecorder.current.onstop = null;
        testRecorder.current.stop();
      }
      testStream.current?.getTracks().forEach((track) => track.stop());
      if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
    },
    [],
  );

  const recordSample = async () => {
    setTestError('');
    setRecordingUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      recordingUrlRef.current = '';
      return '';
    });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          deviceId: settings.inputDeviceId ? { exact: settings.inputDeviceId } : undefined,
          echoCancellation: settings.echoCancellation,
          noiseSuppression: settings.noiseSuppression,
          autoGainControl: settings.autoGainControl,
          channelCount: 1,
        },
      });
      testStream.current = stream;
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream);
      testRecorder.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const url = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }));
        recordingUrlRef.current = url;
        setRecordingUrl(url);
        setRecording(false);
      };
      setRecording(true);
      recorder.start();
      window.setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, 4000);
    } catch {
      setRecording(false);
      setTestError('Не удалось записать образец. Проверьте доступ к микрофону.');
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <aside className="settings-sidebar">
          <div className="settings-sidebar-title">Настройки</div>
          <nav aria-label="Разделы настроек">
            <TabButton
              active={tab === 'audio'}
              icon={<AudioLines />}
              label="Аудио"
              onClick={() => setTab('audio')}
            />
            <TabButton
              active={tab === 'profile'}
              icon={<UserRound />}
              label="Профиль"
              onClick={() => setTab('profile')}
            />
            <TabButton
              active={tab === 'devices'}
              icon={<MonitorSpeaker />}
              label="Устройства"
              onClick={() => setTab('devices')}
            />
            <TabButton
              active={tab === 'about'}
              icon={<Info />}
              label="О приложении"
              onClick={() => setTab('about')}
            />
          </nav>
          <button className="reset-settings" onClick={onReset}>
            <RotateCcw size={16} /> Сбросить настройки
          </button>
        </aside>

        <div className="settings-workspace">
          <header className="settings-header">
            <div>
              <p className="eyebrow">
                {tab === 'audio'
                  ? 'АУДИО'
                  : tab === 'profile'
                    ? 'ПРОФИЛЬ'
                    : tab === 'devices'
                      ? 'УСТРОЙСТВА'
                      : 'FREETALK'}
              </p>
              <h2 id="settings-title">
                {tab === 'audio'
                  ? 'Настройки звука'
                  : tab === 'profile'
                    ? 'Ваш профиль'
                    : tab === 'devices'
                      ? 'Аудиоустройства'
                      : 'О приложении'}
              </h2>
            </div>
            <button className="icon-button quiet" aria-label="Закрыть настройки" onClick={onClose}>
              <X size={21} />
            </button>
          </header>

          <div className="settings-content">
            {tab === 'audio' && (
              <AudioTab
                settings={settings}
                inputLevel={inputLevel}
                capturing={capturing}
                recording={recording}
                recordingUrl={recordingUrl}
                testError={testError}
                onCapturing={setCapturing}
                onKey={onKey}
                onSetting={onSetting}
                onRecord={() => void recordSample()}
              />
            )}
            {tab === 'profile' && <ProfileTab settings={settings} onSaveProfile={onSaveProfile} />}
            {tab === 'devices' && (
              <DevicesTab
                settings={settings}
                devices={devices}
                outputSupported={outputSupported}
                onInput={onInput}
                onOutput={onOutput}
                onSetting={onSetting}
              />
            )}
            {tab === 'about' && (
              <AboutTab
                appVersion={appVersion}
                updateStatus={updateStatus}
                turnAvailable={turnAvailable}
                onCheckUpdate={onCheckUpdate}
                onInstallUpdate={onInstallUpdate}
                diagnosticPath={diagnosticPath}
                diagnosticError={diagnosticError}
                onSaveDiagnostics={async () => {
                  setDiagnosticError('');
                  try {
                    setDiagnosticPath(await onSaveDiagnostics());
                  } catch {
                    setDiagnosticPath('');
                    setDiagnosticError('Не удалось сохранить журнал');
                  }
                }}
              />
            )}
          </div>

          <footer className="settings-footer">
            <button className="primary" onClick={onClose}>
              Готово
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
}

function ProfileTab({
  settings,
  onSaveProfile,
}: {
  settings: LocalSettings;
  onSaveProfile(name: string, avatar: string): Promise<void>;
}) {
  const [draftName, setDraftName] = useState(settings.displayName);
  const [draftAvatar, setDraftAvatar] = useState(settings.avatarDataUrl);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const remaining = remainingProfileChanges(settings.profileChangeTimestamps);
  const changed =
    draftName.trim() !== settings.displayName || draftAvatar !== settings.avatarDataUrl;

  useEffect(() => {
    setDraftName(settings.displayName);
    setDraftAvatar(settings.avatarDataUrl);
  }, [settings.avatarDataUrl, settings.displayName]);

  const save = async () => {
    const name = draftName.trim();
    setError('');
    setSaved(false);
    const hasUnsafeCharacter = [...name].some((character) => {
      const code = character.charCodeAt(0);
      return character === '<' || character === '>' || code <= 31 || code === 127;
    });
    if (!name || name.length > 32 || hasUnsafeCharacter) {
      setError('Имя должно содержать от 1 до 32 символов без < и >.');
      return;
    }
    setBusy(true);
    try {
      await onSaveProfile(name, draftAvatar);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить профиль.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section profile-section">
      <div className="profile-editor">
        <div className="profile-avatar-preview">
          {draftAvatar ? (
            <img src={draftAvatar} alt="Предпросмотр аватара" />
          ) : (
            <span>{draftName.trim().charAt(0).toUpperCase() || '?'}</span>
          )}
        </div>
        <div className="profile-avatar-actions">
          <strong>Аватар</strong>
          <small>Квадратное изображение до 5 МБ. FreeTalk уменьшит его автоматически.</small>
          <div>
            <label className="secondary compact profile-file-button">
              <ImagePlus size={16} /> Выбрать фото
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = '';
                  if (!file) return;
                  setError('');
                  void prepareAvatar(file)
                    .then(setDraftAvatar)
                    .catch((caught) =>
                      setError(
                        caught instanceof Error ? caught.message : 'Не удалось обработать фото.',
                      ),
                    );
                }}
              />
            </label>
            {draftAvatar && (
              <button className="secondary compact" onClick={() => setDraftAvatar('')}>
                <Trash2 size={15} /> Удалить
              </button>
            )}
          </div>
        </div>
      </div>
      <label className="field-label">
        Отображаемое имя
        <input
          maxLength={32}
          value={draftName}
          placeholder="Ваше имя"
          onChange={(event) => {
            setDraftName(event.target.value);
            setSaved(false);
          }}
        />
      </label>
      <div className="profile-limit">
        <span>
          {remaining > 0 ? `Осталось изменений: ${remaining} из 3` : 'Лимит изменений исчерпан'}
        </span>
        <small>Ник и аватар вместе можно сохранять не более трёх раз за пять часов.</small>
      </div>
      {error && <small className="inline-error">{error}</small>}
      {saved && <small className="inline-success">Профиль обновлён для всех участников.</small>}
      <button
        className="primary profile-save"
        disabled={!changed || remaining === 0 || busy}
        onClick={() => void save()}
      >
        <Save size={16} /> {busy ? 'Сохраняем…' : 'Сохранить профиль'}
      </button>
    </section>
  );
}

function AudioTab({
  settings,
  inputLevel,
  capturing,
  recording,
  recordingUrl,
  testError,
  onCapturing,
  onKey,
  onSetting,
  onRecord,
}: {
  settings: LocalSettings;
  inputLevel: number;
  capturing: boolean;
  recording: boolean;
  recordingUrl: string;
  testError: string;
  onCapturing(value: boolean): void;
  onKey(value: string): void;
  onSetting(patch: Partial<LocalSettings>, restart: boolean): void;
  onRecord(): void;
}) {
  return (
    <>
      <section className="settings-section">
        <h3>Режим передачи</h3>
        <div className="transmission-modes" role="radiogroup" aria-label="Режим передачи">
          <ModeOption
            title="По голосу (VAD)"
            detail="Передаёт голос, когда вы говорите"
            value="voice-activation"
            icon={<AudioLines />}
            settings={settings}
            onSetting={onSetting}
          />
          <ModeOption
            title="Нажми и говори"
            detail="Удерживайте клавишу для передачи"
            value="push-to-talk"
            icon={<Mic2 />}
            settings={settings}
            onSetting={onSetting}
          />
          <ModeOption
            title="Постоянная передача"
            detail="Микрофон передаёт постоянно"
            value="continuous"
            icon={<RefreshCw />}
            settings={settings}
            onSetting={onSetting}
          />
        </div>
        {settings.transmissionMode === 'voice-activation' && (
          <label className="slider-setting">
            <span>
              <strong>Порог голосовой активности</strong>
              <output>{Math.round((settings.vadThreshold / 0.1) * 100)}%</output>
            </span>
            <div
              className="level-meter"
              aria-label={`Уровень микрофона ${Math.round(inputLevel * 100)}%`}
            >
              <span style={{ width: `${inputLevel * 100}%` }} />
              <i style={{ left: `${Math.min(100, (settings.vadThreshold / 0.12) * 100)}%` }} />
            </div>
            <input
              type="range"
              min="0.01"
              max="0.12"
              step="0.005"
              value={settings.vadThreshold}
              onChange={(event) => onSetting({ vadThreshold: Number(event.target.value) }, false)}
            />
            <small>Передача начинается, когда голос становится громче выбранного порога.</small>
          </label>
        )}
        {settings.transmissionMode === 'push-to-talk' && (
          <label className="key-setting">
            <span>
              <strong>Клавиша push-to-talk</strong>
              <small>Работает внутри окна и не срабатывает во время ввода текста.</small>
            </span>
            <button
              className={`key-capture ${capturing ? 'capturing' : ''}`}
              onClick={() => onCapturing(true)}
              onKeyDown={(event) => {
                if (!capturing) return;
                event.preventDefault();
                onKey(event.code);
                onCapturing(false);
              }}
            >
              {capturing ? 'Нажмите клавишу…' : prettyKey(settings.pushToTalkKey)}
            </button>
          </label>
        )}
      </section>

      <section className="settings-section">
        <div className="section-title-row">
          <h3>Обработка звука</h3>
          <button className="secondary compact" disabled={recording} onClick={onRecord}>
            <AudioLines size={16} /> {recording ? 'Запись 4 секунды…' : 'Записать тест'}
          </button>
        </div>
        {(recordingUrl || testError) && (
          <div className="recording-result">
            {recordingUrl && <audio controls src={recordingUrl} />}
            {testError && <small className="inline-error">{testError}</small>}
          </div>
        )}
        <div className="processing-grid">
          <Toggle
            label="Шумоподавление"
            description="Удаляет постоянный фоновый шум."
            checked={settings.noiseSuppression}
            onChange={(value) => onSetting({ noiseSuppression: value }, true)}
          />
          <Toggle
            label="Приглушать собеседников"
            description="Снижает громкость других участников."
            checked={settings.echoDucking}
            onChange={(value) => onSetting({ echoDucking: value }, false)}
          />
          <Toggle
            label="Автоматическое усиление"
            description="Выравнивает громкость микрофона."
            checked={settings.autoGainControl}
            onChange={(value) => onSetting({ autoGainControl: value }, true)}
          />
          <Toggle
            label="Подавлять щелчки клавиатуры"
            description="Приостанавливает передачу при вводе."
            checked={settings.typingAttenuation}
            onChange={(value) => onSetting({ typingAttenuation: value }, false)}
          />
          <Toggle
            label="Подавление эха"
            description="Снижает эхо и обратную связь."
            checked={settings.echoCancellation}
            onChange={(value) => onSetting({ echoCancellation: value }, true)}
          />
          <Toggle
            label="Комфортный шум"
            description="Добавляет едва слышимый фон в паузах."
            checked={settings.comfortNoise}
            onChange={(value) => onSetting({ comfortNoise: value }, true)}
          />
        </div>
        {settings.echoDucking && (
          <label className="slider-setting compact-slider">
            <span>
              <strong>Громкость при приглушении</strong>
              <output>{Math.round(settings.echoDuckingLevel * 100)}%</output>
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.echoDuckingLevel}
              onChange={(event) =>
                onSetting({ echoDuckingLevel: Number(event.target.value) }, false)
              }
            />
          </label>
        )}
      </section>
    </>
  );
}

function DevicesTab({
  settings,
  devices,
  outputSupported,
  onInput,
  onOutput,
  onSetting,
}: {
  settings: LocalSettings;
  devices: { inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] };
  outputSupported: boolean;
  onInput(value: string): void;
  onOutput(value: string): void;
  onSetting(patch: Partial<LocalSettings>, restart: boolean): void;
}) {
  return (
    <section className="settings-section device-section">
      <h3>Микрофон</h3>
      <label className="field-label">
        Устройство захвата звука
        <select value={settings.inputDeviceId} onChange={(event) => onInput(event.target.value)}>
          <option value="">Системное устройство по умолчанию</option>
          {devices.inputs.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Микрофон ${index + 1}`}
            </option>
          ))}
        </select>
      </label>
      <div className="section-separator" />
      <h3>Динамики / наушники</h3>
      <label className="field-label">
        Устройство воспроизведения
        <select
          disabled={!outputSupported}
          value={settings.outputDeviceId}
          onChange={(event) => onOutput(event.target.value)}
        >
          <option value="">Системное устройство по умолчанию</option>
          {devices.outputs.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Динамики ${index + 1}`}
            </option>
          ))}
        </select>
        {!outputSupported && <small>Выбор вывода не поддерживается текущим WebView.</small>}
      </label>
      <label className="slider-setting">
        <span>
          <strong>Общая громкость голосов</strong>
          <output>{Math.round(settings.outputVolume * 100)}%</output>
        </span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={settings.outputVolume}
          onChange={(event) => onSetting({ outputVolume: Number(event.target.value) }, false)}
        />
      </label>
    </section>
  );
}

function AboutTab({
  appVersion,
  updateStatus,
  turnAvailable,
  onCheckUpdate,
  onInstallUpdate,
  diagnosticPath,
  diagnosticError,
  onSaveDiagnostics,
}: {
  appVersion: string;
  updateStatus: UpdateStatus;
  turnAvailable: boolean;
  onCheckUpdate(): void;
  onInstallUpdate(): void;
  diagnosticPath: string;
  diagnosticError: string;
  onSaveDiagnostics(): void;
}) {
  return (
    <section className="settings-section about-section">
      <div className="about-mark">
        <AudioLines size={30} />
      </div>
      <div>
        <h3>FreeTalk</h3>
        <p>Бесплатная голосовая связь для небольших закрытых компаний.</p>
      </div>
      <dl>
        <div>
          <dt>Версия</dt>
          <dd>{appVersion}</dd>
        </div>
        <div>
          <dt>Аудио</dt>
          <dd>WebRTC · Opus</dd>
        </div>
        <div>
          <dt>Телеметрия</dt>
          <dd>Отсутствует</dd>
        </div>
        <div>
          <dt>Резервное соединение</dt>
          <dd>{turnAvailable ? 'TURN готов' : 'Прямой WebRTC (STUN)'}</dd>
        </div>
      </dl>
      <div className="update-section">
        <div>
          <strong>Обновления</strong>
          <small>{updateMessage(updateStatus, appVersion)}</small>
        </div>
        {updateStatus.kind === 'available' ? (
          <button className="primary compact" onClick={onInstallUpdate}>
            <Download size={16} /> Обновить до {updateStatus.version}
          </button>
        ) : updateStatus.kind === 'downloading' ? (
          <progress max="100" value={updateStatus.progress} />
        ) : (
          <button
            className="secondary compact"
            disabled={updateStatus.kind === 'checking'}
            onClick={onCheckUpdate}
          >
            <RefreshCw size={16} className={updateStatus.kind === 'checking' ? 'spin' : ''} />{' '}
            {updateStatus.kind === 'checking' ? 'Проверяем…' : 'Проверить'}
          </button>
        )}
      </div>
      <div className="update-section">
        <div>
          <strong>Диагностика подключения</strong>
          <small>Обезличенный таймлайн ICE и RTP без адресов, SDP и секретов.</small>
          {diagnosticPath && <small>Сохранено: {diagnosticPath}</small>}
          {diagnosticError && <small className="error-text">{diagnosticError}</small>}
        </div>
        <button className="secondary compact" onClick={onSaveDiagnostics}>
          <Save size={16} /> Сохранить на рабочий стол
        </button>
      </div>
    </section>
  );
}

function TabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      className={active ? 'active' : ''}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function ModeOption({
  title,
  detail,
  value,
  icon,
  settings,
  onSetting,
}: {
  title: string;
  detail: string;
  value: LocalSettings['transmissionMode'];
  icon: React.ReactNode;
  settings: LocalSettings;
  onSetting(patch: Partial<LocalSettings>, restart: boolean): void;
}) {
  const checked = settings.transmissionMode === value;
  return (
    <label className={checked ? 'active' : ''}>
      <input
        type="radio"
        name="transmission-mode"
        checked={checked}
        onChange={() => onSetting({ transmissionMode: value }, false)}
      />
      <span className="mode-radio" />
      <span className="mode-icon">{icon}</span>
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
    </label>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{label}</strong>
        <small>{description}</small>
      </div>
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        className={`switch ${checked ? 'on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}

function prettyKey(code: string) {
  return code === 'Space' ? 'Пробел' : code.replace(/^Key/, '').replace(/^Digit/, '');
}

function updateMessage(status: UpdateStatus, version: string) {
  if (status.kind === 'available') return `Доступна версия ${status.version}`;
  if (status.kind === 'downloading') return `Загрузка ${status.progress}%`;
  if (status.kind === 'current') return 'Установлена последняя версия';
  if (status.kind === 'error') return status.message;
  if (status.kind === 'unavailable') return 'Проверка доступна в настольной версии';
  return `Установлена версия ${version}`;
}

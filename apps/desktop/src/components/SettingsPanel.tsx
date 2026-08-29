import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  AudioLines,
  Download,
  Info,
  ImagePlus,
  MessageCircle,
  Mic2,
  MonitorSpeaker,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  UserRound,
  Video,
  X,
} from 'lucide-react';
import type { LocalSettings } from '../lib/settings';
import {
  prepareAvatar,
  prepareChatWallpaper,
  prepareCover,
  remainingProfileChanges,
} from '../lib/profile';
import { autostartSupported, getAutostartEnabled, setAutostartEnabled } from '../lib/autostart';
import type { UpdateStatus } from '../lib/updater';
import type { AccountUser } from '../lib/api-client';
import { BrandLogo } from './BrandLogo';
import mascotUrl from '../assets/freetalk-mascot.png';
import {
  isValidUsername,
  normalizeUsername,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from '../lib/username';

export type SettingsTab = 'audio' | 'profile' | 'video' | 'devices' | 'chats' | 'about';

interface SettingsPanelProps {
  initialTab?: SettingsTab;
  settings: LocalSettings;
  devices: { inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[]; cameras: MediaDeviceInfo[] };
  inputLevel: number;
  appVersion: string;
  updateStatus: UpdateStatus;
  turnAvailable: boolean;
  outputSupported: boolean;
  accountUser?: AccountUser;
  guestMode: boolean;
  onClose(): void;
  onInput(value: string): void;
  onOutput(value: string): void;
  onCamera(value: string): void;
  onSetting(patch: Partial<LocalSettings>, restart: boolean): void;
  onVideoSetting(patch: Partial<LocalSettings>): void;
  onKey(value: string): void;
  onReset(): void;
  onCheckUpdate(): void;
  onInstallUpdate(): void;
  onSaveDiagnostics(): Promise<string>;
  onSaveProfile(
    name: string,
    avatar: string,
    username: string | undefined,
    bio: string,
    cover: string,
  ): Promise<void>;
  onAccountLogout(): void;
  onDeleteAccount(password: string): Promise<void>;
  onChangePassword(currentPassword: string, newPassword: string): Promise<void>;
}

export function SettingsPanel({
  initialTab = 'audio',
  settings,
  devices,
  inputLevel,
  appVersion,
  updateStatus,
  turnAvailable,
  outputSupported,
  accountUser,
  guestMode,
  onClose,
  onInput,
  onOutput,
  onCamera,
  onSetting,
  onVideoSetting,
  onKey,
  onReset,
  onCheckUpdate,
  onInstallUpdate,
  onSaveDiagnostics,
  onSaveProfile,
  onAccountLogout,
  onDeleteAccount,
  onChangePassword,
}: SettingsPanelProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
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
          <div className="settings-sidebar-brand">
            <BrandLogo variant="compact" />
          </div>
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
              active={tab === 'video'}
              icon={<Video />}
              label="Видео"
              onClick={() => setTab('video')}
            />
            <TabButton
              active={tab === 'devices'}
              icon={<MonitorSpeaker />}
              label="Устройства"
              onClick={() => setTab('devices')}
            />
            <TabButton
              active={tab === 'chats'}
              icon={<MessageCircle />}
              label="Чаты"
              onClick={() => setTab('chats')}
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
                    : tab === 'video'
                      ? 'ВИДЕО'
                      : tab === 'devices'
                        ? 'УСТРОЙСТВА'
                        : tab === 'chats'
                          ? 'ЧАТЫ'
                          : 'FREETALK'}
              </p>
              <h2 id="settings-title">
                {tab === 'audio'
                  ? 'Настройки звука'
                  : tab === 'profile'
                    ? 'Ваш профиль'
                    : tab === 'video'
                      ? 'Камера и демонстрация'
                      : tab === 'devices'
                        ? 'Аудиоустройства'
                        : tab === 'chats'
                          ? 'Оформление чатов'
                          : 'О приложении'}
              </h2>
            </div>
            <button className="icon-button quiet" aria-label="Закрыть настройки" onClick={onClose}>
              <X size={21} />
            </button>
          </header>

          <div className={`settings-content${tab === 'profile' ? ' profile-content' : ''}`}>
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
            {tab === 'profile' && (
              <ProfileTab
                settings={settings}
                accountUser={accountUser}
                guestMode={guestMode}
                onSaveProfile={onSaveProfile}
                onAccountLogout={onAccountLogout}
                onDeleteAccount={onDeleteAccount}
                onChangePassword={onChangePassword}
                onDone={onClose}
              />
            )}
            {tab === 'video' && (
              <VideoTab
                settings={settings}
                cameras={devices.cameras}
                onCamera={onCamera}
                onVideoSetting={onVideoSetting}
                locked={guestMode}
              />
            )}
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
            {tab === 'chats' && <ChatsSettingsTab settings={settings} onSetting={onSetting} />}
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

          {tab !== 'profile' && (
            <footer className="settings-footer">
              <button className="primary" onClick={onClose}>
                Готово
              </button>
            </footer>
          )}
        </div>
      </section>
    </div>
  );
}

function ProfileTab({
  settings,
  accountUser,
  guestMode,
  onSaveProfile,
  onAccountLogout,
  onDeleteAccount,
  onChangePassword,
  onDone,
}: {
  settings: LocalSettings;
  accountUser?: AccountUser;
  guestMode: boolean;
  onSaveProfile(
    name: string,
    avatar: string,
    username: string | undefined,
    bio: string,
    cover: string,
  ): Promise<void>;
  onAccountLogout(): void;
  onDeleteAccount(password: string): Promise<void>;
  onChangePassword(currentPassword: string, newPassword: string): Promise<void>;
  onDone(): void;
}) {
  const [draftName, setDraftName] = useState(settings.displayName);
  const persistedAvatar = accountUser?.avatarUrl ?? '';
  const initialAvatar = persistedAvatar || settings.avatarDataUrl;
  const [draftAvatar, setDraftAvatar] = useState(initialAvatar);
  const [draftCover, setDraftCover] = useState(accountUser?.coverUrl ?? '');
  const [draftBio, setDraftBio] = useState(accountUser?.bio ?? '');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftUsername, setDraftUsername] = useState(accountUser?.username ?? '');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const remaining = remainingProfileChanges(settings.profileChangeTimestamps);
  const usernameValid = isValidUsername(draftUsername);
  const changed =
    draftName.trim() !== settings.displayName ||
    draftAvatar !== persistedAvatar ||
    draftUsername !== accountUser?.username ||
    draftBio !== (accountUser?.bio ?? '') ||
    draftCover !== (accountUser?.coverUrl ?? '');

  useEffect(() => {
    setDraftName(settings.displayName);
    setDraftAvatar(accountUser?.avatarUrl || settings.avatarDataUrl);
    setDraftCover(accountUser?.coverUrl ?? '');
    setDraftBio(accountUser?.bio ?? '');
    setDraftUsername(accountUser?.username ?? '');
  }, [
    accountUser?.avatarUrl,
    accountUser?.bio,
    accountUser?.coverUrl,
    accountUser?.username,
    settings.avatarDataUrl,
    settings.displayName,
  ]);

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
    if (!usernameValid) {
      setError('Username: минимум 5 символов, только латинские буквы, цифры и _.');
      return;
    }
    setBusy(true);
    try {
      await onSaveProfile(name, draftAvatar, draftUsername || undefined, draftBio, draftCover);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить профиль.');
    } finally {
      setBusy(false);
    }
  };

  if (guestMode || !accountUser)
    return (
      <div className="profile-tab-layout">
        <div className="profile-tab-scroll">
          <section className="settings-section locked-feature-card">
            <UserRound size={34} />
            <h3>Профиль доступен после регистрации</h3>
            <p>
              Зарегистрируйтесь, чтобы пользоваться всеми функциями профиля, друзьями, чатами и
              историей.
            </p>
          </section>
        </div>
        <footer className="profile-sticky-actions single-action">
          <button className="primary profile-done" onClick={onDone}>
            Готово
          </button>
        </footer>
      </div>
    );

  return (
    <div className="profile-tab-layout">
      <div className="profile-tab-scroll">
        <section className="settings-section profile-section">
          <div className="account-profile-facts">
            <span>
              <small>Почта</small>
              <strong>{accountUser.email}</strong>
            </span>
            <span>
              <small>Регистрация</small>
              <strong>{new Date(accountUser.registeredAt).toLocaleDateString('ru-RU')}</strong>
            </span>
          </div>
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
              <small>
                JPEG, PNG или WebP до 25 МБ. FreeTalk уменьшит его до 768×768 и примерно 1 МБ.
              </small>
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
                            caught instanceof Error
                              ? caught.message
                              : 'Не удалось обработать фото.',
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
          <div className="profile-cover-editor">
            <div
              className="profile-cover-preview"
              style={draftCover ? { backgroundImage: `url(${draftCover})` } : undefined}
            >
              {!draftCover && <span>FreeTalk cover</span>}
            </div>
            <div className="profile-avatar-actions">
              <strong>Обложка профиля</strong>
              <small>
                Изображение до 25 МБ. FreeTalk подготовит обложку 1800×700 весом до 2–3 МБ.
              </small>
              <div>
                <label className="secondary compact profile-file-button">
                  <ImagePlus size={16} /> {draftCover ? 'Заменить' : 'Загрузить'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.currentTarget.value = '';
                      if (!file) return;
                      setError('');
                      void prepareCover(file)
                        .then(setDraftCover)
                        .catch((caught) =>
                          setError(
                            caught instanceof Error
                              ? caught.message
                              : 'Не удалось обработать обложку.',
                          ),
                        );
                    }}
                  />
                </label>
                {draftCover && (
                  <button className="secondary compact" onClick={() => setDraftCover('')}>
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
          <label className="field-label">
            Уникальный @username
            <input
              minLength={USERNAME_MIN_LENGTH}
              maxLength={USERNAME_MAX_LENGTH}
              pattern="[a-z0-9_]{5,24}"
              aria-invalid={!usernameValid}
              value={draftUsername}
              onChange={(event) => {
                setDraftUsername(normalizeUsername(event.target.value));
                setSaved(false);
              }}
            />
            <small>От 5 символов: латинские буквы, цифры и _. Изменить можно раз в 30 дней.</small>
          </label>
          <label className="field-label">
            О себе
            <textarea
              value={draftBio}
              maxLength={200}
              rows={3}
              placeholder="Несколько слов о себе"
              onChange={(event) => {
                setDraftBio(event.target.value);
                setSaved(false);
              }}
            />
            <small>{draftBio.length}/200</small>
          </label>
          <div className="profile-limit">
            <span>
              {remaining > 0 ? `Осталось изменений: ${remaining} из 5` : 'Лимит изменений исчерпан'}
            </span>
            <small>Ник и аватар вместе можно сохранять не более пяти раз за пять часов.</small>
          </div>
          {error && <small className="inline-error">{error}</small>}
          {saved && <small className="inline-success">Профиль обновлён для всех участников.</small>}
          <div className="account-actions">
            <details>
              <summary>Изменить пароль</summary>
              <div className="password-change-form">
                <input
                  type="password"
                  value={currentPassword}
                  placeholder="Текущий пароль"
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
                <input
                  type="password"
                  value={newPassword}
                  placeholder="Новый пароль"
                  onChange={(event) => setNewPassword(event.target.value)}
                />
                <button
                  disabled={!currentPassword || !newPassword}
                  onClick={() => {
                    setError('');
                    void onChangePassword(currentPassword, newPassword)
                      .then(() => {
                        setCurrentPassword('');
                        setNewPassword('');
                        setSaved(true);
                      })
                      .catch((caught: unknown) =>
                        setError(
                          caught instanceof Error ? caught.message : 'Не удалось изменить пароль',
                        ),
                      );
                  }}
                >
                  Изменить пароль
                </button>
              </div>
            </details>
            <button className="secondary" onClick={onAccountLogout}>
              Выйти из аккаунта
            </button>
            <details className="danger-zone">
              <summary>Удалить аккаунт</summary>
              <p>Личные данные будут удалены или обезличены, а все сессии завершены.</p>
              <input
                type="password"
                value={deletePassword}
                placeholder="Текущий пароль"
                onChange={(event) => setDeletePassword(event.target.value)}
              />
              <input
                value={deleteConfirmation}
                placeholder="Введите УДАЛИТЬ"
                onChange={(event) => setDeleteConfirmation(event.target.value)}
              />
              <button
                className="danger"
                disabled={!deletePassword || deleteConfirmation !== 'УДАЛИТЬ'}
                onClick={() => {
                  setError('');
                  void onDeleteAccount(deletePassword).catch((caught: unknown) =>
                    setError(
                      caught instanceof Error ? caught.message : 'Не удалось удалить аккаунт',
                    ),
                  );
                }}
              >
                Удалить навсегда
              </button>
            </details>
          </div>
        </section>
      </div>
      <footer className="profile-sticky-actions">
        <button
          className="secondary profile-save"
          disabled={!changed || !usernameValid || remaining === 0 || busy}
          onClick={() => void save()}
        >
          <Save size={16} /> {busy ? 'Сохраняем…' : 'Сохранить профиль'}
        </button>
        <button className="primary profile-done" onClick={onDone}>
          Готово
        </button>
      </footer>
    </div>
  );
}

function VideoTab({
  settings,
  cameras,
  onCamera,
  onVideoSetting,
  locked,
}: {
  settings: LocalSettings;
  cameras: MediaDeviceInfo[];
  onCamera(value: string): void;
  onVideoSetting(patch: Partial<LocalSettings>): void;
  locked: boolean;
}) {
  return (
    <fieldset className="video-settings-fieldset" disabled={locked}>
      {locked && (
        <div className="locked-feature-card">
          <Video size={30} />
          <strong>Видео доступно после регистрации</strong>
          <small>Гости могут общаться только голосом.</small>
        </div>
      )}
      <section className="settings-section video-settings-section">
        <h3>Камера</h3>
        <label className="field-label">
          Устройство камеры
          <select
            value={settings.cameraDeviceId}
            onChange={(event) => onCamera(event.target.value)}
          >
            <option value="">Системная камера по умолчанию</option>
            {cameras.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Камера ${index + 1}`}
              </option>
            ))}
          </select>
          <small>Если камера уже включена, устройство переключится без выхода из комнаты.</small>
        </label>
      </section>

      <section className="settings-section video-settings-section">
        <div className="section-title-row">
          <h3>Демонстрация экрана</h3>
          <span className="quality-summary">
            {settings.screenResolution} · {settings.screenFrameRate} FPS
          </span>
        </div>
        <div className="video-quality-grid">
          <label className="field-label">
            Максимальное разрешение
            <select
              value={settings.screenResolution}
              onChange={(event) =>
                onVideoSetting({
                  screenResolution: event.target.value as LocalSettings['screenResolution'],
                })
              }
            >
              <option value="720p">HD · 1280×720</option>
              <option value="1080p">Full HD · 1920×1080</option>
              <option value="1440p">2K · 2560×1440</option>
            </select>
          </label>
          <label className="field-label">
            Частота кадров
            <select
              value={settings.screenFrameRate}
              onChange={(event) =>
                onVideoSetting({
                  screenFrameRate: Number(event.target.value) as LocalSettings['screenFrameRate'],
                })
              }
            >
              <option value="15">15 FPS · экономно</option>
              <option value="30">30 FPS · рекомендуется</option>
              <option value="60">60 FPS · плавно</option>
            </select>
          </label>
        </div>
        <div className="video-toggle-list">
          <Toggle
            label="Передавать звук по умолчанию"
            description="Запрашивает звук выбранного окна или экрана при запуске демонстрации."
            checked={settings.screenAudioByDefault}
            onChange={(value) => onVideoSetting({ screenAudioByDefault: value })}
          />
          <Toggle
            label="Адаптивное качество"
            description="Автоматически снижает разрешение, FPS и битрейт при потерях или высоком пинге."
            checked={settings.screenAdaptiveQuality}
            onChange={(value) => onVideoSetting({ screenAdaptiveQuality: value })}
          />
        </div>
        <div className="adaptive-quality-note">
          <strong>Без остановок на слабой сети</strong>
          <small>
            Каждый собеседник получает индивидуальное качество. После восстановления соединения
            FreeTalk автоматически возвращает выбранные параметры.
          </small>
        </div>
        <small className="video-apply-note">
          Разрешение и FPS применятся при следующем запуске демонстрации. По умолчанию — 1080p/30
          FPS; максимум — 2K/60 FPS.
        </small>
      </section>
    </fieldset>
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
  devices: { inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[]; cameras: MediaDeviceInfo[] };
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
  const [autostart, setAutostart] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(true);
  const [autostartError, setAutostartError] = useState('');
  const supported = autostartSupported();
  useEffect(() => {
    let disposed = false;
    void getAutostartEnabled()
      .then((enabled) => {
        if (!disposed) setAutostart(enabled);
      })
      .catch(() => {
        if (!disposed) setAutostartError('Не удалось проверить автозапуск.');
      })
      .finally(() => {
        if (!disposed) setAutostartBusy(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const changeAutostart = async (enabled: boolean) => {
    setAutostartBusy(true);
    setAutostartError('');
    try {
      await setAutostartEnabled(enabled);
      setAutostart(enabled);
    } catch {
      setAutostartError('Не удалось изменить автозапуск.');
    } finally {
      setAutostartBusy(false);
    }
  };

  return (
    <section className="settings-section about-section">
      <div className="about-mark">
        <img src={mascotUrl} alt="" />
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
          <button className="primary compact settings-action-button" onClick={onInstallUpdate}>
            <Download size={16} /> Обновить до {updateStatus.version}
          </button>
        ) : updateStatus.kind === 'downloading' ? (
          <progress max="100" value={updateStatus.progress} />
        ) : (
          <button
            className="secondary compact settings-action-button"
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
        <button className="secondary compact settings-action-button" onClick={onSaveDiagnostics}>
          <Save size={16} /> Сохранить на рабочий стол
        </button>
      </div>
      <div className="about-autostart">
        <Toggle
          label="Запускать FreeTalk при включении компьютера"
          description={
            supported
              ? 'Приложение автоматически запустится вместе с системой.'
              : 'Настройка доступна в установленной версии FreeTalk.'
          }
          checked={autostart}
          disabled={!supported || autostartBusy}
          onChange={(enabled) => void changeAutostart(enabled)}
        />
        {autostartError && <small className="error-text">{autostartError}</small>}
      </div>
    </section>
  );
}

function ChatsSettingsTab({
  settings,
  onSetting,
}: {
  settings: LocalSettings;
  onSetting(patch: Partial<LocalSettings>, restart: boolean): void;
}) {
  const [wallpaperError, setWallpaperError] = useState('');
  return (
    <section className="settings-section chat-settings-section">
      <div className="chat-settings-preview-card">
        <div
          className={`chat-settings-preview ${settings.chatMessageStyle}`}
          style={
            {
              '--preview-text-scale': settings.chatTextScale,
              backgroundImage: settings.chatWallpaperDataUrl
                ? `linear-gradient(rgba(1, 10, 20, 0.6), rgba(1, 10, 20, 0.6)), url("${settings.chatWallpaperDataUrl}")`
                : undefined,
            } as CSSProperties
          }
        >
          <div className="preview-message remote">Привет! Как тебе оформление?</div>
          <div className="preview-message own">Отлично, так намного удобнее.</div>
        </div>
        <div>
          <strong>Предпросмотр</strong>
          <small>Изменения сразу применяются ко всем чатам только на этом устройстве.</small>
        </div>
      </div>

      <label className="slider-setting chat-text-size-setting">
        <span>
          <strong>Размер текста сообщений</strong>
          <output>{Math.round(settings.chatTextScale * 100)}%</output>
        </span>
        <input
          aria-label="Размер текста сообщений"
          type="range"
          min="0.85"
          max="1.3"
          step="0.05"
          value={settings.chatTextScale}
          onChange={(event) => onSetting({ chatTextScale: Number(event.target.value) }, false)}
        />
      </label>

      <div className="chat-style-setting">
        <strong>Вид сообщений</strong>
        <div role="radiogroup" aria-label="Вид сообщений">
          <button
            type="button"
            role="radio"
            aria-checked={settings.chatMessageStyle === 'bubbles'}
            className={settings.chatMessageStyle === 'bubbles' ? 'active' : ''}
            onClick={() => onSetting({ chatMessageStyle: 'bubbles' }, false)}
          >
            Пузырьки
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={settings.chatMessageStyle === 'compact'}
            className={settings.chatMessageStyle === 'compact' ? 'active' : ''}
            onClick={() => onSetting({ chatMessageStyle: 'compact' }, false)}
          >
            Компактно
          </button>
        </div>
      </div>

      <div className="chat-wallpaper-setting">
        <div>
          <strong>Обои всех чатов</strong>
          <small>Фото уменьшается перед сохранением и остаётся только на вашем компьютере.</small>
          {wallpaperError && <small className="error-text">{wallpaperError}</small>}
        </div>
        <div>
          <label className="secondary compact profile-file-button settings-action-button">
            <ImagePlus size={16} /> {settings.chatWallpaperDataUrl ? 'Заменить' : 'Выбрать фото'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = '';
                if (!file) return;
                setWallpaperError('');
                void prepareChatWallpaper(file)
                  .then((chatWallpaperDataUrl) => onSetting({ chatWallpaperDataUrl }, false))
                  .catch((caught) =>
                    setWallpaperError(
                      caught instanceof Error ? caught.message : 'Не удалось обработать обои.',
                    ),
                  );
              }}
            />
          </label>
          {settings.chatWallpaperDataUrl && (
            <button
              type="button"
              className="secondary compact settings-action-button"
              onClick={() => onSetting({ chatWallpaperDataUrl: '' }, false)}
            >
              <Trash2 size={15} /> Убрать
            </button>
          )}
        </div>
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
  disabled = false,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
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
        disabled={disabled}
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

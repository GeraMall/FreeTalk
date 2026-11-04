import { QrScanDialog } from './QrLoginDialog';
import { t } from '../lib/app-language';
import { LanguagePicker } from './LanguagePicker';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  AlignLeft,
  ArrowLeft,
  AudioLines,
  Ban,
  Camera,
  ChevronDown,
  Languages,
  ChevronRight,
  CircleDot,
  Download,
  FolderOpen,
  Info,
  ImagePlus,
  Laptop,
  LogOut,
  Mail,
  MessageCircle,
  Mic2,
  MonitorSpeaker,
  Phone,
  QrCode,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  Video,
  X,
} from 'lucide-react';
import { useMobileLayout } from '../lib/mobile-layout';
import { CHAT_TEXT_BASE_SCALE, type LocalSettings } from '../lib/settings';
import {
  prepareAvatar,
  prepareChatWallpaper,
  prepareCover,
  remainingProfileChanges,
} from '../lib/profile';
import { autostartSupported, getAutostartEnabled, setAutostartEnabled } from '../lib/autostart';
import type { UpdateStatus } from '../lib/updater';
import { accountClient, ApiError, type AccountSession, type AccountUser } from '../lib/api-client';
import {
  createCameraEffectCapture,
  imageFileToCameraBackground,
  type CameraEffectCapture,
} from '../lib/camera-background';
import { cameraConstraints } from '../lib/video-manager';
import { NOTIFICATION_SOUND_URL, NotificationSounds } from '../lib/notification-sounds';
import { playMicrophoneToggleSound } from '../lib/microphone-sounds';
import { INCOMING_CALL_RINGTONE_URL } from '../lib/incoming-call-ringtone';
import { playRecordingStartNotification } from '../lib/recording-start-sound';
import {
  chooseRecordingDirectory,
  defaultRecordingDirectory,
  openRecordingDirectory,
  recordingStorageAvailable,
} from '../lib/recording-storage';
import { BrandLogo } from './BrandLogo';
import { CallCardDesigner } from './CallCardDesigner';
import mascotUrl from '../assets/freetalk-mascot.png';
import {
  isValidUsername,
  normalizeUsername,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from '../lib/username';
import { getChatImageCacheStats } from '../lib/chat-image-cache';
import { getAccountMediaCacheStats } from '../lib/account-media-cache';
import { useCachedMediaUrl } from '../lib/use-cached-media';

export type SettingsTab =
  'audio' | 'profile' | 'video' | 'devices' | 'recording' | 'chats' | 'about';

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
  onClearChatCache(): Promise<void>;
}

interface ProfileDraft {
  displayName: string;
  avatar: string;
  cover: string;
  username: string;
  bio: string;
  participantCardStyle: LocalSettings['participantCardStyle'];
}

function profileDraftFrom(settings: LocalSettings, accountUser?: AccountUser): ProfileDraft {
  return {
    displayName: settings.displayName,
    avatar: accountUser?.avatarUrl || settings.avatarDataUrl,
    cover: accountUser?.coverUrl ?? '',
    username: accountUser?.username ?? '',
    bio: accountUser?.bio ?? '',
    participantCardStyle: settings.participantCardStyle,
  };
}

function profileDraftsEqual(first: ProfileDraft, second: ProfileDraft) {
  return (
    first.displayName === second.displayName &&
    first.avatar === second.avatar &&
    first.cover === second.cover &&
    first.username === second.username &&
    first.bio === second.bio &&
    first.participantCardStyle === second.participantCardStyle
  );
}

function maskedEmail(email: string) {
  const [local = '', domain = ''] = email.split('@');
  if (!domain) return email;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'•'.repeat(Math.max(3, local.length - visible.length))}@${domain}`;
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
  onClearChatCache,
}: SettingsPanelProps) {
  const mobileLayout = useMobileLayout();
  const [scanQr, setScanQr] = useState(false);
  const [tab, setTab] = useState<SettingsTab | null>(() =>
    mobileLayout && initialTab === 'audio' ? null : initialTab,
  );
  const [capturing, setCapturing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState('');
  const [testError, setTestError] = useState('');
  const [diagnosticPath, setDiagnosticPath] = useState('');
  const [diagnosticError, setDiagnosticError] = useState('');
  const [savedProfile, setSavedProfile] = useState<ProfileDraft>(() =>
    profileDraftFrom(settings, accountUser),
  );
  const [draftProfile, setDraftProfile] = useState<ProfileDraft>(() =>
    profileDraftFrom(settings, accountUser),
  );
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaveError, setProfileSaveError] = useState('');
  const [confirmProfileClose, setConfirmProfileClose] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const testStream = useRef<MediaStream | undefined>(undefined);
  const testRecorder = useRef<MediaRecorder | undefined>(undefined);
  const recordingUrlRef = useRef('');
  const profileDirty = !profileDraftsEqual(savedProfile, draftProfile);

  const saveProfileDraft = async (closeAfterSave: boolean) => {
    if (!profileDirty) {
      if (closeAfterSave) onClose();
      return true;
    }
    const displayName = draftProfile.displayName.trim();
    const hasUnsafeCharacter = [...displayName].some((character) => {
      const code = character.charCodeAt(0);
      return character === '<' || character === '>' || code <= 31 || code === 127;
    });
    if (!displayName || displayName.length > 32 || hasUnsafeCharacter) {
      setProfileSaveError('Имя должно содержать от 1 до 32 символов без < и >.');
      return false;
    }
    if (!isValidUsername(draftProfile.username)) {
      setProfileSaveError('Username: минимум 5 символов, только латинские буквы, цифры и _.');
      return false;
    }
    setProfileSaving(true);
    setProfileSaveError('');
    try {
      await onSaveProfile(
        displayName,
        draftProfile.avatar,
        draftProfile.username || undefined,
        draftProfile.bio,
        draftProfile.cover,
      );
      if (draftProfile.participantCardStyle !== savedProfile.participantCardStyle)
        onSetting({ participantCardStyle: draftProfile.participantCardStyle }, false);
      const committed = { ...draftProfile, displayName };
      setSavedProfile(committed);
      setDraftProfile(committed);
      if (closeAfterSave) onClose();
      return true;
    } catch (caught) {
      setProfileSaveError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось сохранить профиль. Попробуйте ещё раз.',
      );
      return false;
    } finally {
      setProfileSaving(false);
    }
  };

  const requestClose = () => {
    if (profileDirty) setConfirmProfileClose(true);
    else onClose();
  };

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
      onMouseDown={(event) => event.target === event.currentTarget && requestClose()}
    >
      <section
        className={`settings-modal${mobileLayout ? ' mobile-settings-modal' : ''}${tab ? ' mobile-settings-section-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('Настройки')}
      >
        <aside className="settings-sidebar">
          <div className="settings-sidebar-brand">
            <BrandLogo variant="compact" />
          </div>
          <div className="settings-sidebar-title">
            <span>
              {t('Настройки')}
              {mobileLayout && <small>{t('Выберите раздел')}</small>}
            </span>
            {mobileLayout && (
              <button
                className="icon-button quiet"
                aria-label={t('Закрыть настройки')}
                onClick={requestClose}
              >
                <X size={21} />
              </button>
            )}
          </div>
          <nav aria-label={t('Разделы настроек')}>
            <TabButton
              active={tab === 'audio'}
              icon={<AudioLines />}
              label={t('Аудио')}
              onClick={() => setTab('audio')}
            />
            <TabButton
              active={tab === 'profile'}
              icon={<UserRound />}
              label={t('Профиль')}
              onClick={() => setTab('profile')}
            />
            <TabButton
              active={tab === 'video'}
              icon={<Video />}
              label={t('Видео и звуки')}
              onClick={() => setTab('video')}
            />
            <TabButton
              active={tab === 'devices'}
              icon={<MonitorSpeaker />}
              label={t('Устройства')}
              onClick={() => setTab('devices')}
            />
            <TabButton
              active={tab === 'recording'}
              icon={<CircleDot />}
              label={t('Запись')}
              onClick={() => setTab('recording')}
            />
            <TabButton
              active={tab === 'chats'}
              icon={<MessageCircle />}
              label={t('Чаты')}
              onClick={() => setTab('chats')}
            />
            <TabButton
              active={tab === 'about'}
              icon={<Info />}
              label={t('О приложении')}
              onClick={() => setTab('about')}
            />
          </nav>
          {mobileLayout && accountUser && (
            <button className="qr-login-trigger qr-scan-trigger" onClick={() => setScanQr(true)}>
              <QrCode size={17} /> {t('Сканировать QR для входа')}
            </button>
          )}
          <button className="reset-settings" onClick={() => setConfirmReset(true)}>
            <RotateCcw size={16} />
            {t('Сбросить настройки')}
          </button>
        </aside>

        {(!mobileLayout || tab) && (
          <div className="settings-workspace">
            <header className="settings-header">
              {mobileLayout && (
                <button
                  className="icon-button quiet mobile-settings-back"
                  aria-label={t('Вернуться к разделам настроек')}
                  onClick={() => setTab(null)}
                >
                  <ArrowLeft size={21} />
                </button>
              )}
              <div>
                <p className="eyebrow">
                  {tab === 'audio'
                    ? t('АУДИО')
                    : tab === 'profile'
                      ? t('ПРОФИЛЬ')
                      : tab === 'video'
                        ? t('ВИДЕО И ЗВУКИ')
                        : tab === 'devices'
                          ? t('УСТРОЙСТВА')
                          : tab === 'recording'
                            ? t('ЗАПИСЬ')
                            : tab === 'chats'
                              ? t('ЧАТЫ')
                              : 'TRLKA'}
                </p>
                <h2 id="settings-title">
                  {tab === 'audio'
                    ? t('Настройки звука')
                    : tab === 'profile'
                      ? t('Ваш профиль')
                      : tab === 'video'
                        ? t('Видео и звуки')
                        : tab === 'devices'
                          ? t('Аудиоустройства')
                          : tab === 'recording'
                            ? t('Локальная запись')
                            : tab === 'chats'
                              ? t('Оформление чатов')
                              : t('О приложении')}
                </h2>
              </div>
              <button
                className="icon-button quiet"
                aria-label={t('Закрыть настройки')}
                onClick={requestClose}
              >
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
                  draft={draftProfile}
                  savedDraft={savedProfile}
                  isSaving={profileSaving}
                  saveError={profileSaveError}
                  onDraft={(patch) => {
                    setProfileSaveError('');
                    setDraftProfile((current) => ({ ...current, ...patch }));
                  }}
                  onDraftError={setProfileSaveError}
                  onAccountLogout={onAccountLogout}
                  onDeleteAccount={onDeleteAccount}
                  onChangePassword={onChangePassword}
                  onDone={() => void saveProfileDraft(true)}
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
              {tab === 'chats' && (
                <ChatsSettingsTab
                  settings={settings}
                  accountId={accountUser?.id}
                  onSetting={onSetting}
                  onClearCache={onClearChatCache}
                />
              )}
              {tab === 'recording' && (
                <RecordingSettingsTab settings={settings} onSetting={onSetting} />
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

            {tab !== 'profile' && (
              <footer className="settings-footer">
                <button className="primary settings-done" onClick={requestClose}>
                  {t('Готово')}
                </button>
              </footer>
            )}
          </div>
        )}
      </section>
      {scanQr && <QrScanDialog onClose={() => setScanQr(false)} />}
      {confirmProfileClose ? (
        <div className="profile-confirm-backdrop" onMouseDown={(event) => event.stopPropagation()}>
          <section
            className="profile-confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="profile-confirm-title"
          >
            <header>
              <div>
                <p className="eyebrow">{t('НЕСОХРАНЁННЫЕ ИЗМЕНЕНИЯ')}</p>
                <h2 id="profile-confirm-title">{t('Сохранить изменения?')}</h2>
              </div>
              <button
                className="icon-button quiet"
                aria-label={t('Отмена')}
                onClick={() => setConfirmProfileClose(false)}
              >
                <X />
              </button>
            </header>
            <p>{t('Изменения профиля ещё не применены. Выберите, что с ними сделать.')}</p>
            {profileSaveError ? <small className="inline-error">{profileSaveError}</small> : null}
            <footer>
              <button
                className="primary"
                disabled={profileSaving}
                onClick={() => void saveProfileDraft(true)}
              >
                {profileSaving ? t('Сохраняем…') : t('Сохранить и выйти')}
              </button>
              <button className="secondary" disabled={profileSaving} onClick={onClose}>
                {t('Выйти без сохранения')}
              </button>
              <button
                className="secondary profile-confirm-cancel"
                disabled={profileSaving}
                onClick={() => setConfirmProfileClose(false)}
              >
                {t('Отмена')}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      {confirmReset ? (
        <div className="profile-confirm-backdrop" onMouseDown={(event) => event.stopPropagation()}>
          <section
            className="profile-confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="reset-confirm-title"
          >
            <header>
              <div>
                <p className="eyebrow">{t('СБРОС НАСТРОЕК')}</p>
                <h2 id="reset-confirm-title">{t('Сбросить настройки?')}</h2>
              </div>
            </header>
            <p>
              {t('Настройки звука, видео, записи и оформления вернутся к значениям по умолчанию.')}
            </p>
            <footer>
              <button
                className="danger"
                onClick={() => {
                  setConfirmReset(false);
                  onReset();
                }}
              >
                {t('Сбросить')}
              </button>
              <button className="secondary" onClick={() => setConfirmReset(false)}>
                {t('Отмена')}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function sessionDevicePlatform(userAgent: string) {
  return /Windows/i.test(userAgent)
    ? 'Windows'
    : /Macintosh|Mac OS/i.test(userAgent)
      ? 'macOS'
      : /Android/i.test(userAgent)
        ? 'Android'
        : /iPhone|iPad/i.test(userAgent)
          ? 'iPhone или iPad'
          : /Linux/i.test(userAgent)
            ? 'Linux'
            : 'Неизвестное устройство';
}

function sessionDeviceName(userAgent: string, current = false) {
  const nativeCurrent = current && typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const client = /FreeTalk|Trlka/i.test(userAgent) || nativeCurrent ? 'Trlka' : 'Trlka Web';
  return `${client} · ${sessionDevicePlatform(userAgent)}`;
}

function ProfileTab({
  settings,
  accountUser,
  guestMode,
  draft,
  savedDraft,
  isSaving,
  saveError,
  onDraft,
  onDraftError,
  onAccountLogout,
  onDeleteAccount,
  onChangePassword,
  onDone,
}: {
  settings: LocalSettings;
  accountUser?: AccountUser;
  guestMode: boolean;
  draft: ProfileDraft;
  savedDraft: ProfileDraft;
  isSaving: boolean;
  saveError: string;
  onDraft(patch: Partial<ProfileDraft>): void;
  onDraftError(message: string): void;
  onAccountLogout(): void;
  onDeleteAccount(password: string): Promise<void>;
  onChangePassword(currentPassword: string, newPassword: string): Promise<void>;
  onDone(): void;
}) {
  const cachedDraftAvatar = useCachedMediaUrl(draft.avatar);
  const cachedDraftCover = useCachedMediaUrl(draft.cover);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordChanging, setPasswordChanging] = useState(false);
  const [securityMessage, setSecurityMessage] = useState('');
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState(false);
  const [sessionToDisconnect, setSessionToDisconnect] = useState<string>();
  const [disconnecting, setDisconnecting] = useState(false);
  const [sessionActionError, setSessionActionError] = useState('');

  const sessionGroups = new Map<string, AccountSession[]>();
  for (const session of sessions) {
    const name = sessionDeviceName(session.userAgent, session.current);
    const entries = sessionGroups.get(name);
    if (entries) entries.push(session);
    else sessionGroups.set(name, [session]);
  }

  function renderSession(session: AccountSession, showDeviceName = true) {
    return (
      <article key={session.id}>
        <Laptop />
        <span>
          {showDeviceName && (
            <strong>{sessionDeviceName(session.userAgent, session.current)}</strong>
          )}
          <small>
            {t('Активность:')} {new Date(session.lastActiveAt).toLocaleString('ru-RU')}
          </small>
          <small>
            {t('Подключено:')} {new Date(session.createdAt).toLocaleDateString('ru-RU')}
          </small>
        </span>
        {session.current ? (
          <em>{t('Это устройство')}</em>
        ) : sessionToDisconnect === session.id ? (
          <div className="session-disconnect-confirm">
            <button
              type="button"
              className="secondary"
              disabled={disconnecting}
              onClick={() => {
                setSessionToDisconnect(undefined);
                setSessionActionError('');
              }}
            >
              {t('Отмена')}
            </button>
            <button
              type="button"
              className="session-disconnect-danger"
              disabled={disconnecting}
              onClick={() => void disconnectSession(session.id)}
            >
              {t('Завершить сеанс')}
            </button>
            {sessionActionError && <small role="alert">{sessionActionError}</small>}
          </div>
        ) : (
          <button
            type="button"
            className="secondary session-disconnect"
            disabled={disconnecting}
            onClick={() => {
              setSessionActionError('');
              setSessionToDisconnect(session.id);
            }}
          >
            {t('Отключить')}
          </button>
        )}
      </article>
    );
  }

  async function disconnectSession(id: string) {
    setDisconnecting(true);
    setSessionActionError('');
    try {
      await accountClient.request('/v1/me/sessions/' + encodeURIComponent(id), {
        method: 'DELETE',
      });
      setSessions((previous) => previous.filter((session) => session.id !== id));
      setSessionToDisconnect(undefined);
    } catch (error) {
      setSessionActionError(
        error instanceof ApiError && (error.status === 404 || error.status === 405)
          ? t('Отключение устройств станет доступно после обновления сервера.')
          : t('Не удалось завершить сеанс.'),
      );
    } finally {
      setDisconnecting(false);
    }
  }
  const remaining = remainingProfileChanges(settings.profileChangeTimestamps);
  const usernameValid = isValidUsername(draft.username);
  const profileIdentityChanged =
    draft.displayName.trim() !== savedDraft.displayName ||
    draft.avatar !== savedDraft.avatar ||
    draft.username !== savedDraft.username ||
    draft.bio !== savedDraft.bio ||
    draft.cover !== savedDraft.cover;

  useEffect(() => {
    if (!accountUser) {
      setSessionsLoading(false);
      return;
    }
    let active = true;
    setSessionsLoading(true);
    setSessionsError(false);
    void accountClient
      .request<{ sessions: AccountSession[] }>('/v1/me/sessions')
      .then((result) => {
        if (active) setSessions(Array.isArray(result.sessions) ? result.sessions : []);
      })
      .catch(() => {
        if (active) setSessionsError(true);
      })
      .finally(() => {
        if (active) setSessionsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accountUser]);

  if (guestMode || !accountUser)
    return (
      <div className="profile-tab-layout">
        <div className="profile-tab-scroll">
          <section className="settings-section locked-feature-card">
            <UserRound size={34} />
            <h3>{t('Профиль доступен после регистрации')}</h3>
            <p>
              {t(
                'Зарегистрируйтесь, чтобы пользоваться всеми функциями профиля, друзьями, чатами и историей.',
              )}
            </p>
          </section>
        </div>
        <footer className="profile-sticky-actions single-action">
          <button className="primary profile-done" onClick={onDone}>
            {t('Готово')}
          </button>
        </footer>
      </div>
    );

  return (
    <div className="profile-tab-layout">
      <div className="profile-tab-scroll">
        <div className="profile-redesign">
          <section className="profile-zone profile-account-zone">
            <header className="profile-zone-heading">
              <span className="profile-zone-icon">
                <ShieldCheck />
              </span>
              <span>
                <small>{t('АККАУНТ')}</small>
                <h3>{t('Контактные данные')}</h3>
              </span>
            </header>
            <div className="profile-account-grid">
              <article>
                <Mail />
                <span>
                  <small>{t('Почта')}</small>
                  <strong>{maskedEmail(accountUser.email)}</strong>
                  <em>{t('Подтверждена')}</em>
                </span>
              </article>
              <article>
                <Phone />
                <span>
                  <small>{t('Телефон')}</small>
                  <strong>{t('Не привязан')}</strong>
                  <em>{t('Поддержка появится позже')}</em>
                </span>
                <button
                  className="secondary compact"
                  disabled
                  data-tooltip={t('Серверная привязка телефона пока не поддерживается')}
                >
                  {t('Привязать')}
                </button>
              </article>
            </div>
          </section>

          <section className="profile-zone profile-identity-zone">
            <header className="profile-zone-heading">
              <span className="profile-zone-icon">
                <UserRound />
              </span>
              <span>
                <small>{t('ПРОФИЛЬ')}</small>
                <h3>{t('Внешний вид и имя')}</h3>
              </span>
            </header>
            <div className="profile-media-editor">
              <div
                className="profile-media-cover"
                style={
                  cachedDraftCover ? { backgroundImage: `url(${cachedDraftCover})` } : undefined
                }
              >
                <div className="profile-media-cover-actions">
                  <label className="secondary compact profile-file-button">
                    <ImagePlus />
                    {draft.cover ? t('Заменить обложку') : t('Добавить обложку')}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.currentTarget.value = '';
                        if (!file) return;
                        onDraftError('');
                        void prepareCover(file)
                          .then((cover) => onDraft({ cover }))
                          .catch((caught) =>
                            onDraftError(
                              caught instanceof Error
                                ? caught.message
                                : 'Не удалось обработать обложку.',
                            ),
                          );
                      }}
                    />
                  </label>
                  {draft.cover ? (
                    <button className="secondary compact" onClick={() => onDraft({ cover: '' })}>
                      <Trash2 />
                      {t('Удалить')}
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="profile-media-avatar">
                {cachedDraftAvatar ? (
                  <img src={cachedDraftAvatar} alt={t('Предпросмотр аватара')} />
                ) : (
                  <span>{draft.displayName.trim().charAt(0).toUpperCase() || '?'}</span>
                )}
                <label className="profile-avatar-overlay" aria-label={t('Изменить аватар')}>
                  <ImagePlus />
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.currentTarget.value = '';
                      if (!file) return;
                      onDraftError('');
                      void prepareAvatar(file)
                        .then((avatar) => onDraft({ avatar }))
                        .catch((caught) =>
                          onDraftError(
                            caught instanceof Error
                              ? caught.message
                              : 'Не удалось обработать фото.',
                          ),
                        );
                    }}
                  />
                </label>
              </div>
              <div className="profile-media-caption">
                <strong>{draft.displayName.trim() || 'Ваше имя'}</strong>
                <small>{draft.username ? `@${draft.username}` : t('Добавьте username')}</small>
                {draft.avatar ? (
                  <button
                    type="button"
                    className="profile-remove-avatar"
                    onClick={() => onDraft({ avatar: '' })}
                  >
                    <Trash2 size={15} aria-hidden="true" /> {t('Удалить аватар')}
                  </button>
                ) : null}
              </div>
            </div>
            <p className="profile-media-help">
              {t(
                'Аватар: JPEG, PNG или WebP до 25 МБ, до 768×768. Обложка: до 25 МБ, Trlka подготовит изображение 1800×700.',
              )}
            </p>
            <div className="profile-fields-grid">
              <label className="field-label">
                {t('Отображаемое имя')}
                <input
                  maxLength={32}
                  value={draft.displayName}
                  placeholder={t('Ваше имя')}
                  onChange={(event) => onDraft({ displayName: event.target.value })}
                />
                <small>{draft.displayName.length}/32</small>
              </label>
              <label className="field-label">
                {t('Уникальный @username')}
                <input
                  minLength={USERNAME_MIN_LENGTH}
                  maxLength={USERNAME_MAX_LENGTH}
                  pattern="[a-z0-9_]{5,24}"
                  aria-invalid={!usernameValid}
                  value={draft.username}
                  onChange={(event) => onDraft({ username: normalizeUsername(event.target.value) })}
                />
                <small>{t('5–24 символа: латиница, цифры и _. Изменение раз в 30 дней.')}</small>
              </label>
              <label className="field-label profile-bio-field">
                {t('О себе')}
                <textarea
                  value={draft.bio}
                  maxLength={200}
                  rows={4}
                  placeholder={t('Несколько слов о себе')}
                  onChange={(event) => onDraft({ bio: event.target.value })}
                />
                <small>{draft.bio.length}/200</small>
              </label>
            </div>
            <div className="profile-limit">
              <span>
                {remaining > 0
                  ? t('Осталось изменений: {p0} из 5', { p0: remaining })
                  : t('Лимит изменений исчерпан')}
              </span>
              <small>
                {t('Имя и аватар вместе можно сохранять не более пяти раз за пять часов.')}
              </small>
            </div>
          </section>

          <CallCardDesigner
            name={draft.displayName}
            avatar={cachedDraftAvatar ?? ''}
            glass={draft.participantCardStyle === 'avatar-glass'}
            onGlass={(value) =>
              onDraft({ participantCardStyle: value ? 'avatar-glass' : 'classic' })
            }
          />

          <section className="profile-zone profile-security-zone">
            <header className="profile-zone-heading">
              <span className="profile-zone-icon">
                <ShieldCheck />
              </span>
              <span>
                <small>{t('БЕЗОПАСНОСТЬ')}</small>
                <h3>{t('Доступ к аккаунту')}</h3>
              </span>
            </header>
            <details className="connected-devices profile-accordion">
              <summary>
                <span className="connected-devices-icon">
                  <Laptop />
                </span>
                <span>
                  <strong>{t('Подключённые устройства')}</strong>
                  <small>
                    {sessionsLoading
                      ? t('Проверяем активные сеансы…')
                      : sessionsError
                        ? t('Не удалось получить список')
                        : t('Сеансы: {count}', { count: sessions.length })}
                  </small>
                </span>
                {!sessionsLoading && !sessionsError && <b>{sessions.length}</b>}
                <ChevronDown className="connected-devices-chevron" />
              </summary>
              <div className="connected-device-list">
                {sessionsError ? (
                  <p>{t('Не удалось загрузить информацию об устройствах.')}</p>
                ) : sessions.length === 0 && !sessionsLoading ? (
                  <p>{t('Активных устройств нет.')}</p>
                ) : (
                  Array.from(sessionGroups, ([name, entries]) =>
                    entries.length === 1 ? (
                      renderSession(entries[0]!)
                    ) : (
                      <details className="connected-session-group" key={name}>
                        <summary>
                          <Laptop aria-hidden="true" />
                          <strong>{name}</strong>
                          {entries.some((entry) => entry.current) && <em>{t('Это устройство')}</em>}
                          <small>{t('Сеансы: {count}', { count: entries.length })}</small>
                          <ChevronDown aria-hidden="true" />
                        </summary>
                        {entries.map((session) => renderSession(session, false))}
                      </details>
                    ),
                  )
                )}
              </div>
            </details>
            <details className="profile-accordion">
              <summary>
                <span className="connected-devices-icon">
                  <ShieldCheck />
                </span>
                <span>
                  <strong>{t('Изменить пароль')}</strong>
                  <small>{t('Обновите пароль от аккаунта')}</small>
                </span>
                <ChevronDown className="connected-devices-chevron" />
              </summary>
              <div className="password-change-form">
                <input
                  type="password"
                  value={currentPassword}
                  placeholder={t('Текущий пароль')}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
                <input
                  type="password"
                  value={newPassword}
                  placeholder={t('Новый пароль')}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
                <button
                  type="button"
                  className="primary"
                  disabled={!currentPassword || !newPassword || passwordChanging || disconnecting}
                  onClick={() => {
                    onDraftError('');
                    setSecurityMessage('');
                    setPasswordChanging(true);
                    void onChangePassword(currentPassword, newPassword)
                      .then(() => {
                        setCurrentPassword('');
                        setNewPassword('');
                        setSecurityMessage(t('Пароль успешно изменён.'));
                        setSessions((previous) => previous.filter((session) => session.current));
                        setSessionToDisconnect(undefined);
                      })
                      .catch((caught: unknown) =>
                        onDraftError(
                          caught instanceof Error
                            ? caught.message
                            : t('Не удалось изменить пароль'),
                        ),
                      )
                      .finally(() => setPasswordChanging(false));
                  }}
                >
                  {t('Изменить пароль')}
                </button>
              </div>
            </details>
            {securityMessage ? <small className="inline-success">{securityMessage}</small> : null}
          </section>

          <section className="profile-zone profile-account-actions-zone">
            <header className="profile-zone-heading">
              <span className="profile-zone-icon">
                <LogOut />
              </span>
              <span>
                <small>{t('ДЕЙСТВИЯ')}</small>
                <h3>{t('Управление аккаунтом')}</h3>
              </span>
            </header>
            <div className="profile-account-actions-grid">
              <button className="secondary" onClick={onAccountLogout}>
                <span className="profile-action-icon">
                  <LogOut />
                </span>
                <span>
                  <strong>{t('Выйти из аккаунта')}</strong>
                  <small>{t('Завершить текущий сеанс')}</small>
                </span>
                <ChevronRight className="profile-action-chevron" />
              </button>
              <details className="danger-zone profile-accordion">
                <summary>
                  <span className="profile-action-icon">
                    <Trash2 />
                  </span>
                  <span>
                    <strong>{t('Удалить аккаунт')}</strong>
                    <small>{t('Безвозвратно удалить личные данные')}</small>
                  </span>
                  <ChevronDown />
                </summary>
                <p>{t('Личные данные будут удалены или обезличены, а все сессии завершены.')}</p>
                <input
                  type="password"
                  value={deletePassword}
                  placeholder={t('Текущий пароль')}
                  onChange={(event) => setDeletePassword(event.target.value)}
                />
                <input
                  value={deleteConfirmation}
                  placeholder={t('Введите УДАЛИТЬ')}
                  onChange={(event) => setDeleteConfirmation(event.target.value)}
                />
                <button
                  className="danger"
                  disabled={!deletePassword || deleteConfirmation !== 'УДАЛИТЬ'}
                  onClick={() => {
                    onDraftError('');
                    void onDeleteAccount(deletePassword).catch((caught: unknown) =>
                      onDraftError(
                        caught instanceof Error ? caught.message : 'Не удалось удалить аккаунт',
                      ),
                    );
                  }}
                >
                  {t('Удалить навсегда')}
                </button>
              </details>
            </div>
          </section>
          {saveError ? (
            <div className="profile-save-error" role="alert">
              {saveError}
            </div>
          ) : null}
        </div>
      </div>
      <footer className="profile-sticky-actions single-action">
        {profileIdentityChanged && remaining === 0 ? (
          <span role="status">{t('Лимит изменений профиля исчерпан')}</span>
        ) : null}
        <button
          className="primary profile-done"
          disabled={isSaving || !usernameValid || (profileIdentityChanged && remaining === 0)}
          onClick={onDone}
        >
          {isSaving ? t('Сохраняем…') : t('Готово')}
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
  const participantSounds = useRef<NotificationSounds | null>(null);
  const previewParticipant = async (joined: boolean) => {
    participantSounds.current ??= new NotificationSounds();
    await participantSounds.current.setOutput(settings.outputDeviceId);
    if (joined) await participantSounds.current.playJoined();
    else await participantSounds.current.playDisconnected();
  };
  useEffect(() => () => participantSounds.current?.stop(), []);
  return (
    <fieldset className="video-settings-fieldset" disabled={locked}>
      {locked && (
        <div className="locked-feature-card">
          <Video size={30} />
          <strong>{t('Видео доступно после регистрации')}</strong>
          <small>{t('Гости могут общаться только голосом.')}</small>
        </div>
      )}
      <section className="settings-section video-settings-section">
        <div className="section-title-row">
          <div className="video-section-heading">
            <span className="profile-zone-icon">
              <MonitorSpeaker />
            </span>
            <div>
              <h3>{t('Демонстрация экрана')}</h3>
              <p className="settings-section-description">
                {t('Качество изображения и звук при показе экрана.')}
              </p>
            </div>
          </div>
          <span className="quality-summary">
            {settings.screenResolution} · {settings.screenFrameRate} FPS
          </span>
        </div>
        <div className="video-quality-grid">
          <label className="field-label">
            {t('Тип содержимого')}
            <select
              value={settings.screenContentMode}
              onChange={(event) =>
                onVideoSetting({
                  screenContentMode: event.target.value as LocalSettings['screenContentMode'],
                })
              }
            >
              <option value="text">{t('Текст · максимальная чёткость')}</option>
              <option value="balanced">{t('Универсальный · чётко и плавно')}</option>
              <option value="video">{t('Видео · плавное движение')}</option>
            </select>
            <small>
              {t('«Текст» бережёт детали, универсальный режим балансирует их с движением.')}
            </small>
          </label>
          <label className="field-label">
            {t('Максимальное разрешение')}
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
            <small>{t('Задаёт верхнюю границу детализации передаваемого изображения.')}</small>
          </label>
          <label className="field-label">
            {t('Частота кадров')}
            <select
              value={settings.screenFrameRate}
              onChange={(event) =>
                onVideoSetting({
                  screenFrameRate: Number(event.target.value) as LocalSettings['screenFrameRate'],
                })
              }
            >
              <option value="15">{t('15 FPS · экономно')}</option>
              <option value="30">{t('30 FPS · рекомендуется')}</option>
              <option value="60">{t('60 FPS · плавно')}</option>
            </select>
            <small>{t('Определяет плавность движения при достаточной скорости сети.')}</small>
          </label>
        </div>
        <div className="video-toggle-list">
          <Toggle
            label={t('Передавать звук по умолчанию')}
            description={t('Запрашивает звук выбранного окна или экрана при запуске демонстрации.')}
            checked={settings.screenAudioByDefault}
            onChange={(value) => onVideoSetting({ screenAudioByDefault: value })}
          />
          <Toggle
            label={t('Адаптивное качество')}
            description={t(
              'Подстраивает FPS, разрешение и битрейт под сеть с учётом выбранного типа содержимого.',
            )}
            checked={settings.screenAdaptiveQuality}
            onChange={(value) => onVideoSetting({ screenAdaptiveQuality: value })}
          />
        </div>
        <div className="adaptive-quality-note">
          <strong>{t('Без остановок на слабой сети')}</strong>
          <small>
            {t(
              'Каждый собеседник получает индивидуальное качество. После восстановления соединения Trlka автоматически возвращает выбранные параметры.',
            )}
          </small>
        </div>
        <small className="video-apply-note">
          {t(
            'Разрешение и FPS применятся при следующем запуске демонстрации. По умолчанию — 1080p/30 FPS; максимум — 2K/60 FPS.',
          )}
        </small>
      </section>

      <section className="settings-section video-settings-section">
        <div className="video-section-heading">
          <span className="profile-zone-icon">
            <Camera />
          </span>
          <div>
            <h3>{t('Камера')}</h3>
            <p className="settings-section-description">
              {t('Проверьте изображение и выберите фон перед звонком.')}
            </p>
          </div>
        </div>
        <CameraSettingsEditor
          settings={settings}
          cameras={cameras}
          onCamera={onCamera}
          onVideoSetting={onVideoSetting}
        />
      </section>

      <section className="settings-section video-settings-section sound-settings-section">
        <div className="video-section-heading">
          <span className="profile-zone-icon">
            <AudioLines />
          </span>
          <div>
            <h3>{t('Звуки событий')}</h3>
            <p className="settings-section-description">
              {t('Каждый звук можно отключить отдельно и предварительно прослушать.')}
            </p>
          </div>
        </div>
        <div className="sound-setting-list">
          <SoundSetting
            label={t('Участник подключился')}
            checked={settings.participantJoinedSound}
            onChange={(value) => onVideoSetting({ participantJoinedSound: value })}
            onPreview={() => void previewParticipant(true)}
          />
          <SoundSetting
            label={t('Участник отключился')}
            checked={settings.participantDisconnectedSound}
            onChange={(value) => onVideoSetting({ participantDisconnectedSound: value })}
            onPreview={() => void previewParticipant(false)}
          />
          <SoundSetting
            label={t('Начало записи')}
            checked={settings.recordingStartSound}
            onChange={(value) => onVideoSetting({ recordingStartSound: value })}
            onPreview={() => void playRecordingStartNotification(settings)}
          />
          <SoundSetting
            label={t('Микрофон включён')}
            checked={settings.microphoneEnabledSound}
            onChange={(value) => onVideoSetting({ microphoneEnabledSound: value })}
            onPreview={() =>
              void playMicrophoneToggleSound(false, { ...settings, microphoneEnabledSound: true })
            }
          />
          <SoundSetting
            label={t('Микрофон выключен')}
            checked={settings.microphoneDisabledSound}
            onChange={(value) => onVideoSetting({ microphoneDisabledSound: value })}
            onPreview={() =>
              void playMicrophoneToggleSound(true, { ...settings, microphoneDisabledSound: true })
            }
          />
          <SoundSetting
            label={t('Входящий звонок')}
            checked={settings.incomingCallSound}
            onChange={(value) => onVideoSetting({ incomingCallSound: value })}
            onPreview={() => void playSettingsSound(INCOMING_CALL_RINGTONE_URL, settings)}
          />
          <SoundSetting
            label={t('Уведомление о сообщении')}
            checked={settings.messageNotificationSound}
            onChange={(value) => onVideoSetting({ messageNotificationSound: value })}
            onPreview={() => void playSettingsSound(NOTIFICATION_SOUND_URL, settings)}
          />
        </div>
      </section>
    </fieldset>
  );
}

function CameraSettingsEditor({
  settings,
  cameras,
  onCamera,
  onVideoSetting,
}: {
  settings: LocalSettings;
  cameras: MediaDeviceInfo[];
  onCamera(value: string): void;
  onVideoSetting(patch: Partial<LocalSettings>): void;
}) {
  const [previewing, setPreviewing] = useState(false);
  const [previewStream, setPreviewStream] = useState<MediaStream>();
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const captureRef = useRef<CameraEffectCapture | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!previewing) return;
    let active = true;
    let capture: CameraEffectCapture | undefined;
    setPreviewBusy(true);
    setPreviewError('');
    setPreviewStream(undefined);
    if (!navigator.mediaDevices?.getUserMedia) {
      setPreviewError('Предпросмотр камеры недоступен в этой среде.');
      setPreviewBusy(false);
      return;
    }
    void navigator.mediaDevices
      .getUserMedia({ audio: false, video: cameraConstraints(settings.cameraDeviceId) })
      .then((source) =>
        createCameraEffectCapture(source, {
          mode: settings.cameraBackgroundMode,
          dataUrl: settings.cameraBackgroundDataUrl,
        }),
      )
      .then((nextCapture) => {
        capture = nextCapture;
        if (!active) return nextCapture.dispose();
        captureRef.current = nextCapture;
        setPreviewStream(nextCapture.stream);
      })
      .catch((caught) => {
        if (active)
          setPreviewError(caught instanceof Error ? caught.message : 'Не удалось открыть камеру.');
      })
      .finally(() => {
        if (active) setPreviewBusy(false);
      });
    return () => {
      active = false;
      if (captureRef.current === capture) captureRef.current = undefined;
      capture?.dispose();
    };
  }, [
    previewing,
    settings.cameraBackgroundDataUrl,
    settings.cameraBackgroundMode,
    settings.cameraDeviceId,
  ]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = previewStream ?? null;
    if (previewStream) void video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [previewStream]);

  const chooseBackground = async (file?: File) => {
    if (!file) return;
    try {
      const dataUrl = await imageFileToCameraBackground(file);
      onVideoSetting({ cameraBackgroundDataUrl: dataUrl, cameraBackgroundMode: 'custom' });
    } catch (caught) {
      setPreviewError(
        caught instanceof Error ? caught.message : 'Не удалось обработать изображение.',
      );
    }
  };

  return (
    <div className="settings-camera-editor">
      <div className={`settings-camera-preview${previewing ? ' active' : ''}`}>
        {previewing && (
          <video
            ref={videoRef}
            className={settings.mirrorSelfVideo ? 'mirrored' : undefined}
            muted
            playsInline
          />
        )}
        {!previewing && (
          <button type="button" className="primary" onClick={() => setPreviewing(true)}>
            <Camera /> {t('Проверить видео')}
          </button>
        )}
        {previewBusy && <span>{t('Подготавливаем камеру…')}</span>}
        {previewError && <span className="camera-preview-error">{previewError}</span>}
        {previewing && (
          <button
            type="button"
            className="settings-camera-preview-stop"
            onClick={() => setPreviewing(false)}
          >
            {t('Остановить предпросмотр')}
          </button>
        )}
      </div>
      <Toggle
        label={t('Предпросмотр видео (всегда)')}
        description={t('Показывать окно подготовки каждый раз перед включением камеры.')}
        checked={settings.cameraPreviewAlways}
        onChange={(value) => onVideoSetting({ cameraPreviewAlways: value })}
      />
      <Toggle
        label={t('Отражать моё видео')}
        description={t(
          'Показывать своё изображение как в зеркале. Собеседники всегда видят обычное изображение.',
        )}
        checked={settings.mirrorSelfVideo}
        onChange={(value) => onVideoSetting({ mirrorSelfVideo: value })}
      />
      <label className="field-label">
        {t('Камера')}
        <select value={settings.cameraDeviceId} onChange={(event) => onCamera(event.target.value)}>
          <option value="">{t('Системная камера')}</option>
          {cameras.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Камера ${index + 1}`}
            </option>
          ))}
        </select>
      </label>
      <div className="settings-camera-backgrounds">
        <strong>{t('Фон видео')}</strong>
        <div>
          <button
            type="button"
            className={settings.cameraBackgroundMode === 'none' ? 'selected' : ''}
            onClick={() => onVideoSetting({ cameraBackgroundMode: 'none' })}
          >
            <Ban />
            <span>{t('Пусто')}</span>
          </button>
          <button
            type="button"
            className={`blur${settings.cameraBackgroundMode === 'blur' ? ' selected' : ''}`}
            onClick={() => onVideoSetting({ cameraBackgroundMode: 'blur' })}
          >
            <Sparkles />
            <span>{t('Размытие')}</span>
          </button>
          <button
            type="button"
            className={`custom${settings.cameraBackgroundMode === 'custom' ? ' selected' : ''}`}
            style={
              settings.cameraBackgroundDataUrl
                ? { backgroundImage: `url(${settings.cameraBackgroundDataUrl})` }
                : undefined
            }
            onClick={() =>
              settings.cameraBackgroundDataUrl
                ? onVideoSetting({ cameraBackgroundMode: 'custom' })
                : fileRef.current?.click()
            }
          >
            <ImagePlus />
            <span>{t('Свой фон')}</span>
          </button>
        </div>
        <button
          type="button"
          className="secondary compact"
          onClick={() => fileRef.current?.click()}
        >
          <ImagePlus />
          {settings.cameraBackgroundDataUrl ? t('Заменить свой фон') : t('Выбрать свой фон')}
        </button>
        <input
          ref={fileRef}
          hidden
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = '';
            void chooseBackground(file);
          }}
        />
      </div>
    </div>
  );
}

function SoundSetting({
  label,
  checked,
  onChange,
  onPreview,
}: {
  label: string;
  checked: boolean;
  onChange(value: boolean): void;
  onPreview(): void;
}) {
  return (
    <div className="sound-setting-row">
      <span>
        <strong>{label}</strong>
      </span>
      <button
        type="button"
        className="secondary compact sound-preview-button"
        aria-label={t('Прослушать звук: {p0}', { p0: label })}
        onClick={onPreview}
      >
        <AudioLines size={16} /> {t('Прослушать')}
      </button>
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

async function playSettingsSound(url: string, settings: LocalSettings) {
  const audio = new Audio(url);
  audio.volume = settings.outputVolume;
  if (settings.outputDeviceId && 'setSinkId' in audio)
    await (audio as HTMLAudioElement & { setSinkId(id: string): Promise<void> })
      .setSinkId(settings.outputDeviceId)
      .catch(() => undefined);
  await audio.play().catch(() => undefined);
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
      <section className="settings-section audio-settings-section">
        <div className="video-section-heading">
          <span className="profile-zone-icon">
            <Mic2 />
          </span>
          <div>
            <h3>{t('Режим передачи')}</h3>
            <p className="settings-section-description">
              {t('Выберите, когда собеседники будут слышать ваш микрофон.')}
            </p>
          </div>
        </div>
        <div className="transmission-modes" role="radiogroup" aria-label={t('Режим передачи')}>
          <ModeOption
            title={t('По голосу (VAD)')}
            detail="Передаёт голос, когда вы говорите"
            value="voice-activation"
            icon={<AudioLines />}
            settings={settings}
            onSetting={onSetting}
          />
          <ModeOption
            title={t('Нажми и говори')}
            detail="Удерживайте клавишу для передачи"
            value="push-to-talk"
            icon={<Mic2 />}
            settings={settings}
            onSetting={onSetting}
          />
          <ModeOption
            title={t('Постоянная передача')}
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
              <strong>{t('Порог голосовой активности')}</strong>
              <output>{Math.round((settings.vadThreshold / 0.1) * 100)}%</output>
            </span>
            <div
              className="level-meter"
              aria-label={t('Уровень микрофона {p0}%', { p0: Math.round(inputLevel * 100) })}
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
            <small>
              {t('Передача начинается, когда голос становится громче выбранного порога.')}
            </small>
          </label>
        )}
        {settings.transmissionMode === 'push-to-talk' && (
          <label className="key-setting">
            <span>
              <strong>{t('Клавиша push-to-talk')}</strong>
              <small>{t('Работает внутри окна и не срабатывает во время ввода текста.')}</small>
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
              {capturing ? t('Нажмите клавишу…') : prettyKey(settings.pushToTalkKey)}
            </button>
          </label>
        )}
      </section>

      <section className="settings-section audio-settings-section">
        <div className="section-title-row">
          <div className="video-section-heading">
            <span className="profile-zone-icon">
              <AudioLines />
            </span>
            <div>
              <h3>{t('Обработка микрофона')}</h3>
              <p className="settings-section-description">
                {t('Уберите лишние звуки и выровняйте голос.')}
              </p>
            </div>
          </div>
          <button className="secondary compact" disabled={recording} onClick={onRecord}>
            <AudioLines size={16} />
            {recording ? t('Запись 4 секунды…') : t('Записать тест')}
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
            label={t('Шумоподавление')}
            description={t('Удаляет постоянный фоновый шум.')}
            checked={settings.noiseSuppression}
            onChange={(value) => onSetting({ noiseSuppression: value }, true)}
          />
          <Toggle
            label={t('Автоматическое усиление')}
            description={t('Выравнивает громкость микрофона.')}
            checked={settings.autoGainControl}
            onChange={(value) => onSetting({ autoGainControl: value }, true)}
          />
          <Toggle
            label={t('Подавлять щелчки клавиатуры')}
            description={t('Приостанавливает передачу при вводе.')}
            checked={settings.typingAttenuation}
            onChange={(value) => onSetting({ typingAttenuation: value }, false)}
          />
          <Toggle
            label={t('Подавление эха')}
            description={t('Снижает эхо и обратную связь.')}
            checked={settings.echoCancellation}
            onChange={(value) => onSetting({ echoCancellation: value }, true)}
          />
          <Toggle
            label={t('Комфортный шум')}
            description={t('Добавляет едва слышимый фон в паузах.')}
            checked={settings.comfortNoise}
            onChange={(value) => onSetting({ comfortNoise: value }, true)}
          />
        </div>
      </section>

      <section className="settings-section audio-settings-section">
        <div className="video-section-heading">
          <span className="profile-zone-icon">
            <MonitorSpeaker />
          </span>
          <div>
            <h3>{t('Громкость собеседников')}</h3>
            <p className="settings-section-description">
              {t('Настройте приглушение голосов других участников.')}
            </p>
          </div>
        </div>
        <Toggle
          label={t('Приглушать собеседников')}
          description={t('Снижает громкость других участников.')}
          checked={settings.echoDucking}
          onChange={(value) => onSetting({ echoDucking: value }, false)}
        />
        {settings.echoDucking && (
          <label className="slider-setting compact-slider">
            <span>
              <strong>{t('Громкость при приглушении')}</strong>
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
            <small>{t('Оставшаяся громкость голосов: 0% — тишина, 100% — без приглушения.')}</small>
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
      <h3>{t('Микрофон')}</h3>
      <label className="field-label">
        {t('Устройство захвата звука')}
        <select value={settings.inputDeviceId} onChange={(event) => onInput(event.target.value)}>
          <option value="">{t('Системное устройство по умолчанию')}</option>
          {devices.inputs.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Микрофон ${index + 1}`}
            </option>
          ))}
        </select>
      </label>
      <div className="section-separator" />
      <h3>{t('Динамики / наушники')}</h3>
      <label className="field-label">
        {t('Устройство воспроизведения')}
        <select
          disabled={!outputSupported}
          value={settings.outputDeviceId}
          onChange={(event) => onOutput(event.target.value)}
        >
          <option value="">{t('Системное устройство по умолчанию')}</option>
          {devices.outputs.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Динамики ${index + 1}`}
            </option>
          ))}
        </select>
        {!outputSupported && <small>{t('Выбор вывода не поддерживается текущим WebView.')}</small>}
      </label>
      <label className="slider-setting">
        <span>
          <strong>{t('Общая громкость голосов')}</strong>
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
        <h3>Trlka</h3>
        <p>{t('Бесплатная голосовая связь для небольших закрытых компаний.')}</p>
      </div>
      <dl>
        <div>
          <dt>{t('Версия')}</dt>
          <dd>{appVersion}</dd>
        </div>
        <div>
          <dt>{t('Аудио')}</dt>
          <dd>WebRTC · Opus</dd>
        </div>
        <div>
          <dt>{t('Телеметрия')}</dt>
          <dd>{t('Отсутствует')}</dd>
        </div>
        <div>
          <dt>{t('Резервное соединение')}</dt>
          <dd>{turnAvailable ? t('TURN готов') : t('Прямой WebRTC (STUN)')}</dd>
        </div>
      </dl>
      <div className="update-section">
        <div>
          <strong>{t('Обновления')}</strong>
          <small>{updateMessage(updateStatus, appVersion)}</small>
        </div>
        {updateStatus.kind === 'available' ? (
          <button className="primary compact settings-action-button" onClick={onInstallUpdate}>
            <Download size={16} /> {t('Обновить до')} {updateStatus.version}
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
            {updateStatus.kind === 'checking' ? t('Проверяем…') : t('Проверить')}
          </button>
        )}
      </div>
      <div className="update-section">
        <div>
          <strong>{t('Диагностика подключения')}</strong>
          <small>{t('Обезличенный таймлайн ICE и RTP без адресов, SDP и секретов.')}</small>
          {diagnosticPath && (
            <small>
              {t('Сохранено:')} {diagnosticPath}
            </small>
          )}
          {diagnosticError && <small className="error-text">{diagnosticError}</small>}
        </div>
        <button className="secondary compact settings-action-button" onClick={onSaveDiagnostics}>
          <Save size={16} /> {t('Сохранить на рабочий стол')}
        </button>
      </div>
      <div className="about-autostart">
        <Toggle
          label={t('Запускать Trlka при включении компьютера')}
          description={
            supported
              ? t('Приложение автоматически запустится вместе с системой.')
              : t('Настройка доступна в установленной версии Trlka.')
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

function RecordingSettingsTab({
  settings,
  onSetting,
}: {
  settings: LocalSettings;
  onSetting(patch: Partial<LocalSettings>, restart: boolean): void;
}) {
  const [defaultDirectory, setDefaultDirectory] = useState('');
  const [error, setError] = useState('');
  const [availableBytes, setAvailableBytes] = useState<number>();

  useEffect(() => {
    void defaultRecordingDirectory()
      .then(setDefaultDirectory)
      .catch(() => undefined);
  }, []);

  const directory = settings.recordingDirectory || defaultDirectory || 'Видео/Trlka';
  useEffect(() => {
    if (!directory || directory === 'Видео/Trlka') return;
    void recordingStorageAvailable(settings.recordingDirectory)
      .then(setAvailableBytes)
      .catch(() => setAvailableBytes(undefined));
  }, [directory, settings.recordingDirectory]);
  const changeDirectory = async () => {
    setError('');
    try {
      const selected = await chooseRecordingDirectory(directory);
      if (selected) onSetting({ recordingDirectory: selected }, false);
    } catch {
      setError('Не удалось выбрать папку.');
    }
  };

  return (
    <div className="recording-settings-page">
      <section className="settings-section recording-storage-section">
        <div className="video-section-heading">
          <span className="profile-zone-icon">
            <FolderOpen />
          </span>
          <div>
            <h3>{t('Локальное хранилище записей')}</h3>
            <p className="settings-section-description">
              {t('Видео сохраняется только на этом компьютере и не загружается на сервер.')}
            </p>
          </div>
        </div>
        <div className="recording-directory-row">
          <div className="recording-directory-value" data-tooltip={directory}>
            <FolderOpen size={17} />
            <span>{directory}</span>
          </div>
          <button
            className="secondary compact"
            onClick={() =>
              void openRecordingDirectory(settings.recordingDirectory).catch(() =>
                setError('Папка ещё не создана. Начните первую запись.'),
              )
            }
          >
            {t('Открыть')}
          </button>
          <button className="secondary compact" onClick={() => void changeDirectory()}>
            {t('Изменить')}
          </button>
        </div>
        {error && <small className="field-error">{error}</small>}
        {availableBytes !== undefined && (
          <small className="recording-space-available">
            {t('Свободно')} {formatStorageSize(availableBytes)}
          </small>
        )}
        <Toggle
          label={t('Спрашивать папку перед записью')}
          description={t('Перед началом каждой записи Trlka спросит, куда сохранить видео.')}
          checked={settings.recordingAskDirectory}
          onChange={(value) => onSetting({ recordingAskDirectory: value }, false)}
        />
      </section>

      <section className="settings-section recording-options-section">
        <div className="video-section-heading">
          <span className="profile-zone-icon">
            <CircleDot />
          </span>
          <div>
            <h3>{t('Настройки записи')}</h3>
            <p className="settings-section-description">
              {t(
                'Запись создаётся в WebM или MP4 с высоким битрейтом и исходным разрешением выбранного экрана.',
              )}
            </p>
          </div>
        </div>
        <div className="video-toggle-list">
          <Toggle
            label={t('Показывать имена участников')}
            description={t('Добавляет имена участников комнаты в нижнюю часть записи.')}
            checked={settings.recordingShowParticipantNames}
            onChange={(value) => onSetting({ recordingShowParticipantNames: value }, false)}
          />
          <Toggle
            label={t('Добавить временную метку')}
            description={t('Показывает локальные дату и время в правом верхнем углу записи.')}
            checked={settings.recordingAddTimestamp}
            onChange={(value) => onSetting({ recordingAddTimestamp: value }, false)}
          />
          <Toggle
            label={t('Записывать видео при демонстрации экрана')}
            description={t('Использует уже выбранную демонстрацию без повторного запроса экрана.')}
            checked={settings.recordingIncludeSharedVideo}
            onChange={(value) => onSetting({ recordingIncludeSharedVideo: value }, false)}
          />
        </div>
      </section>
    </div>
  );
}

function formatStorageSize(bytes: number) {
  const gigabytes = bytes / 1024 ** 3;
  return `${gigabytes >= 10 ? gigabytes.toFixed(0) : gigabytes.toFixed(1)} ГБ`;
}

function ChatsSettingsTab({
  settings,
  accountId,
  onSetting,
  onClearCache,
}: {
  settings: LocalSettings;
  accountId?: string;
  onSetting(patch: Partial<LocalSettings>, restart: boolean): void;
  onClearCache(): Promise<void>;
}) {
  const [wallpaperError, setWallpaperError] = useState('');
  const [cacheBytes, setCacheBytes] = useState(0);
  const [cacheEntries, setCacheEntries] = useState(0);
  const [cacheBusy, setCacheBusy] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    void Promise.all([
      getChatImageCacheStats(accountId),
      getAccountMediaCacheStats(accountId),
    ]).then((stats) => {
      setCacheBytes(stats.reduce((total, value) => total + value.bytes, 0));
      setCacheEntries(stats.reduce((total, value) => total + value.entries, 0));
    });
  }, [accountId]);

  const clearCache = async () => {
    setCacheBusy(true);
    try {
      await onClearCache();
      setCacheBytes(0);
      setCacheEntries(0);
    } finally {
      setCacheBusy(false);
    }
  };

  const chatPreview = (
    <div
      className={`chat-settings-preview ${settings.chatMessageStyle}`}
      aria-label={t('Предпросмотр оформления чата')}
      style={
        {
          '--ft-chat-text-scale': settings.chatTextScale * CHAT_TEXT_BASE_SCALE,
          backgroundImage: settings.chatWallpaperDataUrl
            ? `linear-gradient(#07111dbb, #07111dbb), url("${settings.chatWallpaperDataUrl}")`
            : undefined,
          backgroundSize: settings.chatWallpaperDataUrl
            ? `100% 100%, ${settings.chatWallpaperFit}`
            : undefined,
        } as CSSProperties
      }
    >
      {[
        { name: 'Макс', text: 'Привет! Как тебе оформление?', time: '12:00', own: false },
        { name: 'Алекс', text: 'Отлично, так намного удобнее.', time: '12:01', own: true },
      ].map(({ name, text, time, own }) => (
        <div className={`message-bubble-row ${own ? 'own' : 'remote'}`} key={time}>
          <span className="chat-avatar compact" aria-hidden="true">
            {name[0]}
          </span>
          <div className="message-bubble-stack">
            <div className="message-bubble text-message-bubble">
              <strong className="message-author compact-message-author">{name}</strong>
              <p>{text}</p>
              <span className="message-meta">
                <time dateTime={time}>{time}</time>
              </span>
            </div>
          </div>
        </div>
      ))}
      <div className="preview-composer">{t('Написать сообщение…')}</div>
    </div>
  );

  return (
    <section className="settings-section chat-settings-section">
      <div className="chat-settings-group language-settings-card">
        <div className="video-section-heading">
          <span className="profile-zone-icon" aria-hidden="true">
            <Languages />
          </span>
          <div>
            <h3>{t('Язык программы')}</h3>
            <p className="settings-section-description">{t('Язык изменится после перезапуска.')}</p>
          </div>
        </div>
        <LanguagePicker />
      </div>
      <div className="chat-settings-group">
        <div className="video-section-heading">
          <span className="profile-zone-icon">
            <MessageCircle />
          </span>
          <div>
            <h3>{t('Сообщения')}</h3>
            <p className="settings-section-description">{t('Размер шрифта и вид переписки.')}</p>
          </div>
        </div>
        <label className="slider-setting chat-text-size-setting">
          <span>
            <strong>{t('Размер текста сообщений')}</strong>
            <output>{Math.round(settings.chatTextScale * 100)}%</output>
          </span>
          <input
            aria-label={t('Размер текста сообщений')}
            type="range"
            min="0.85"
            max="1.55"
            step="0.01"
            value={settings.chatTextScale}
            onChange={(event) => onSetting({ chatTextScale: Number(event.target.value) }, false)}
          />
        </label>

        <div className="chat-live-size-preview">{chatPreview}</div>

        <div className="chat-style-setting">
          <strong>{t('Вид сообщений')}</strong>
          <div role="radiogroup" aria-label={t('Вид сообщений')}>
            <button
              type="button"
              role="radio"
              aria-checked={settings.chatMessageStyle === 'bubbles'}
              className={settings.chatMessageStyle === 'bubbles' ? 'active' : ''}
              onClick={() => onSetting({ chatMessageStyle: 'bubbles' }, false)}
            >
              <MessageCircle size={20} aria-hidden="true" />
              {t('Пузырьки')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={settings.chatMessageStyle === 'compact'}
              className={settings.chatMessageStyle === 'compact' ? 'active' : ''}
              onClick={() => onSetting({ chatMessageStyle: 'compact' }, false)}
            >
              <AlignLeft size={20} aria-hidden="true" />
              {t('Компактно')}
            </button>
          </div>
        </div>
      </div>
      <div className="chat-settings-group">
        <div className="video-section-heading">
          <span className="profile-zone-icon">
            <ImagePlus />
          </span>
          <div>
            <h3>{t('Фон и предпросмотр')}</h3>
            <p className="settings-section-description">
              {t('Посмотрите, как будут выглядеть ваши чаты.')}
            </p>
          </div>
        </div>
        <div className="chat-wallpaper-setting">
          <div>
            <strong>{t('Обои всех чатов')}</strong>
            <small>{t('Исходные пропорции и качество сохраняются, если файл уже подходит.')}</small>
            {wallpaperError && <small className="error-text">{wallpaperError}</small>}
          </div>
          <div>
            <label className="secondary compact profile-file-button settings-action-button">
              <ImagePlus size={16} />
              {settings.chatWallpaperDataUrl ? t('Заменить') : t('Выбрать фото')}
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
                <Trash2 size={15} /> {t('Убрать')}
              </button>
            )}
          </div>
        </div>

        {settings.chatWallpaperDataUrl && (
          <div className="chat-style-setting chat-wallpaper-fit-setting">
            <strong>{t('Размер обоев')}</strong>
            <div role="radiogroup" aria-label={t('Размер обоев')}>
              <button
                type="button"
                role="radio"
                aria-checked={settings.chatWallpaperFit === 'cover'}
                className={settings.chatWallpaperFit === 'cover' ? 'active' : ''}
                onClick={() => onSetting({ chatWallpaperFit: 'cover' }, false)}
              >
                {t('Заполнить чат')}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={settings.chatWallpaperFit === 'contain'}
                className={settings.chatWallpaperFit === 'contain' ? 'active' : ''}
                onClick={() => onSetting({ chatWallpaperFit: 'contain' }, false)}
              >
                {t('Показать целиком')}
              </button>
            </div>
          </div>
        )}

        <div className="chat-settings-preview-card">
          {chatPreview}
          <div>
            <strong>{t('Предпросмотр')}</strong>
            <small>
              {t('Обои не двигаются вместе с сообщениями и продолжаются под панелью ввода.')}
            </small>
          </div>
        </div>
      </div>
      <div className="chat-wallpaper-setting chat-cache-card">
        <div>
          <strong>{t('Кэш изображений')}</strong>
          <small>
            {formatCacheSize(cacheBytes)} · {cacheEntries}{' '}
            {t(
              'файлов. Кэш ускоряет повторное открытие фотографий и хранится только на этом устройстве.',
            )}
          </small>
        </div>
        <button
          type="button"
          className="secondary compact settings-action-button"
          disabled={cacheBusy || cacheEntries === 0}
          onClick={() => void clearCache()}
        >
          <Trash2 size={15} />
          {cacheBusy ? t('Очищаем…') : t('Очистить кэш')}
        </button>
      </div>
    </section>
  );
}

function formatCacheSize(bytes: number) {
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} МБ`;
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
      <span>{label}</span>
      <ChevronRight className="mobile-settings-chevron" aria-hidden="true" />
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

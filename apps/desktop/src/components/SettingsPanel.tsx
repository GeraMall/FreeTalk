import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowLeft,
  AudioLines,
  Ban,
  Camera,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Crown,
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
import type { LocalSettings } from '../lib/settings';
import {
  prepareAvatar,
  prepareChatWallpaper,
  prepareCover,
  remainingProfileChanges,
} from '../lib/profile';
import { autostartSupported, getAutostartEnabled, setAutostartEnabled } from '../lib/autostart';
import type { UpdateStatus } from '../lib/updater';
import { accountClient, type AccountSession, type AccountUser } from '../lib/api-client';
import {
  createCameraEffectCapture,
  imageFileToCameraBackground,
  type CameraEffectCapture,
} from '../lib/camera-background';
import { cameraConstraints } from '../lib/video-manager';
import { NOTIFICATION_SOUND_URL } from '../lib/notification-sounds';
import {
  chooseRecordingDirectory,
  defaultRecordingDirectory,
  openRecordingDirectory,
  recordingStorageAvailable,
} from '../lib/recording-storage';
import { BrandLogo } from './BrandLogo';
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
import { FullProfileView, type UserProfileData } from './UserProfileDialog';

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
        aria-label="Настройки"
      >
        <aside className="settings-sidebar">
          <div className="settings-sidebar-brand">
            <BrandLogo variant="compact" />
          </div>
          <div className="settings-sidebar-title">
            <span>Настройки</span>
            {mobileLayout && (
              <button
                className="icon-button quiet"
                aria-label="Закрыть настройки"
                onClick={requestClose}
              >
                <X size={21} />
              </button>
            )}
          </div>
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
              label="Видео и звуки"
              onClick={() => setTab('video')}
            />
            <TabButton
              active={tab === 'devices'}
              icon={<MonitorSpeaker />}
              label="Устройства"
              onClick={() => setTab('devices')}
            />
            <TabButton
              active={tab === 'recording'}
              icon={<CircleDot />}
              label="Запись"
              onClick={() => setTab('recording')}
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
          <button className="reset-settings" onClick={() => setConfirmReset(true)}>
            <RotateCcw size={16} /> Сбросить настройки
          </button>
        </aside>

        {(!mobileLayout || tab) && (
          <div className="settings-workspace">
            <header className="settings-header">
              {mobileLayout && (
                <button
                  className="icon-button quiet mobile-settings-back"
                  aria-label="Вернуться к разделам настроек"
                  onClick={() => setTab(null)}
                >
                  <ArrowLeft size={21} />
                </button>
              )}
              <div>
                <p className="eyebrow">
                  {tab === 'audio'
                    ? 'АУДИО'
                    : tab === 'profile'
                      ? 'ПРОФИЛЬ'
                      : tab === 'video'
                        ? 'ВИДЕО И ЗВУКИ'
                        : tab === 'devices'
                          ? 'УСТРОЙСТВА'
                          : tab === 'recording'
                            ? 'ЗАПИСЬ'
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
                        ? 'Видео и звуки'
                        : tab === 'devices'
                          ? 'Аудиоустройства'
                          : tab === 'recording'
                            ? 'Локальная запись'
                            : tab === 'chats'
                              ? 'Оформление чатов'
                              : 'О приложении'}
                </h2>
              </div>
              <button
                className="icon-button quiet"
                aria-label="Закрыть настройки"
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
                  Готово
                </button>
              </footer>
            )}
          </div>
        )}
      </section>
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
                <p className="eyebrow">НЕСОХРАНЁННЫЕ ИЗМЕНЕНИЯ</p>
                <h2 id="profile-confirm-title">Сохранить изменения?</h2>
              </div>
              <button
                className="icon-button quiet"
                aria-label="Отмена"
                onClick={() => setConfirmProfileClose(false)}
              >
                <X />
              </button>
            </header>
            <p>Изменения профиля ещё не применены. Выберите, что с ними сделать.</p>
            {profileSaveError ? <small className="inline-error">{profileSaveError}</small> : null}
            <footer>
              <button
                className="primary"
                disabled={profileSaving}
                onClick={() => void saveProfileDraft(true)}
              >
                {profileSaving ? 'Сохраняем…' : 'Сохранить и выйти'}
              </button>
              <button className="secondary" disabled={profileSaving} onClick={onClose}>
                Выйти без сохранения
              </button>
              <button
                className="quiet"
                disabled={profileSaving}
                onClick={() => setConfirmProfileClose(false)}
              >
                Отмена
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
                <p className="eyebrow">СБРОС НАСТРОЕК</p>
                <h2 id="reset-confirm-title">Сбросить настройки?</h2>
              </div>
            </header>
            <p>Настройки звука, видео, записи и оформления вернутся к значениям по умолчанию.</p>
            <footer>
              <button
                className="danger"
                onClick={() => {
                  setConfirmReset(false);
                  onReset();
                }}
              >
                Сбросить
              </button>
              <button className="secondary" onClick={() => setConfirmReset(false)}>
                Отмена
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function deviceCountWord(count: number) {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'устройств';
  if (last === 1) return 'устройство';
  if (last >= 2 && last <= 4) return 'устройства';
  return 'устройств';
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
  const client = /FreeTalk/i.test(userAgent) || nativeCurrent ? 'FreeTalk' : 'FreeTalk Web';
  return `${client} · ${sessionDevicePlatform(userAgent)}`;
}

function uniqueDeviceSessions(sessions: AccountSession[]) {
  const devices = new Map<string, AccountSession>();
  for (const session of sessions) {
    const key = sessionDevicePlatform(session.userAgent).toLocaleLowerCase('ru-RU');
    const current = devices.get(key);
    if (
      !current ||
      session.current ||
      (!current.current &&
        new Date(session.lastActiveAt).getTime() > new Date(current.lastActiveAt).getTime())
    ) {
      devices.set(key, session);
    }
  }
  return [...devices.values()].sort((first, second) => {
    if (first.current !== second.current) return first.current ? -1 : 1;
    return new Date(second.lastActiveAt).getTime() - new Date(first.lastActiveAt).getTime();
  });
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
  const [securityMessage, setSecurityMessage] = useState('');
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState(false);
  const connectedDevices = useMemo(() => uniqueDeviceSessions(sessions), [sessions]);
  const remaining = remainingProfileChanges(settings.profileChangeTimestamps);
  const usernameValid = isValidUsername(draft.username);
  const profileIdentityChanged =
    draft.displayName.trim() !== savedDraft.displayName ||
    draft.avatar !== savedDraft.avatar ||
    draft.username !== savedDraft.username ||
    draft.bio !== savedDraft.bio ||
    draft.cover !== savedDraft.cover;
  const previewProfile: UserProfileData | undefined = accountUser
    ? {
        id: accountUser.id,
        username: draft.username,
        displayName: draft.displayName.trim() || 'Ваше имя',
        bio: draft.bio.trim() || null,
        avatarUrl: draft.avatar || null,
        coverUrl: draft.cover || null,
        registeredAt: accountUser.registeredAt,
        presence: 'online',
        relationship: 'self',
        mutualFriendsCount: 0,
        mutualFriends: [],
        commonChatsCount: 0,
        commonChats: [],
        sharedCalls: { count: 0, lastStartedAt: null, lastDurationSeconds: null },
      }
    : undefined;

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
        if (active) setSessions(result.sessions);
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
        <div className="profile-redesign">
          <section className="profile-zone profile-account-zone">
            <header className="profile-zone-heading">
              <span className="profile-zone-icon">
                <ShieldCheck />
              </span>
              <span>
                <small>АККАУНТ</small>
                <h3>Контактные данные</h3>
              </span>
            </header>
            <div className="profile-account-grid">
              <article>
                <Mail />
                <span>
                  <small>Почта</small>
                  <strong>{maskedEmail(accountUser.email)}</strong>
                  <em>Подтверждена</em>
                </span>
              </article>
              <article>
                <Phone />
                <span>
                  <small>Телефон</small>
                  <strong>Не привязан</strong>
                  <em>Поддержка появится позже</em>
                </span>
                <button
                  className="secondary compact"
                  disabled
                  title="Серверная привязка телефона пока не поддерживается"
                >
                  Привязать
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
                <small>ПРОФИЛЬ</small>
                <h3>Внешний вид и имя</h3>
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
                    <ImagePlus /> {draft.cover ? 'Заменить обложку' : 'Добавить обложку'}
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
                      <Trash2 /> Удалить
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="profile-media-avatar">
                {cachedDraftAvatar ? (
                  <img src={cachedDraftAvatar} alt="Предпросмотр аватара" />
                ) : (
                  <span>{draft.displayName.trim().charAt(0).toUpperCase() || '?'}</span>
                )}
                <label className="profile-avatar-overlay" aria-label="Изменить аватар">
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
                <small>{draft.username ? `@${draft.username}` : 'Добавьте username'}</small>
                {draft.avatar ? (
                  <button className="quiet" onClick={() => onDraft({ avatar: '' })}>
                    Удалить аватар
                  </button>
                ) : null}
              </div>
            </div>
            <p className="profile-media-help">
              Аватар: JPEG, PNG или WebP до 25 МБ, до 768×768. Обложка: до 25 МБ, FreeTalk
              подготовит изображение 1800×700.
            </p>
            <div className="profile-fields-grid">
              <label className="field-label">
                Отображаемое имя
                <input
                  maxLength={32}
                  value={draft.displayName}
                  placeholder="Ваше имя"
                  onChange={(event) => onDraft({ displayName: event.target.value })}
                />
                <small>{draft.displayName.length}/32</small>
              </label>
              <label className="field-label">
                Уникальный @username
                <input
                  minLength={USERNAME_MIN_LENGTH}
                  maxLength={USERNAME_MAX_LENGTH}
                  pattern="[a-z0-9_]{5,24}"
                  aria-invalid={!usernameValid}
                  value={draft.username}
                  onChange={(event) => onDraft({ username: normalizeUsername(event.target.value) })}
                />
                <small>5–24 символа: латиница, цифры и _. Изменение раз в 30 дней.</small>
              </label>
              <label className="field-label profile-bio-field">
                О себе
                <textarea
                  value={draft.bio}
                  maxLength={200}
                  rows={4}
                  placeholder="Несколько слов о себе"
                  onChange={(event) => onDraft({ bio: event.target.value })}
                />
                <small>{draft.bio.length}/200</small>
              </label>
            </div>
            <div className="profile-limit">
              <span>
                {remaining > 0
                  ? `Осталось изменений: ${remaining} из 5`
                  : 'Лимит изменений исчерпан'}
              </span>
              <small>Имя и аватар вместе можно сохранять не более пяти раз за пять часов.</small>
            </div>
          </section>

          <section className="profile-zone profile-card-design">
            <div className="profile-card-design-heading">
              <span>
                <strong>Оформление карточки в звонке</strong>
                <small>Этот выбор применится вместе с остальными изменениями профиля.</small>
              </span>
              <Sparkles aria-hidden="true" />
            </div>
            <div
              className={`profile-card-preview participant-card audio-tile ${draft.participantCardStyle === 'avatar-glass' && cachedDraftAvatar ? 'avatar-glass' : ''}`}
            >
              {draft.participantCardStyle === 'avatar-glass' && cachedDraftAvatar ? (
                <span className="participant-card-ambient" aria-hidden="true">
                  <img src={cachedDraftAvatar} alt="" />
                </span>
              ) : null}
              <div className="participant-card-top media-overlay-top">
                <span className="creator-badge">
                  <Crown size={13} /> Создатель комнаты
                </span>
              </div>
              <div className="participant-avatar" data-variant="1">
                {cachedDraftAvatar ? (
                  <img src={cachedDraftAvatar} alt="" />
                ) : (
                  <span>{draft.displayName.trim().charAt(0).toUpperCase() || '?'}</span>
                )}
                <i aria-label="В сети" />
              </div>
              <div className="participant-info">
                <div className="participant-name-row">
                  <div className="participant-name">
                    <strong>{draft.displayName.trim() || 'Ваше имя'}</strong>
                    <span>вы</span>
                  </div>
                </div>
                <div className="participant-status">
                  <i /> Слушает
                </div>
              </div>
            </div>
            <div
              className="profile-card-style-options"
              role="radiogroup"
              aria-label="Оформление карточки в звонке"
            >
              <button
                type="button"
                role="radio"
                aria-checked={draft.participantCardStyle === 'classic'}
                className={draft.participantCardStyle === 'classic' ? 'active' : ''}
                onClick={() => onDraft({ participantCardStyle: 'classic' })}
              >
                <strong>Классическая</strong>
                <small>Спокойный фирменный фон FreeTalk</small>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={draft.participantCardStyle === 'avatar-glass'}
                className={draft.participantCardStyle === 'avatar-glass' ? 'active' : ''}
                disabled={!cachedDraftAvatar}
                onClick={() => onDraft({ participantCardStyle: 'avatar-glass' })}
              >
                <strong>Жидкое стекло</strong>
                <small>
                  {cachedDraftAvatar ? 'Оттенки выбранной аватарки' : 'Сначала выберите аватарку'}
                </small>
              </button>
            </div>
          </section>

          <section className="profile-zone profile-full-preview-zone">
            <header className="profile-zone-heading">
              <span className="profile-zone-icon">
                <UserRound />
              </span>
              <span>
                <small>ПРЕДПРОСМОТР</small>
                <h3>Так выглядит ваш полный профиль</h3>
              </span>
            </header>
            {previewProfile ? (
              <div className="profile-full-preview-frame">
                <FullProfileView
                  viewerId={accountUser.id}
                  target={{
                    id: accountUser.id,
                    displayName: previewProfile.displayName,
                    username: previewProfile.username,
                    avatarUrl: previewProfile.avatarUrl,
                    presence: 'online',
                    relationship: 'self',
                  }}
                  profile={previewProfile}
                  preview
                />
              </div>
            ) : null}
          </section>

          <section className="profile-zone profile-security-zone">
            <header className="profile-zone-heading">
              <span className="profile-zone-icon">
                <ShieldCheck />
              </span>
              <span>
                <small>БЕЗОПАСНОСТЬ</small>
                <h3>Доступ к аккаунту</h3>
              </span>
            </header>
            <details className="connected-devices profile-accordion">
              <summary>
                <span className="connected-devices-icon">
                  <Laptop />
                </span>
                <span>
                  <strong>Подключённые устройства</strong>
                  <small>
                    {sessionsLoading
                      ? 'Проверяем активные сеансы…'
                      : sessionsError
                        ? 'Не удалось получить список'
                        : `${connectedDevices.length} ${deviceCountWord(connectedDevices.length)}`}
                  </small>
                </span>
                {!sessionsLoading && !sessionsError && <b>{connectedDevices.length}</b>}
                <ChevronDown className="connected-devices-chevron" />
              </summary>
              <div className="connected-device-list">
                {sessionsError ? (
                  <p>Не удалось загрузить информацию об устройствах.</p>
                ) : connectedDevices.length === 0 && !sessionsLoading ? (
                  <p>Активных устройств нет.</p>
                ) : (
                  connectedDevices.map((session) => (
                    <article key={session.id}>
                      <Laptop />
                      <span>
                        <strong>{sessionDeviceName(session.userAgent, session.current)}</strong>
                        <small>
                          Активность: {new Date(session.lastActiveAt).toLocaleString('ru-RU')}
                        </small>
                        <small>
                          Подключено: {new Date(session.createdAt).toLocaleDateString('ru-RU')}
                        </small>
                      </span>
                      {session.current && <em>Это устройство</em>}
                    </article>
                  ))
                )}
              </div>
            </details>
            <details className="profile-accordion">
              <summary>
                <span className="connected-devices-icon">
                  <ShieldCheck />
                </span>
                <span>
                  <strong>Изменить пароль</strong>
                  <small>Обновите пароль от аккаунта</small>
                </span>
                <ChevronDown className="connected-devices-chevron" />
              </summary>
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
                    onDraftError('');
                    setSecurityMessage('');
                    void onChangePassword(currentPassword, newPassword)
                      .then(() => {
                        setCurrentPassword('');
                        setNewPassword('');
                        setSecurityMessage('Пароль успешно изменён.');
                      })
                      .catch((caught: unknown) =>
                        onDraftError(
                          caught instanceof Error ? caught.message : 'Не удалось изменить пароль',
                        ),
                      );
                  }}
                >
                  Изменить пароль
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
                <small>ДЕЙСТВИЯ</small>
                <h3>Управление аккаунтом</h3>
              </span>
            </header>
            <div className="profile-account-actions-grid">
              <button className="secondary" onClick={onAccountLogout}>
                <LogOut />{' '}
                <span>
                  <strong>Выйти из аккаунта</strong>
                  <small>Завершить текущий сеанс</small>
                </span>
              </button>
              <details className="danger-zone profile-accordion">
                <summary>
                  <span>
                    <strong>Удалить аккаунт</strong>
                    <small>Безвозвратно удалить личные данные</small>
                  </span>
                  <ChevronDown />
                </summary>
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
                    onDraftError('');
                    void onDeleteAccount(deletePassword).catch((caught: unknown) =>
                      onDraftError(
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
          {saveError ? (
            <div className="profile-save-error" role="alert">
              {saveError}
            </div>
          ) : null}
        </div>
      </div>
      <footer className="profile-sticky-actions single-action">
        <span>
          {profileIdentityChanged && remaining === 0
            ? 'Лимит изменений профиля исчерпан'
            : 'Все изменения применяются одновременно'}
        </span>
        <button
          className="primary profile-done"
          disabled={isSaving || !usernameValid || (profileIdentityChanged && remaining === 0)}
          onClick={onDone}
        >
          {isSaving ? 'Сохраняем…' : 'Готово'}
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
        <CameraSettingsEditor
          settings={settings}
          cameras={cameras}
          onCamera={onCamera}
          onVideoSetting={onVideoSetting}
        />
      </section>

      <section className="settings-section video-settings-section sound-settings-section">
        <div className="section-title-row">
          <div>
            <h3>Звуки событий</h3>
            <p className="settings-section-description">
              Каждый звук можно отключить отдельно и предварительно прослушать.
            </p>
          </div>
        </div>
        <div className="sound-setting-list">
          <SoundSetting
            label="Участник подключился"
            checked={settings.participantJoinedSound}
            onChange={(value) => onVideoSetting({ participantJoinedSound: value })}
            onPreview={() => void playSettingsSound(NOTIFICATION_SOUND_URL, settings)}
          />
          <SoundSetting
            label="Участник отключился"
            checked={settings.participantDisconnectedSound}
            onChange={(value) => onVideoSetting({ participantDisconnectedSound: value })}
            onPreview={() => void playSettingsSound(NOTIFICATION_SOUND_URL, settings)}
          />
          <SoundSetting
            label="Начало записи"
            checked={settings.recordingStartSound}
            onChange={(value) => onVideoSetting({ recordingStartSound: value })}
            onPreview={() => void playSettingsSound(NOTIFICATION_SOUND_URL, settings)}
          />
        </div>
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
            Тип содержимого
            <select
              value={settings.screenContentMode}
              onChange={(event) =>
                onVideoSetting({
                  screenContentMode: event.target.value as LocalSettings['screenContentMode'],
                })
              }
            >
              <option value="text">Текст · максимальная чёткость</option>
              <option value="balanced">Универсальный · чётко и плавно</option>
              <option value="video">Видео · плавное движение</option>
            </select>
            <small>«Текст» бережёт детали, универсальный режим балансирует их с движением.</small>
          </label>
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
            <small>Задаёт верхнюю границу детализации передаваемого изображения.</small>
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
            <small>Определяет плавность движения при достаточной скорости сети.</small>
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
            description="Подстраивает FPS, разрешение и битрейт под сеть с учётом выбранного типа содержимого."
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
        {previewing && <video ref={videoRef} muted playsInline />}
        {!previewing && (
          <button type="button" className="primary" onClick={() => setPreviewing(true)}>
            <Camera /> Проверить видео
          </button>
        )}
        {previewBusy && <span>Подготавливаем камеру…</span>}
        {previewError && <span className="camera-preview-error">{previewError}</span>}
        {previewing && (
          <button
            type="button"
            className="settings-camera-preview-stop"
            onClick={() => setPreviewing(false)}
          >
            Остановить предпросмотр
          </button>
        )}
      </div>
      <Toggle
        label="Предпросмотр видео (всегда)"
        description="Показывать окно подготовки каждый раз перед включением камеры."
        checked={settings.cameraPreviewAlways}
        onChange={(value) => onVideoSetting({ cameraPreviewAlways: value })}
      />
      <label className="field-label">
        Камера
        <select value={settings.cameraDeviceId} onChange={(event) => onCamera(event.target.value)}>
          <option value="">Системная камера</option>
          {cameras.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Камера ${index + 1}`}
            </option>
          ))}
        </select>
      </label>
      <div className="settings-camera-backgrounds">
        <strong>Фон видео</strong>
        <div>
          <button
            type="button"
            className={settings.cameraBackgroundMode === 'none' ? 'selected' : ''}
            onClick={() => onVideoSetting({ cameraBackgroundMode: 'none' })}
          >
            <Ban />
            <span>Пусто</span>
          </button>
          <button
            type="button"
            className={`blur${settings.cameraBackgroundMode === 'blur' ? ' selected' : ''}`}
            onClick={() => onVideoSetting({ cameraBackgroundMode: 'blur' })}
          >
            <Sparkles />
            <span>Размытие</span>
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
            <span>Свой фон</span>
          </button>
        </div>
        <button
          type="button"
          className="secondary compact"
          onClick={() => fileRef.current?.click()}
        >
          <ImagePlus />{' '}
          {settings.cameraBackgroundDataUrl ? 'Заменить свой фон' : 'Выбрать свой фон'}
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
        <button type="button" onClick={onPreview}>
          Прослушать звук
        </button>
      </span>
      <label className="toggle-control">
        <input
          type="checkbox"
          role="switch"
          aria-label={label}
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <i />
      </label>
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

  const directory = settings.recordingDirectory || defaultDirectory || 'Видео/FreeTalk';
  useEffect(() => {
    if (!directory || directory === 'Видео/FreeTalk') return;
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
        <div className="section-title-row">
          <div>
            <h3>Локальное хранилище записей</h3>
            <p>Видео сохраняется только на этом компьютере и не загружается на сервер.</p>
          </div>
          <CircleDot size={22} />
        </div>
        <div className="recording-directory-row">
          <div className="recording-directory-value" title={directory}>
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
            Открыть
          </button>
          <button className="secondary compact" onClick={() => void changeDirectory()}>
            Изменить
          </button>
        </div>
        {error && <small className="field-error">{error}</small>}
        {availableBytes !== undefined && (
          <small className="recording-space-available">
            Свободно {formatStorageSize(availableBytes)}
          </small>
        )}
        <Toggle
          label="Выбирать папку после каждой конференции"
          description="Перед началом каждой записи FreeTalk спросит, куда сохранить видео."
          checked={settings.recordingAskDirectory}
          onChange={(value) => onSetting({ recordingAskDirectory: value }, false)}
        />
      </section>

      <section className="settings-section recording-options-section">
        <h3>Настройки записи</h3>
        <p className="settings-section-description">
          Запись создаётся в WebM или MP4 с высоким битрейтом и исходным разрешением выбранного
          экрана.
        </p>
        <div className="video-toggle-list">
          <Toggle
            label="Показывать имена участников"
            description="Добавляет имена участников комнаты в нижнюю часть записи."
            checked={settings.recordingShowParticipantNames}
            onChange={(value) => onSetting({ recordingShowParticipantNames: value }, false)}
          />
          <Toggle
            label="Добавить временную метку"
            description="Показывает локальные дату и время в правом верхнем углу записи."
            checked={settings.recordingAddTimestamp}
            onChange={(value) => onSetting({ recordingAddTimestamp: value }, false)}
          />
          <Toggle
            label="Записывать видео при демонстрации экрана"
            description="Использует уже выбранную демонстрацию без повторного запроса экрана."
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

  return (
    <section className="settings-section chat-settings-section">
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
          <small>Исходные пропорции и качество сохраняются, если файл уже подходит.</small>
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

      {settings.chatWallpaperDataUrl && (
        <div className="chat-style-setting chat-wallpaper-fit-setting">
          <strong>Размер обоев</strong>
          <div role="radiogroup" aria-label="Размер обоев">
            <button
              type="button"
              role="radio"
              aria-checked={settings.chatWallpaperFit === 'cover'}
              className={settings.chatWallpaperFit === 'cover' ? 'active' : ''}
              onClick={() => onSetting({ chatWallpaperFit: 'cover' }, false)}
            >
              Заполнить чат
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={settings.chatWallpaperFit === 'contain'}
              className={settings.chatWallpaperFit === 'contain' ? 'active' : ''}
              onClick={() => onSetting({ chatWallpaperFit: 'contain' }, false)}
            >
              Показать целиком
            </button>
          </div>
        </div>
      )}

      <div className="chat-settings-preview-card">
        <div
          className={`chat-settings-preview ${settings.chatMessageStyle}`}
          aria-label="Предпросмотр оформления чата"
          style={
            {
              '--preview-text-scale': settings.chatTextScale,
              backgroundImage: settings.chatWallpaperDataUrl
                ? `linear-gradient(rgba(1, 10, 20, 0.6), rgba(1, 10, 20, 0.6)), url("${settings.chatWallpaperDataUrl}")`
                : undefined,
              backgroundSize: settings.chatWallpaperDataUrl
                ? `100% 100%, ${settings.chatWallpaperFit}`
                : undefined,
            } as CSSProperties
          }
        >
          <div className="preview-message remote">Привет! Как тебе оформление?</div>
          <div className="preview-message own">Отлично, так намного удобнее.</div>
          <div className="preview-composer">Написать сообщение…</div>
        </div>
        <div>
          <strong>Предпросмотр</strong>
          <small>Обои не двигаются вместе с сообщениями и продолжаются под панелью ввода.</small>
        </div>
      </div>

      <div className="chat-wallpaper-setting">
        <div>
          <strong>Кэш изображений</strong>
          <small>
            {formatCacheSize(cacheBytes)} · {cacheEntries} файлов. Кэш ускоряет повторное открытие
            фотографий и хранится только на этом устройстве.
          </small>
        </div>
        <button
          type="button"
          className="secondary compact settings-action-button"
          disabled={cacheBusy || cacheEntries === 0}
          onClick={() => void clearCache()}
        >
          <Trash2 size={15} /> {cacheBusy ? 'Очищаем…' : 'Очистить кэш'}
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

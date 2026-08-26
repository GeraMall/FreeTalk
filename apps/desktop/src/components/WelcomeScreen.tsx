import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Clock3,
  Download,
  FileText,
  LogIn,
  MailCheck,
  RefreshCw,
  Settings,
  ShieldCheck,
  UserRound,
  UserPlus,
  X,
} from 'lucide-react';
import type { UpdateStatus } from '../lib/updater';
import {
  isValidUsername,
  normalizeUsername,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from '../lib/username';
import { AuroraBackground } from './AuroraBackground';
import { BrandLogo } from './BrandLogo';
import { CaptchaBox } from './CaptchaBox';

interface RegistrationInput {
  email: string;
  username: string;
  displayName: string;
  password: string;
  acceptedTerms: true;
  acceptedPrivacy: true;
  captchaToken?: string;
}

const LEGAL_DOCUMENTS = {
  terms: {
    title: 'Пользовательское соглашение FreeTalk',
    paragraphs: [
      'Проект находится на стадии закрытого beta-тестирования. Перед публичным production-релизом документ должен быть проверен владельцем продукта и юристом применимой юрисдикции.',
      'FreeTalk предоставляет средства голосовой и видеосвязи, демонстрации экрана и временного обмена сообщениями. Пользователь обязан соблюдать применимое законодательство, не злоупотреблять сервисом и не пытаться обходить ограничения безопасности.',
      'Сервис предоставляется без гарантии абсолютной доступности. Содержимое разговоров не записывается сервером FreeTalk.',
    ],
  },
  privacy: {
    title: 'Политика конфиденциальности FreeTalk',
    paragraphs: [
      'Проект находится на стадии закрытого beta-тестирования. Документ не является обещанием защиты от любых юридических рисков.',
      'Для работы аккаунта обрабатываются email, username, отображаемое имя, аватар, данные сессий и безопасности, друзья, членство в чатах и история факта звонков. Текст сообщений удаляется после установленного срока.',
      'Аудио, видео и содержимое экрана не передаются account API и не используются для аналитики. Пароли хранятся только как Argon2id-хеш, а токены сессий — только в виде серверного SHA-256-хеша с секретным pepper.',
    ],
  },
} as const;

interface WelcomeScreenProps {
  error: string;
  busy: boolean;
  captchaRequired: boolean;
  updateStatus: UpdateStatus;
  savedDisplayName: string;
  initialRoomCode?: string;
  onLogin(login: string, password: string, captchaToken?: string): void;
  onRegister(input: RegistrationInput): Promise<boolean>;
  onResendVerification(email: string): Promise<boolean>;
  onVerifyEmail(email: string, code: string): Promise<boolean>;
  onGuestJoin(roomInput: string, captchaToken: string): void;
  onForgotPassword(email: string): void;
  onResetPassword(token: string, password: string): void;
  onSettings(): void;
}

export function WelcomeScreen({
  error,
  busy,
  captchaRequired,
  updateStatus,
  savedDisplayName,
  initialRoomCode,
  onLogin,
  onRegister,
  onResendVerification,
  onVerifyEmail,
  onGuestJoin,
  onForgotPassword,
  onResetPassword,
  onSettings,
}: WelcomeScreenProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [login, setLogin] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [displayName, setDisplayName] = useState(savedDisplayName);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [guestRoom, setGuestRoom] = useState('');
  const [guestCaptcha, setGuestCaptcha] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [verificationEmail, setVerificationEmail] = useState<string>();
  const [verificationDeadline, setVerificationDeadline] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [resetMode, setResetMode] = useState(false);
  const [resetToken, setResetToken] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [openLegal, setOpenLegal] = useState<keyof typeof LEGAL_DOCUMENTS>();

  useEffect(() => {
    if (!verificationEmail) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [verificationEmail]);

  useEffect(() => {
    if (initialRoomCode) setGuestRoom(initialRoomCode);
  }, [initialRoomCode]);

  const remainingSeconds = Math.max(0, Math.ceil((verificationDeadline - now) / 1_000));
  const verificationTime = `${Math.floor(remainingSeconds / 60)
    .toString()
    .padStart(2, '0')}:${(remainingSeconds % 60).toString().padStart(2, '0')}`;
  const usernameValid = isValidUsername(username);

  const updateUsername = (rawValue: string) => {
    const candidate = rawValue.replace(/^@/, '').toLowerCase();
    const normalized = normalizeUsername(rawValue);
    setUsername(normalized);
    if (/[^a-z0-9_]/.test(candidate)) {
      setUsernameError('Допустимы только a–z, 0–9 и _.');
    } else if (candidate.length > USERNAME_MAX_LENGTH) {
      setUsernameError(`Не больше ${USERNAME_MAX_LENGTH} символов.`);
    } else if (normalized.length > 0 && normalized.length < USERNAME_MIN_LENGTH) {
      setUsernameError(`Минимум ${USERNAME_MIN_LENGTH} символов.`);
    } else {
      setUsernameError('');
    }
  };

  const submit = async () => {
    if (mode === 'login') return onLogin(login, password, captchaToken || undefined);
    if (!usernameValid || password !== confirmation || !terms || !privacy) return;
    const registered = await onRegister({
      email,
      username,
      displayName,
      password,
      acceptedTerms: true,
      acceptedPrivacy: true,
      captchaToken: captchaToken || undefined,
    });
    if (registered) {
      setVerificationEmail(email.trim().toLowerCase());
      setVerificationDeadline(Date.now() + 30 * 60_000);
      setNow(Date.now());
      setVerificationToken('');
    }
  };

  const resendVerification = async () => {
    if (!verificationEmail || !(await onResendVerification(verificationEmail))) return;
    setVerificationDeadline(Date.now() + 30 * 60_000);
    setNow(Date.now());
    setVerificationToken('');
  };

  return (
    <main className="welcome-shell account-welcome">
      <AuroraBackground />
      <div className="welcome-topbar">
        <BrandLogo variant="compact" />
        <button className="icon-button quiet" aria-label="Открыть настройки" onClick={onSettings}>
          <Settings size={21} />
        </button>
      </div>
      <section className="welcome-card account-card" aria-labelledby="welcome-title">
        <div className="auth-brand">
          <BrandLogo />
          <h1 id="welcome-title" className="visually-hidden">
            FreeTalk
          </h1>
          <p className="eyebrow">СТАБИЛЬНАЯ СВЯЗЬ И РАБОТА БЕЗ VPN!</p>
        </div>
        {updateStatus.kind === 'available' && (
          <button className="update-banner" onClick={onSettings}>
            <Download size={16} /> Доступна версия {updateStatus.version}
          </button>
        )}
        {verificationEmail ? (
          <div className="verification-step" aria-labelledby="verification-title">
            <div className="verification-icon" aria-hidden="true">
              <MailCheck size={34} />
            </div>
            <p className="verification-kicker">ПОЧТИ ГОТОВО</p>
            <h2 id="verification-title">Подтвердите почту</h2>
            <p className="verification-copy">
              Мы отправили шестизначный код на <strong>{verificationEmail}</strong>
            </p>
            <div className={`verification-timer ${remainingSeconds === 0 ? 'expired' : ''}`}>
              <Clock3 size={17} />
              {remainingSeconds > 0 ? `Код действует ещё ${verificationTime}` : 'Срок кода истёк'}
            </div>
            <label className="verification-code-label">
              Код из письма
              <input
                autoFocus
                className="verification-code-input"
                value={verificationToken}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                onChange={(event) =>
                  setVerificationToken(event.target.value.replace(/\D/g, '').slice(0, 6))
                }
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !busy &&
                    remainingSeconds > 0 &&
                    verificationToken.length === 6
                  )
                    void onVerifyEmail(verificationEmail, verificationToken);
                }}
              />
            </label>
            <button
              className="primary wide verification-submit"
              disabled={busy || verificationToken.length !== 6 || remainingSeconds === 0}
              onClick={() => void onVerifyEmail(verificationEmail, verificationToken)}
            >
              <MailCheck size={18} /> {busy ? 'Проверяем…' : 'Подтвердить и войти'}
            </button>
            <button
              className="text-action verification-resend"
              disabled={busy}
              onClick={() => void resendVerification()}
            >
              <RefreshCw size={15} /> Отправить новый код
            </button>
            <button
              className="text-action verification-back"
              disabled={busy}
              onClick={() => {
                setVerificationEmail(undefined);
                setVerificationToken('');
              }}
            >
              <ArrowLeft size={15} /> Изменить данные регистрации
            </button>
          </div>
        ) : (
          <>
            <div
              className={`auth-switch auth-switch-${mode}`}
              role="tablist"
              aria-label="Режим входа"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'login'}
                className={mode === 'login' ? 'active' : ''}
                onClick={() => setMode('login')}
              >
                Войти
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                className={mode === 'register' ? 'active' : ''}
                onClick={() => setMode('register')}
              >
                Регистрация
              </button>
            </div>

            <div className={`auth-form auth-form-${mode}`} key={mode}>
              {mode === 'login' ? (
                <>
                  {resetMode ? (
                    <>
                      <label className="field-label">
                        Код из письма
                        <input
                          autoFocus
                          value={resetToken}
                          onChange={(event) => setResetToken(event.target.value)}
                        />
                      </label>
                      <label className="field-label">
                        Новый пароль
                        <input
                          type="password"
                          value={resetPassword}
                          autoComplete="new-password"
                          onChange={(event) => setResetPassword(event.target.value)}
                        />
                      </label>
                      <button
                        className="primary wide"
                        disabled={busy || !resetToken || !resetPassword}
                        onClick={() => onResetPassword(resetToken, resetPassword)}
                      >
                        Сохранить новый пароль
                      </button>
                      <button className="text-action" onClick={() => setResetMode(false)}>
                        Вернуться ко входу
                      </button>
                    </>
                  ) : (
                    <>
                      <label className="field-label">
                        Почта или @username
                        <input
                          autoFocus
                          value={login}
                          disabled={busy}
                          autoComplete="username"
                          onChange={(event) => setLogin(event.target.value)}
                        />
                      </label>
                      <label className="field-label">
                        Пароль
                        <input
                          type="password"
                          value={password}
                          disabled={busy}
                          autoComplete="current-password"
                          onChange={(event) => setPassword(event.target.value)}
                          onKeyDown={(event) => event.key === 'Enter' && submit()}
                        />
                      </label>
                      {captchaRequired && <CaptchaBox onToken={setCaptchaToken} />}
                      <button
                        className="primary wide"
                        disabled={busy || !login || !password || (captchaRequired && !captchaToken)}
                        onClick={submit}
                      >
                        <LogIn size={18} /> {busy ? 'Входим…' : 'Войти'}
                      </button>
                      <button
                        className="text-action"
                        disabled={!login.includes('@')}
                        onClick={() => onForgotPassword(login)}
                      >
                        Забыли пароль?
                      </button>
                      <button className="text-action" onClick={() => setResetMode(true)}>
                        У меня есть код сброса
                      </button>
                    </>
                  )}
                </>
              ) : (
                <>
                  <div className="registration-intro">
                    <span aria-hidden="true">
                      <UserPlus size={21} />
                    </span>
                    <div>
                      <h2>Создайте аккаунт</h2>
                      <p>Один профиль для друзей, звонков и истории общения.</p>
                    </div>
                  </div>
                  <div className="auth-grid">
                    <label className="field-label">
                      Почта
                      <input
                        value={email}
                        type="email"
                        placeholder="name@example.com"
                        autoComplete="email"
                        onChange={(event) => setEmail(event.target.value)}
                      />
                    </label>
                    <label className="field-label">
                      Уникальный @username
                      <input
                        value={username}
                        placeholder="username"
                        autoComplete="username"
                        minLength={USERNAME_MIN_LENGTH}
                        maxLength={USERNAME_MAX_LENGTH}
                        pattern="[a-z0-9_]{5,24}"
                        aria-invalid={Boolean(usernameError)}
                        onChange={(event) => updateUsername(event.target.value)}
                      />
                    </label>
                  </div>
                  {usernameError && (
                    <small className="validation-error username-validation-error">
                      {usernameError}
                    </small>
                  )}
                  <label className="field-label">
                    Отображаемое имя
                    <input
                      value={displayName}
                      placeholder="Как вас увидят другие"
                      maxLength={48}
                      onChange={(event) => setDisplayName(event.target.value)}
                    />
                  </label>
                  <div className="auth-grid">
                    <label className="field-label">
                      Пароль
                      <input
                        type="password"
                        value={password}
                        autoComplete="new-password"
                        onChange={(event) => setPassword(event.target.value)}
                      />
                    </label>
                    <label className="field-label">
                      Повторите пароль
                      <input
                        type="password"
                        value={confirmation}
                        aria-invalid={Boolean(
                          password && confirmation && password !== confirmation,
                        )}
                        autoComplete="new-password"
                        onChange={(event) => setConfirmation(event.target.value)}
                      />
                    </label>
                  </div>
                  {password && confirmation && password !== confirmation && (
                    <small className="validation-error">Пароли не совпадают</small>
                  )}
                  <div className="registration-legal">
                    <div className="legal-check-row">
                      <label className="legal-check">
                        <input
                          type="checkbox"
                          checked={terms}
                          aria-label="Я принимаю Пользовательское соглашение"
                          onChange={(event) => setTerms(event.target.checked)}
                        />
                        <span>Я принимаю</span>
                      </label>
                      <button
                        type="button"
                        className="legal-document-link"
                        aria-expanded={openLegal === 'terms'}
                        onClick={() => setOpenLegal(openLegal === 'terms' ? undefined : 'terms')}
                      >
                        Пользовательское соглашение
                      </button>
                    </div>
                    <div className="legal-check-row">
                      <label className="legal-check">
                        <input
                          type="checkbox"
                          checked={privacy}
                          aria-label="Я принимаю Политику конфиденциальности"
                          onChange={(event) => setPrivacy(event.target.checked)}
                        />
                        <span>Я принимаю</span>
                      </label>
                      <button
                        type="button"
                        className="legal-document-link"
                        aria-expanded={openLegal === 'privacy'}
                        onClick={() =>
                          setOpenLegal(openLegal === 'privacy' ? undefined : 'privacy')
                        }
                      >
                        Политику конфиденциальности
                      </button>
                    </div>
                  </div>
                  {openLegal && (
                    <section
                      className="legal-document-panel"
                      aria-label={LEGAL_DOCUMENTS[openLegal].title}
                    >
                      <header>
                        <span>
                          <FileText size={17} />
                        </span>
                        <div>
                          <strong>{LEGAL_DOCUMENTS[openLegal].title}</strong>
                          <small>Версия от 25 августа 2026 года</small>
                        </div>
                        <button
                          type="button"
                          className="icon-button quiet"
                          aria-label="Закрыть документ"
                          onClick={() => setOpenLegal(undefined)}
                        >
                          <X size={17} />
                        </button>
                      </header>
                      <div>
                        {LEGAL_DOCUMENTS[openLegal].paragraphs.map((paragraph) => (
                          <p key={paragraph}>{paragraph}</p>
                        ))}
                      </div>
                    </section>
                  )}
                  {captchaRequired && <CaptchaBox onToken={setCaptchaToken} />}
                  <button
                    className="primary wide"
                    disabled={
                      busy ||
                      !email ||
                      !usernameValid ||
                      !displayName ||
                      !password ||
                      password !== confirmation ||
                      !terms ||
                      !privacy
                    }
                    onClick={submit}
                  >
                    <UserPlus size={18} /> {busy ? 'Создаём…' : 'Создать аккаунт'}
                  </button>
                  <p className="registration-security">
                    <ShieldCheck size={14} /> После регистрации подтвердите почту кодом из письма
                  </p>
                </>
              )}
            </div>

            {mode === 'login' && (
              <>
                <div className="divider">
                  <span>или войдите как гость</span>
                </div>
                <div className="guest-join">
                  <div className="join-row">
                    <input
                      aria-label="Код или ссылка комнаты"
                      value={guestRoom}
                      placeholder="Код или ссылка комнаты"
                      onChange={(event) => setGuestRoom(event.target.value)}
                    />
                    <button
                      disabled={busy || !guestRoom || !guestCaptcha}
                      onClick={() => onGuestJoin(guestRoom, guestCaptcha)}
                    >
                      Войти
                    </button>
                  </div>
                  <CaptchaBox onToken={setGuestCaptcha} />
                </div>
              </>
            )}
          </>
        )}
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        {!verificationEmail && mode === 'login' && (
          <div className="auth-info-stack">
            <div className="auth-info-row">
              <UserRound size={18} />
              <span>
                <strong>Гостевой режим</strong>
                До 5 входов в сутки и до 30 минут за звонок. Камера, экран, друзья и история
                недоступны.
              </span>
            </div>
            <div className="auth-info-row privacy-note">
              <ShieldCheck size={18} />
              <span>
                <strong>Приватная связь</strong>
                Разговоры идут через WebRTC. API не получает аудио, видео или содержимое экрана.
              </span>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

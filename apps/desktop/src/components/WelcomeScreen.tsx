import { BirthDateFields, RequiredMark } from './BirthDateFields';
import { QrLoginSection } from './QrLoginDialog';
import type { AccountUser } from '../lib/api-client';
import { LanguagePicker } from './LanguagePicker';
import {
  REGISTRATION_LEGAL_VERSION,
  registrationLegalDocuments as LEGAL_DOCUMENTS,
} from '@freetalk/protocol';
import { t } from '../lib/app-language';
import { useEffect, useState, type KeyboardEventHandler } from 'react';
import {
  ArrowLeft,
  Clock3,
  Download,
  Eye,
  EyeOff,
  FileText,
  LogIn,
  MailCheck,
  RefreshCw,
  Settings,
  ShieldCheck,
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
  birthDate: string;
  password: string;
  acceptedTerms: true;
  acceptedPrivacy: true;
  legalVersion: typeof REGISTRATION_LEGAL_VERSION;
  captchaToken?: string;
}

interface WelcomeScreenProps {
  error: string;
  busy: boolean;
  captchaRequired: boolean;
  updateStatus: UpdateStatus;
  onQrLogin?(user: AccountUser): Promise<void>;
  onLogin(login: string, password: string, captchaToken?: string): void;
  onRegister(input: RegistrationInput): Promise<boolean>;
  onResendVerification(email: string): Promise<boolean>;
  onVerifyEmail(email: string, code: string): Promise<boolean>;
  onForgotPassword(email: string): void;
  onResetPassword(token: string, password: string, email: string): void;
  onSettings(): void;
}

function PasswordField({
  id,
  label,
  value,
  autoComplete,
  disabled = false,
  invalid = false,
  hint,
  onChange,
  onKeyDown,
}: {
  id: string;
  label: string;
  value: string;
  autoComplete: 'current-password' | 'new-password';
  disabled?: boolean;
  invalid?: boolean;
  hint?: string;
  onChange(value: string): void;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}) {
  const [visible, setVisible] = useState(false);
  const action = t(visible ? 'Скрыть пароль' : 'Показать пароль');
  return (
    <div className="field-label">
      <label htmlFor={id}>
        {label} <RequiredMark />
      </label>
      <div className="password-field">
        <input
          id={id}
          aria-required="true"
          className="password-entry"
          data-tooltip={hint}
          type={visible ? 'text' : 'password'}
          value={value}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          autoComplete={autoComplete}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="password-visibility-toggle"
          aria-label={action}
          data-tooltip={action}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff size={19} /> : <Eye size={19} />}
        </button>
      </div>
    </div>
  );
}

export function WelcomeScreen({
  error,
  busy,
  captchaRequired,
  updateStatus,
  onLogin,
  onQrLogin,
  onRegister,
  onResendVerification,
  onVerifyEmail,
  onForgotPassword,
  onResetPassword,
  onSettings,
}: WelcomeScreenProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [login, setLogin] = useState('');
  const [showLoginError, setShowLoginError] = useState(false);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [birthDate, setBirthDate] = useState('');
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

  const remainingSeconds = Math.max(0, Math.ceil((verificationDeadline - now) / 1_000));
  const verificationTime = `${Math.floor(remainingSeconds / 60)
    .toString()
    .padStart(2, '0')}:${(remainingSeconds % 60).toString().padStart(2, '0')}`;
  const usernameValid = isValidUsername(username);
  const loginFieldsMissing = !login.trim() || !password;
  const passwordsMismatch = Boolean(password && confirmation && password !== confirmation);

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
    if (busy) return;
    if (mode === 'login') {
      if (loginFieldsMissing) {
        setShowLoginError(true);
        return;
      }
      if (captchaRequired && !captchaToken) return;
      return onLogin(login, password, captchaToken || undefined);
    }
    if (!birthDate || !usernameValid || password !== confirmation || !terms || !privacy) return;
    const registered = await onRegister({
      email,
      username,
      displayName,
      birthDate,
      password,
      acceptedTerms: true,
      acceptedPrivacy: true,
      legalVersion: REGISTRATION_LEGAL_VERSION,
      captchaToken: captchaToken || undefined,
    });
    if (registered) {
      setBirthDate('');
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
        <div className="welcome-topbar-actions">
          <LanguagePicker compact />
          <button
            className="icon-button quiet"
            aria-label={t('Открыть настройки')}
            onClick={onSettings}
          >
            <Settings size={21} />
          </button>
        </div>
      </div>
      <section className="welcome-card account-card" aria-labelledby="welcome-title">
        <div className="auth-brand">
          <BrandLogo />
          <h1 id="welcome-title" className="visually-hidden">
            Trlka
          </h1>
          <p className="eyebrow">{t('СТАБИЛЬНАЯ СВЯЗЬ И РАБОТА БЕЗ VPN!')}</p>
        </div>
        {updateStatus.kind === 'available' && (
          <button className="update-banner" onClick={onSettings}>
            <Download size={16} /> {t('Доступна версия')} {updateStatus.version}
          </button>
        )}
        {verificationEmail ? (
          <div className="verification-step" aria-labelledby="verification-title">
            <div className="verification-icon" aria-hidden="true">
              <MailCheck size={34} />
            </div>
            <p className="verification-kicker">{t('ПОЧТИ ГОТОВО')}</p>
            <h2 id="verification-title">{t('Подтвердите почту')}</h2>
            <p className="verification-copy">
              {t('Мы отправили шестизначный код на')} <strong>{verificationEmail}</strong>
            </p>
            <div className={`verification-timer ${remainingSeconds === 0 ? 'expired' : ''}`}>
              <Clock3 size={17} />
              {remainingSeconds > 0
                ? t('Код действует ещё {p0}', { p0: verificationTime })
                : t('Срок кода истёк')}
            </div>
            <label className="verification-code-label">
              {t('Код из письма')}
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
              <MailCheck size={18} />
              {busy ? t('Проверяем…') : t('Подтвердить и войти')}
            </button>
            <button
              className="text-action verification-resend"
              disabled={busy}
              onClick={() => void resendVerification()}
            >
              <RefreshCw size={15} /> {t('Отправить новый код')}
            </button>
            <button
              className="text-action verification-back"
              disabled={busy}
              onClick={() => {
                setVerificationEmail(undefined);
                setVerificationToken('');
              }}
            >
              <ArrowLeft size={15} /> {t('Изменить данные регистрации')}
            </button>
          </div>
        ) : (
          <>
            <div
              className={`auth-switch auth-switch-${mode}`}
              role="tablist"
              aria-label={t('Режим входа')}
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'login'}
                className={mode === 'login' ? 'active' : ''}
                onClick={() => {
                  setBirthDate('');
                  setMode('login');
                }}
              >
                {t('Войти')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                className={mode === 'register' ? 'active' : ''}
                onClick={() => {
                  setShowLoginError(false);
                  setMode('register');
                }}
              >
                {t('Регистрация')}
              </button>
            </div>

            <div
              className={`auth-form auth-form-${mode}`}
              key={mode}
              data-tooltip-below={mode === 'register' ? '' : undefined}
              data-tooltip-suspended={
                error || (mode === 'register' && (usernameError || passwordsMismatch))
                  ? ''
                  : undefined
              }
            >
              {mode === 'login' ? (
                <>
                  {resetMode ? (
                    <>
                      <label className="field-label">
                        {t('Почта аккаунта')}
                        <input
                          type="email"
                          value={login}
                          autoComplete="email"
                          disabled={busy}
                          onChange={(event) => setLogin(event.target.value)}
                        />
                      </label>
                      <label className="field-label">
                        {t('Код из письма')}
                        <input
                          autoFocus
                          value={resetToken}
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          placeholder="000000"
                          onChange={(event) =>
                            setResetToken(event.target.value.replace(/\D/g, '').slice(0, 6))
                          }
                        />
                      </label>
                      <PasswordField
                        id="reset-password"
                        label={t('Новый пароль')}
                        value={resetPassword}
                        autoComplete="new-password"
                        onChange={setResetPassword}
                      />
                      <button
                        className="primary wide"
                        disabled={
                          busy ||
                          !/^\d{6}$/.test(resetToken) ||
                          !resetPassword ||
                          !login.includes('@')
                        }
                        onClick={() => onResetPassword(resetToken, resetPassword, login)}
                      >
                        {t('Сохранить новый пароль')}
                      </button>
                      <button className="text-action" onClick={() => setResetMode(false)}>
                        {t('Вернуться ко входу')}
                      </button>
                    </>
                  ) : (
                    <>
                      <label className="field-label">
                        <span>
                          {t('Почта или @username')} <RequiredMark />
                        </span>
                        <input
                          aria-required="true"
                          autoFocus
                          value={login}
                          disabled={busy}
                          autoComplete="username"
                          onChange={(event) => setLogin(event.target.value)}
                          onKeyDown={(event) => event.key === 'Enter' && submit()}
                        />
                      </label>
                      <PasswordField
                        id="login-password"
                        label={t('Пароль')}
                        value={password}
                        disabled={busy}
                        autoComplete="current-password"
                        onChange={setPassword}
                        onKeyDown={(event) => event.key === 'Enter' && submit()}
                      />
                      {captchaRequired && <CaptchaBox onToken={setCaptchaToken} />}
                      <button
                        className="primary wide"
                        disabled={busy || loginFieldsMissing || (captchaRequired && !captchaToken)}
                        onClick={submit}
                      >
                        <LogIn size={18} />
                        {busy ? t('Входим…') : t('Войти')}
                      </button>
                      {showLoginError && loginFieldsMissing && (
                        <div className="alert error" role="alert">
                          {t('Проверьте введённые данные.')}
                        </div>
                      )}
                      <div className="auth-recovery">
                        {' '}
                        <button
                          className="text-action"
                          disabled={!login.includes('@')}
                          onClick={() => onForgotPassword(login)}
                        >
                          {t('Забыли пароль?')}
                        </button>
                        <button className="text-action" onClick={() => setResetMode(true)}>
                          {t('У меня есть код сброса')}
                        </button>
                      </div>
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
                      <h2>{t('Создайте аккаунт')}</h2>
                      <p>{t('Один профиль для друзей, звонков и истории общения.')}</p>
                    </div>
                  </div>
                  <div className="auth-grid">
                    <label className="field-label">
                      <span>
                        {t('Почта')} <RequiredMark />
                      </span>
                      <input
                        aria-required="true"
                        value={email}
                        type="email"
                        placeholder="name@example.com"
                        autoComplete="email"
                        onChange={(event) => setEmail(event.target.value)}
                      />
                    </label>
                    <label className="field-label">
                      <span>
                        {t('Уникальный @username')} <RequiredMark />
                      </span>
                      <input
                        aria-required="true"
                        value={username}
                        placeholder="username"
                        autoComplete="username"
                        minLength={USERNAME_MIN_LENGTH}
                        maxLength={USERNAME_MAX_LENGTH}
                        data-tooltip={t(
                          'От 5 до 24 символов: латинские буквы, цифры и подчёркивание.',
                        )}
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
                    {t('Отображаемое имя')}
                    <input
                      autoComplete="off"
                      data-tooltip={t('Если оставить поле пустым, будет использован @username.')}
                      value={displayName}
                      placeholder={t('Как вас увидят другие')}
                      maxLength={48}
                      onChange={(event) => setDisplayName(event.target.value)}
                    />
                  </label>
                  <div className="auth-grid">
                    <PasswordField
                      id="registration-password"
                      hint={t('От 10 символов, хотя бы одна буква и цифра.')}
                      label={t('Пароль')}
                      value={password}
                      autoComplete="new-password"
                      onChange={setPassword}
                    />
                    <PasswordField
                      id="registration-password-confirmation"
                      hint={t('Введите тот же пароль ещё раз.')}
                      label={t('Повторите пароль')}
                      value={confirmation}
                      invalid={passwordsMismatch}
                      autoComplete="new-password"
                      onChange={setConfirmation}
                    />
                  </div>
                  {passwordsMismatch && (
                    <small className="validation-error">{t('Пароли не совпадают')}</small>
                  )}
                  <BirthDateFields onChange={setBirthDate} />
                  <div className="registration-legal">
                    <div className="legal-check-row">
                      <label className="legal-check">
                        <input
                          type="checkbox"
                          aria-required="true"
                          checked={terms}
                          aria-label={t('Я принимаю Пользовательское соглашение')}
                          onChange={(event) => setTerms(event.target.checked)}
                        />
                        <span>{t('Я принимаю')}</span>
                      </label>
                      <button
                        type="button"
                        className="legal-document-link"
                        aria-expanded={openLegal === 'terms'}
                        onClick={() => setOpenLegal(openLegal === 'terms' ? undefined : 'terms')}
                      >
                        {t('Пользовательское соглашение')} <RequiredMark />
                      </button>
                    </div>
                    <div className="legal-check-row">
                      <label className="legal-check">
                        <input
                          type="checkbox"
                          aria-required="true"
                          checked={privacy}
                          aria-label={t('Я ознакомился с политикой конфиденциальности')}
                          onChange={(event) => setPrivacy(event.target.checked)}
                        />
                        <span>{t('Я ознакомился с')}</span>
                      </label>
                      <button
                        type="button"
                        className="legal-document-link"
                        aria-expanded={openLegal === 'privacy'}
                        onClick={() =>
                          setOpenLegal(openLegal === 'privacy' ? undefined : 'privacy')
                        }
                      >
                        {t('политикой конфиденциальности')} <RequiredMark />
                      </button>
                    </div>
                  </div>
                  {openLegal && (
                    <section
                      className="legal-document-panel"
                      aria-label={t(LEGAL_DOCUMENTS[openLegal].title)}
                    >
                      <header>
                        <span>
                          <FileText size={17} />
                        </span>
                        <div>
                          <strong>{t(LEGAL_DOCUMENTS[openLegal].title)}</strong>
                          <small>{REGISTRATION_LEGAL_VERSION}</small>
                        </div>
                        <button
                          type="button"
                          className="icon-button quiet"
                          aria-label={t('Закрыть документ')}
                          onClick={() => setOpenLegal(undefined)}
                        >
                          <X size={17} />
                        </button>
                      </header>
                      <div>
                        {LEGAL_DOCUMENTS[openLegal].paragraphs.map((paragraph) => (
                          <p key={t(paragraph)}>{t(paragraph)}</p>
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
                      !birthDate ||
                      !password ||
                      password !== confirmation ||
                      !terms ||
                      !privacy
                    }
                    onClick={submit}
                  >
                    <UserPlus size={18} />
                    {busy ? t('Создаём…') : t('Создать аккаунт')}
                  </button>
                  <p className="registration-security">
                    <ShieldCheck size={14} />{' '}
                    {t('После регистрации подтвердите почту кодом из письма')}
                  </p>
                </>
              )}
            </div>
          </>
        )}
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        {!verificationEmail && mode === 'login' && !resetMode && onQrLogin && (
          <QrLoginSection onLogin={onQrLogin} />
        )}
      </section>
    </main>
  );
}

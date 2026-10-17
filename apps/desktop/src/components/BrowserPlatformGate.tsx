import {
  ArrowLeft,
  Eye,
  EyeOff,
  KeyRound,
  LogIn,
  MailCheck,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import brandMark from '../assets/freetalk-mascot.png';
import { accountClient } from '../lib/api-client';
import { normalizeUsername } from '../lib/username';
import { CaptchaBox } from './CaptchaBox';

function isTauri() {
  return '__TAURI_INTERNALS__' in window;
}

function isMobileBrowser() {
  const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  );
  return mobileUserAgent;
}

export function BrowserPlatformGate({ children }: { children: ReactNode }) {
  const native = isTauri();
  const [mobile] = useState(() => !native && isMobileBrowser());
  const [state, setState] = useState<'checking' | 'locked' | 'allowed'>(() =>
    native || !isMobileBrowser() ? 'allowed' : 'checking',
  );
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [key, setKey] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [verificationEmail, setVerificationEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [resetMode, setResetMode] = useState(false);
  const [resetCode, setResetCode] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!mobile) return;
    let disposed = false;
    void accountClient.restore().then((user) => {
      if (!disposed) setState(user ? 'allowed' : 'locked');
    });
    return () => {
      disposed = true;
    };
  }, [mobile]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('browser-client-document', !native && !mobile);
    root.classList.toggle('browser-mobile-client-document', mobile && state === 'allowed');
    return () => {
      root.classList.remove('browser-client-document', 'browser-mobile-client-document');
    };
  }, [mobile, native, state]);

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await accountClient.mobileBetaLogin(login, password, key.trim() || undefined);
      setState('allowed');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось войти в мобильную бету');
    } finally {
      setBusy(false);
    }
  };

  const submitRegistration = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const normalizedEmail = email.trim().toLowerCase();
      await accountClient.register({
        email: normalizedEmail,
        username: normalizeUsername(username),
        displayName: displayName.trim(),
        password,
        acceptedTerms: true,
        acceptedPrivacy: true,
        captchaToken: captchaToken || undefined,
      });
      setVerificationEmail(normalizedEmail);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось создать аккаунт');
    } finally {
      setBusy(false);
    }
  };

  const verifyRegistration = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await accountClient.verifyEmail(verificationEmail, verificationCode);
      await accountClient.mobileBetaLogin(verificationEmail, password, key.trim());
      setState('allowed');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось подтвердить регистрацию');
    } finally {
      setBusy(false);
    }
  };

  const sendResetCode = async () => {
    setBusy(true);
    setError('');
    try {
      await accountClient.forgotPassword(login);
      setResetSent(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось отправить код');
    } finally {
      setBusy(false);
    }
  };

  const submitPasswordReset = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await accountClient.resetPassword(resetCode, resetPassword, login);
      setPassword(resetPassword);
      setResetMode(false);
      setResetSent(false);
      setResetCode('');
      setResetPassword('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось изменить пароль');
    } finally {
      setBusy(false);
    }
  };

  if (state === 'allowed') return children;

  return (
    <main className="browser-platform-gate">
      <section className="browser-platform-card" aria-labelledby="browser-platform-title">
        <img src={brandMark} alt="" className="browser-platform-logo" />
        <p className="browser-platform-kicker">Закрытая мобильная бета</p>
        <h1 id="browser-platform-title">Trlka на телефоне</h1>
        {state === 'checking' ? (
          <p className="browser-platform-status">Проверяем доступ этого аккаунта…</p>
        ) : (
          <>
            <div className="browser-platform-auth-switch" role="tablist" aria-label="Авторизация">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'login'}
                className={mode === 'login' ? 'active' : ''}
                onClick={() => {
                  setMode('login');
                  setResetMode(false);
                  setError('');
                }}
              >
                Войти
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                className={mode === 'register' ? 'active' : ''}
                onClick={() => {
                  setMode('register');
                  setResetMode(false);
                  setError('');
                }}
              >
                Регистрация
              </button>
            </div>
            {mode === 'login' && !resetMode ? (
              <form className="browser-platform-form" onSubmit={submitLogin}>
                <label>
                  Почта или @username
                  <input
                    autoFocus
                    value={login}
                    autoComplete="username"
                    disabled={busy}
                    onChange={(event) => setLogin(event.target.value)}
                  />
                </label>
                <div className="browser-platform-password-field">
                  <label htmlFor="mobile-beta-password">Пароль</label>
                  <div className="browser-platform-password">
                    <input
                      id="mobile-beta-password"
                      type={passwordVisible ? 'text' : 'password'}
                      value={password}
                      autoComplete="current-password"
                      disabled={busy}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <button
                      type="button"
                      aria-label={passwordVisible ? 'Скрыть пароль' : 'Показать пароль'}
                      title={passwordVisible ? 'Скрыть пароль' : 'Показать пароль'}
                      onClick={() => setPasswordVisible((current) => !current)}
                    >
                      {passwordVisible ? <EyeOff size={19} /> : <Eye size={19} />}
                    </button>
                  </div>
                </div>
                <label>
                  Ключ мобильной беты
                  <span>Не нужен, если доступ уже привязан к аккаунту</span>
                  <div className="browser-platform-key-input">
                    <KeyRound size={18} aria-hidden="true" />
                    <input
                      value={key}
                      autoCapitalize="characters"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="TRLKA-XXXX-XXXX-XXXX-XXXX"
                      disabled={busy}
                      onChange={(event) => setKey(event.target.value.toUpperCase().slice(0, 32))}
                    />
                  </div>
                </label>
                <button type="submit" disabled={busy || !login || !password}>
                  <LogIn size={18} /> {busy ? 'Проверяем…' : 'Войти'}
                </button>
                <button
                  type="button"
                  className="browser-platform-text-action"
                  onClick={() => {
                    setResetMode(true);
                    setError('');
                  }}
                >
                  Забыли пароль?
                </button>
              </form>
            ) : mode === 'login' ? (
              <form className="browser-platform-form" onSubmit={submitPasswordReset}>
                <label>
                  Почта аккаунта
                  <input
                    type="email"
                    value={login}
                    autoComplete="email"
                    disabled={busy || resetSent}
                    onChange={(event) => setLogin(event.target.value)}
                  />
                </label>
                {resetSent ? (
                  <>
                    <label>
                      Шестизначный код из письма
                      <input
                        value={resetCode}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        placeholder="000000"
                        onChange={(event) =>
                          setResetCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                        }
                      />
                    </label>
                    <label>
                      Новый пароль
                      <input
                        type="password"
                        value={resetPassword}
                        autoComplete="new-password"
                        onChange={(event) => setResetPassword(event.target.value)}
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={busy || resetCode.length !== 6 || !resetPassword}
                    >
                      Сохранить новый пароль
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={busy || !login.includes('@')}
                    onClick={sendResetCode}
                  >
                    <MailCheck size={18} /> {busy ? 'Отправляем…' : 'Получить код'}
                  </button>
                )}
                <button
                  type="button"
                  className="browser-platform-text-action"
                  onClick={() => {
                    setResetMode(false);
                    setResetSent(false);
                    setError('');
                  }}
                >
                  <ArrowLeft size={15} /> Вернуться ко входу
                </button>
              </form>
            ) : verificationEmail ? (
              <form className="browser-platform-form" onSubmit={verifyRegistration}>
                <p className="browser-platform-verification-copy">
                  Мы отправили шестизначный код на <strong>{verificationEmail}</strong>
                </p>
                <label>
                  Код подтверждения
                  <input
                    autoFocus
                    value={verificationCode}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="000000"
                    onChange={(event) =>
                      setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                    }
                  />
                </label>
                <button type="submit" disabled={busy || verificationCode.length !== 6}>
                  <MailCheck size={18} /> {busy ? 'Проверяем…' : 'Подтвердить и войти'}
                </button>
              </form>
            ) : (
              <form className="browser-platform-form" onSubmit={submitRegistration}>
                <label>
                  Почта
                  <input
                    type="email"
                    value={email}
                    autoComplete="email"
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
                <label>
                  Уникальный @username
                  <input
                    value={username}
                    autoComplete="username"
                    placeholder="username"
                    onChange={(event) => setUsername(normalizeUsername(event.target.value))}
                  />
                </label>
                <label>
                  Отображаемое имя
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </label>
                <label>
                  Пароль
                  <input
                    type="password"
                    value={password}
                    autoComplete="new-password"
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
                <label>
                  Ключ мобильной беты
                  <div className="browser-platform-key-input">
                    <KeyRound size={18} aria-hidden="true" />
                    <input
                      value={key}
                      autoCapitalize="characters"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="TRLKA-XXXX-XXXX-XXXX-XXXX"
                      onChange={(event) => setKey(event.target.value.toUpperCase().slice(0, 32))}
                    />
                  </div>
                </label>
                <CaptchaBox onToken={setCaptchaToken} />
                <label className="browser-platform-consent">
                  <input
                    type="checkbox"
                    checked={accepted}
                    onChange={(event) => setAccepted(event.target.checked)}
                  />
                  <span>Принимаю пользовательское соглашение и политику конфиденциальности</span>
                </label>
                <button
                  type="submit"
                  disabled={
                    busy ||
                    !email.includes('@') ||
                    username.length < 5 ||
                    !displayName.trim() ||
                    !password ||
                    !key.trim() ||
                    !accepted
                  }
                >
                  <UserPlus size={18} /> {busy ? 'Создаём…' : 'Зарегистрироваться'}
                </button>
              </form>
            )}
            {error && (
              <div className="browser-platform-error" role="alert">
                {error}
              </div>
            )}
            <div className="browser-platform-note">
              <ShieldCheck size={18} aria-hidden="true" />
              <span>
                Один ключ активирует один аккаунт. После этого можно входить с других телефонов.
              </span>
            </div>
          </>
        )}
        <a href="/">Вернуться на сайт</a>
      </section>
    </main>
  );
}

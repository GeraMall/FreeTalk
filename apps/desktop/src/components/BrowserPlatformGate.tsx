import { KeyRound, LogIn, ShieldCheck } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import brandMark from '../assets/freetalk-mascot.png';
import { accountClient } from '../lib/api-client';

const MIN_DESKTOP_WIDTH = 900;

function isTauri() {
  return '__TAURI_INTERNALS__' in window;
}

function isMobileBrowser() {
  const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  );
  return mobileUserAgent || window.innerWidth < MIN_DESKTOP_WIDTH;
}

export function BrowserPlatformGate({ children }: { children: ReactNode }) {
  const native = isTauri();
  const [mobile] = useState(() => !native && isMobileBrowser());
  const [state, setState] = useState<'checking' | 'locked' | 'allowed'>(() =>
    native || !isMobileBrowser() ? 'allowed' : 'checking',
  );
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [key, setKey] = useState('');
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

  const submit = async (event: FormEvent) => {
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
            <p>
              Войдите в аккаунт. Если это первый мобильный вход, добавьте одноразовый ключ — он
              навсегда привяжет доступ к вашему аккаунту.
            </p>
            <form className="browser-platform-form" onSubmit={submit}>
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
              <label>
                Пароль
                <input
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  disabled={busy}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
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
              {error && (
                <div className="browser-platform-error" role="alert">
                  {error}
                </div>
              )}
              <button type="submit" disabled={busy || !login || !password}>
                <LogIn size={18} /> {busy ? 'Проверяем…' : 'Войти'}
              </button>
            </form>
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

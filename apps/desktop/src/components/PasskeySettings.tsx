import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { accountClient } from '../lib/api-client';
import { appLanguage, t } from '../lib/app-language';
import { openPasskeyBrowser, signInWithPasskey } from '../lib/passkeys';
import { AuroraBackground } from './AuroraBackground';
import { BrandLogo } from './BrandLogo';

export function PasskeyDesktopApproval({ challenge }: { challenge: string }) {
  const [status, setStatus] = useState<'ready' | 'busy' | 'failed' | 'approved'>('ready');

  async function approve() {
    setStatus('busy');
    try {
      await signInWithPasskey(challenge);
      setStatus('approved');
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch {
      setStatus('failed');
    }
  }

  return (
    <main className="welcome-shell account-welcome">
      <AuroraBackground />
      <section className="welcome-card account-card passkey-approval">
        <BrandLogo />
        <h1>{t('Вход с помощью ключа доступа')}</h1>
        {status === 'approved' ? (
          <p role="status">{t('Вход подтверждён. Вернитесь в приложение TRLKA.')}</p>
        ) : (
          <>
            <p>{t('Подтверждайте вход, только если вы сами открыли его в приложении TRLKA.')}</p>
            <p>
              {t('Сверьте код с приложением')}{' '}
              <strong className="qr-auth-match">{challenge.slice(0, 5).toUpperCase()}</strong>
            </p>
            <button
              className="primary wide"
              type="button"
              disabled={status === 'busy'}
              onClick={() => void approve()}
            >
              <KeyRound size={18} /> {t('Подтвердить вход')}
            </button>
            {status === 'failed' && (
              <p role="alert">{t('Не удалось войти с помощью ключа доступа.')}</p>
            )}
          </>
        )}
      </section>
    </main>
  );
}

export function PasskeySettings() {
  const native = '__TAURI_INTERNALS__' in window;
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [keys, setKeys] = useState<{ id: string; createdAt: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!open || native) return;
    let active = true;
    void accountClient
      .listPasskeys()
      .then(({ keys }) => {
        if (active) {
          setKeys(keys);
          setReady(true);
        }
      })
      .catch(() => {
        if (active) setMessage(t('Не удалось загрузить ключи доступа.'));
      });
    return () => {
      active = false;
    };
  }, [native, open]);

  async function create() {
    if (busy || !ready || !password) return;
    setBusy(true);
    setMessage('');
    const currentPassword = password;
    setPassword('');
    try {
      const { startRegistration } = await import('@simplewebauthn/browser');
      const { state, options } = await accountClient.startPasskeyRegistration(currentPassword);
      const response = await startRegistration({ optionsJSON: options });
      await accountClient.finishPasskeyRegistration(state, response);
      setKeys((await accountClient.listPasskeys()).keys);
      setMessage(t('Ключ доступа добавлен.'));
    } catch (error) {
      setMessage(
        error instanceof Error && 'code' in error && error.code === 'INVALID_PASSWORD'
          ? t('Неверный пароль')
          : t('Не удалось добавить ключ доступа.'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setMessage('');
    try {
      await accountClient.deletePasskey(id);
      setKeys((current) => current.filter((key) => key.id !== id));
      setMessage(t('Ключ доступа удалён.'));
    } catch {
      setMessage(t('Не удалось удалить ключ доступа.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details
      className="passkey-settings"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        if (!event.currentTarget.open) setPassword('');
      }}
    >
      <summary>
        <KeyRound size={17} /> {t('Ключи доступа')}
      </summary>
      {native ? (
        <div>
          <p>{t('Чтобы добавить ключ, войдите на trlka.com и откройте настройки профиля.')}</p>
          <button
            type="button"
            onClick={() =>
              void openPasskeyBrowser().catch(() => {
                setMessage(t('Откройте trlka.com в браузере.'));
              })
            }
          >
            {t('Открыть TRLKA в браузере')}
          </button>
        </div>
      ) : (
        <div>
          {keys.map((key) => (
            <div className="passkey-setting-row" key={key.id}>
              <span>
                {t('Ключ доступа')} ·{' '}
                {new Intl.DateTimeFormat(appLanguage(), {
                  dateStyle: 'short',
                  timeStyle: 'short',
                }).format(new Date(key.createdAt))}
              </span>
              <button type="button" disabled={busy} onClick={() => void remove(key.id)}>
                {t('Удалить')}
              </button>
            </div>
          ))}
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              aria-label={t('Текущий пароль')}
              placeholder={t('Текущий пароль')}
              onChange={(event) => setPassword(event.target.value)}
              aria-required="true"
            />
            <button type="submit" disabled={busy || !ready || !password}>
              {t('Добавить ключ доступа')}
            </button>
          </form>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </details>
  );
}

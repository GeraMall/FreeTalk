import { BellRing, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { browserPushSupported, enableBrowserPush, restoreBrowserPush } from '../lib/browser-push';

export function BrowserNotificationPrompt() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!browserPushSupported()) return;
    if (Notification.permission === 'default') {
      setOpen(true);
      return;
    }
    if (Notification.permission === 'granted') void restoreBrowserPush().catch(() => undefined);
  }, []);

  if (!open) return null;

  return (
    <div className="browser-notification-backdrop">
      <section
        className="browser-notification-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="browser-notification-title"
      >
        <button
          type="button"
          className="browser-notification-close"
          aria-label="Напомнить позже"
          onClick={() => setOpen(false)}
        >
          <X aria-hidden="true" />
        </button>
        <span className="browser-notification-icon" aria-hidden="true">
          <BellRing />
        </span>
        <h2 id="browser-notification-title">Не пропускайте сообщения</h2>
        <p>
          Разрешите уведомления Trlka — новые сообщения будут приходить сразу, даже когда приложение
          свёрнуто.
        </p>
        {error ? <div className="browser-notification-error">{error}</div> : null}
        <button
          type="button"
          className="browser-notification-enable"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError('');
            void enableBrowserPush()
              .then(() => setOpen(false))
              .catch((caught) =>
                setError(
                  caught instanceof Error ? caught.message : 'Не удалось включить уведомления',
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          <BellRing aria-hidden="true" />
          {busy ? 'Подключаем…' : 'Включить уведомления'}
        </button>
        <button type="button" className="browser-notification-later" onClick={() => setOpen(false)}>
          Позже
        </button>
      </section>
    </div>
  );
}

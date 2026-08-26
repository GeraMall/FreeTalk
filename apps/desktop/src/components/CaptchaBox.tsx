import { useEffect, useId, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render(container: HTMLElement, options: Record<string, unknown>): string;
      remove(widgetId: string): void;
    };
  }
}

let scriptPromise: Promise<void> | undefined;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('CAPTCHA недоступна'));
    document.head.append(script);
  });
  return scriptPromise;
}

export function CaptchaBox({ onToken }: { onToken(token: string): void }) {
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

  useEffect(() => {
    if (!siteKey || !container.current) return;
    let disposed = false;
    let widgetId = '';
    void loadTurnstile().then(() => {
      if (disposed || !container.current || !window.turnstile) return;
      widgetId = window.turnstile.render(container.current, {
        sitekey: siteKey,
        theme: 'dark',
        callback: onToken,
        'expired-callback': () => onToken(''),
        'error-callback': () => onToken(''),
      });
    });
    return () => {
      disposed = true;
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [onToken, siteKey]);

  if (!siteKey && import.meta.env.DEV)
    return (
      <button className="captcha-local" type="button" onClick={() => onToken('local-development')}>
        Подтвердить локальную CAPTCHA
      </button>
    );
  return <div id={id} ref={container} className="captcha-box" aria-label="Проверка CAPTCHA" />;
}

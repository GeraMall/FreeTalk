import { type ReactNode, useEffect, useState } from 'react';
import brandMark from '../assets/freetalk-mascot.png';

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
  const [blocked, setBlocked] = useState(() => !isTauri() && isMobileBrowser());

  useEffect(() => {
    if (isTauri()) return;
    const update = () => {
      const nextBlocked = isMobileBrowser();
      setBlocked(nextBlocked);
      document.documentElement.classList.toggle('browser-client-document', !nextBlocked);
    };
    update();
    window.addEventListener('resize', update);
    return () => {
      document.documentElement.classList.remove('browser-client-document');
      window.removeEventListener('resize', update);
    };
  }, []);

  if (!blocked) return children;

  return (
    <main className="browser-platform-gate">
      <section className="browser-platform-card" aria-labelledby="browser-platform-title">
        <img src={brandMark} alt="" className="browser-platform-logo" />
        <p className="browser-platform-kicker">Trlka в браузере</p>
        <h1 id="browser-platform-title">Откройте с компьютера</h1>
        <p>
          Веб-версия Trlka сейчас работает только в браузерах на ПК. Для звонков и демонстрации
          экрана откройте эту страницу на компьютере.
        </p>
        <a href="/">Вернуться на сайт</a>
      </section>
    </main>
  );
}

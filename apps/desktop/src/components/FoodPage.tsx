import { invoke, isTauri } from '@tauri-apps/api/core';
import { ArrowLeft, ArrowUpRight, ChevronDown, Pizza, RotateCw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import glovoLogo from '../assets/food/glovo.png';
import samokatLogo from '../assets/food/samokat.png';
import woltLogo from '../assets/food/wolt.png';
import yandexLogo from '../assets/food/yandex.png';
import { t } from '../lib/app-language';
import vendors from '../lib/food-vendors.json';
import './food-page.css';

const regions = {
  RU: 'Россия',
  KZ: 'Казахстан',
  GB: 'Великобритания',
} as const;

type Region = keyof typeof regions;
type Vendor = (typeof vendors)[number];
type Bounds = { x: number; y: number; width: number; height: number };

const regionKey = 'trlka.food.region';
const introKey = 'trlka.food.intro';
const vendorLogos: Partial<Record<string, string>> = {
  yandex: yandexLogo,
  samokat: samokatLogo,
  wolt: woltLogo,
  glovo: glovoLogo,
};

function readPreference(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function savePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The section remains usable when the browser blocks storage.
  }
}

function isRegion(value: string | null | undefined): value is Region {
  return value != null && Object.hasOwn(regions, value);
}

function defaultRegion(): Region {
  const saved = readPreference(regionKey);
  if (isRegion(saved)) return saved;

  for (const locale of navigator.languages) {
    const preferred = new Intl.Locale(locale);
    if (isRegion(preferred.region)) return preferred.region;
    if (preferred.language === 'kk') return 'KZ';
  }
  return 'RU';
}

// Serialize native view changes, including cleanup after leaving the page.
let viewOperation: Promise<void> = Promise.resolve();

function updateNativeView(
  vendor: string | null,
  bounds: Bounds | null,
  close = false,
  cancelled?: () => boolean,
) {
  const operation = viewOperation.then(async () => {
    if (cancelled?.()) return;
    await invoke('food_vendor_view', { vendor, bounds, close });
  });
  viewOperation = operation.catch(() => undefined);
  return operation;
}

function useNativeVendor(
  stage: RefObject<HTMLDivElement | null>,
  vendor: string | undefined,
  onError: () => void,
) {
  useEffect(() => {
    const element = stage.current;
    if (!vendor || !element) return;

    let frame = 0;
    let disposed = false;
    let previous = '';
    const update = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      const left = Math.max(0, Math.ceil(rect.left));
      const top = Math.max(0, Math.ceil(rect.top));
      const right = Math.min(innerWidth, Math.floor(rect.right));
      const bottom = Math.min(innerHeight, Math.floor(rect.bottom));
      const visible =
        right > left && bottom > top && !document.querySelector('[aria-modal="true"]');
      const bounds = visible
        ? { x: left, y: top, width: right - left, height: bottom - top }
        : null;
      const key = JSON.stringify(bounds);
      if (key === previous) return;
      previous = key;
      void updateNativeView(vendor, bounds, false, () => disposed).catch(() => {
        if (!disposed) onError();
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    const overlays = new MutationObserver(schedule);
    overlays.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    schedule();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      overlays.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      void updateNativeView(null, null).catch(() => undefined);
    };
  }, [vendor, onError, stage]);
}

export function FoodPage({ allowEmbedded, onBack }: { allowEmbedded: boolean; onBack?(): void }) {
  const [region, setRegion] = useState(defaultRegion);
  const [intro, setIntro] = useState(() => readPreference(introKey) !== 'seen');
  const [embeddedVendor, setEmbeddedVendor] = useState<Vendor>();
  const [error, setError] = useState('');
  const [nativeFailed, setNativeFailed] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const native = isTauri();
  const useEmbedded = allowEmbedded && native && /Windows|Macintosh/i.test(navigator.userAgent);
  const catalog = vendors.filter((vendor) => vendor.region === region);
  const onNativeError = useCallback(() => {
    setNativeFailed(true);
  }, []);
  useNativeVendor(
    stage,
    useEmbedded && !nativeFailed ? embeddedVendor?.id : undefined,
    onNativeError,
  );
  useEffect(() => {
    if (!useEmbedded) return;
    return () => {
      void updateNativeView(null, null, true).catch(() => undefined);
    };
  }, [useEmbedded]);

  const changeRegion = (next: Region) => {
    setRegion(next);
    savePreference(regionKey, next);
    setEmbeddedVendor(undefined);
    setError('');
  };
  const dismissIntro = () => {
    savePreference(introKey, 'seen');
    setIntro(false);
  };
  const openExternal = (vendor: Vendor) => {
    setError('');
    if (!native) {
      window.open(vendor.url, '_blank', 'noopener,noreferrer');
      return;
    }
    void invoke('food_vendor_open_browser', { vendor: vendor.id }).catch(() =>
      setError(t('Не удалось открыть браузер.')),
    );
  };
  const openVendor = (vendor: Vendor) => {
    setError('');
    if (useEmbedded) {
      setNativeFailed(false);
      setEmbeddedVendor(vendor);
    } else {
      openExternal(vendor);
    }
  };

  const browserAction = (action: 'back' | 'reload') => {
    if (!embeddedVendor) return;
    void invoke('food_vendor_browser_action', { vendor: embeddedVendor.id, action }).catch(() =>
      setError(t('Не удалось выполнить действие в браузере.')),
    );
  };

  const tile = (vendor: Vendor, compact = false) => {
    const external = !useEmbedded;
    const logo = vendorLogos[vendor.id];
    const content = (
      <>
        <span aria-hidden="true" className={`food-vendor-mark food-vendor-${vendor.tone}`}>
          {logo ? <img src={logo} alt="" /> : vendor.mark}
        </span>
        <span>{vendor.name}</span>
        {!compact && external && (
          <ArrowUpRight className="food-tile-external" size={13} aria-hidden="true" />
        )}
      </>
    );
    const className = compact ? 'food-dock-tile' : 'food-tile';
    if (!native) {
      return (
        <a
          key={vendor.id}
          className={className}
          href={vendor.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {content}
        </a>
      );
    }
    return (
      <button
        key={vendor.id}
        type="button"
        className={className}
        aria-pressed={external ? undefined : embeddedVendor?.id === vendor.id}
        onClick={() => openVendor(vendor)}
      >
        {content}
      </button>
    );
  };

  return (
    <section className="food-page" aria-labelledby="food-title">
      <header className="food-heading">
        <div>
          {onBack && (
            <button className="food-back" type="button" aria-label={t('Магазин')} onClick={onBack}>
              <ArrowLeft size={19} />
            </button>
          )}
          <h1 id="food-title">{t('Еда')}</h1>
        </div>
        <label className="food-region">
          <span>{t('Страна')}</span>
          <select
            aria-label={t('Страна')}
            value={region}
            onChange={(event) => changeRegion(event.target.value as Region)}
          >
            {Object.entries(regions).map(([code, label]) => (
              <option key={code} value={code}>
                {t(label)}
              </option>
            ))}
          </select>
          <ChevronDown size={14} aria-hidden="true" />
        </label>
      </header>

      <div className="food-tablet">
        <div className="food-screen" inert={intro}>
          <div className="food-tablet-bar">
            {embeddedVendor ? (
              <>
                <div className="food-window-actions">
                  <button
                    type="button"
                    aria-label={t('Назад')}
                    disabled={nativeFailed}
                    onClick={() => browserAction('back')}
                  >
                    <ArrowLeft size={17} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('Обновить страницу')}
                    onClick={() => {
                      if (nativeFailed) setNativeFailed(false);
                      else browserAction('reload');
                    }}
                  >
                    <RotateCw size={16} aria-hidden="true" />
                  </button>
                </div>
                <div className="food-browser-address">
                  <strong>{embeddedVendor.name}</strong>
                  <span>{new URL(embeddedVendor.url).hostname}</span>
                </div>
                <div className="food-window-actions">
                  <button
                    type="button"
                    aria-label={t('Открыть в браузере')}
                    onClick={() => openExternal(embeddedVendor)}
                  >
                    <ArrowUpRight size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('Закрыть')}
                    onClick={() => {
                      setEmbeddedVendor(undefined);
                      setError('');
                    }}
                  >
                    <X size={17} aria-hidden="true" />
                  </button>
                </div>
              </>
            ) : (
              <span>
                <i aria-hidden="true" />
                {t('Доставка еды')}
              </span>
            )}
          </div>
          {embeddedVendor ? (
            <div ref={stage} className="food-native-stage">
              <p role={nativeFailed ? 'alert' : 'status'}>
                {t(
                  nativeFailed
                    ? 'Не удалось открыть сервис внутри TRLKA. Попробуйте открыть его в браузере.'
                    : 'Открываем сервис доставки…',
                )}
              </p>
            </div>
          ) : (
            <div className="food-catalog">
              <div className="food-pixel-planet" aria-hidden="true">
                <i />
              </div>
              <div className="food-catalog-content">
                <h2>{t('Сервисы доставки')}</h2>
                <div className="food-tiles">{catalog.map((vendor) => tile(vendor))}</div>
              </div>
            </div>
          )}
          <footer className="food-dock">
            {error ? <p role="alert">{error}</p> : <span>{t('Сервисы доставки')}</span>}
            <div>{catalog.map((vendor) => tile(vendor, true))}</div>
          </footer>
        </div>
        {intro && (
          <div
            className="food-intro"
            role="dialog"
            aria-labelledby="food-intro-title"
            onKeyDown={(event) => {
              if (event.key === 'Escape') dismissIntro();
            }}
          >
            <div className="food-intro-card">
              <div className="food-intro-icon" aria-hidden="true">
                <Pizza size={29} />
              </div>
              <h2 id="food-intro-title">{t('Еда на твою тарелку')}</h2>
              <p>
                {t('Закажи еду и положи её себе на тарелку')} <span aria-hidden="true">😉</span>
              </p>
              <button type="button" className="primary" autoFocus onClick={dismissIntro}>
                {t('К доставке')}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

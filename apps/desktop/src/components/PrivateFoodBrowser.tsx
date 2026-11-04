import { invoke, isTauri } from '@tauri-apps/api/core';
import { ArrowLeft, ArrowUpRight, RotateCw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { t } from '../lib/app-language';
import type vendors from '../lib/food-vendors.json';
import './food-page.css';

type Vendor = (typeof vendors)[number];
type Bounds = { x: number; y: number; width: number; height: number };

export function canEmbedPrivateFood() {
  return isTauri() && /Windows|Macintosh/i.test(navigator.userAgent);
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

export function PrivateFoodBrowser({ vendor, onClose }: { vendor: Vendor; onClose(): void }) {
  const stage = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(false);
  const onFailure = useCallback(() => setFailed(true), []);
  useNativeVendor(stage, failed ? undefined : vendor.id, onFailure);
  useEffect(
    () => () => {
      void updateNativeView(null, null, true).catch(() => undefined);
    },
    [],
  );

  const browserAction = (action: 'back' | 'reload') => {
    setError('');
    void invoke('food_vendor_browser_action', { vendor: vendor.id, action }).catch(() =>
      setError(t('Не удалось выполнить действие в браузере.')),
    );
  };

  return (
    <section className="call-activity private-food-browser" aria-label={vendor.name}>
      <div className="food-tablet-bar">
        <div className="food-window-actions">
          <button
            type="button"
            aria-label={t('Назад')}
            disabled={failed}
            onClick={() => browserAction('back')}
          >
            <ArrowLeft size={16} />
          </button>
          <button
            type="button"
            aria-label={t('Обновить страницу')}
            onClick={() => {
              if (failed) setFailed(false);
              else browserAction('reload');
            }}
          >
            <RotateCw size={15} />
          </button>
        </div>
        <div className="food-browser-address">
          <strong>{vendor.name}</strong>
          <span>{new URL(vendor.url).hostname}</span>
        </div>
        <div className="food-window-actions">
          <button
            type="button"
            aria-label={t('Открыть в браузере')}
            onClick={() => {
              setError('');
              void invoke('food_vendor_open_browser', { vendor: vendor.id }).catch(() =>
                setError(t('Не удалось открыть браузер.')),
              );
            }}
          >
            <ArrowUpRight size={16} />
          </button>
          <button type="button" aria-label={t('Закрыть')} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </div>
      <div ref={stage} className="food-native-stage">
        <p role={failed ? 'alert' : 'status'}>
          {t(
            failed
              ? 'Не удалось открыть сервис внутри TRLKA. Попробуйте открыть его в браузере.'
              : 'Открываем сервис доставки…',
          )}
        </p>
      </div>
      {error && (
        <p className="food-browser-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

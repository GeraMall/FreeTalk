import { invoke, isTauri } from '@tauri-apps/api/core';
import { t } from '../lib/app-language';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AppWindow, Monitor, X } from 'lucide-react';
import { screenPickerStore } from '../lib/native-screen-picker';
import './native-screen-picker.css';

// Short-lived, bounded memory cache. No images are persisted or sent to a server.
const thumbnailCache = new Map<string, { image: string; createdAt: number }>();
const thumbnailKey = (source: { kind: string; id: string; title: string }) =>
  `${source.kind}:${source.id}:${source.title}`;

export function NativeScreenSourcePicker() {
  const request = useSyncExternalStore(screenPickerStore.subscribe, screenPickerStore.snapshot);
  const [includeAudio, setIncludeAudio] = useState(true);
  const [tab, setTab] = useState<'screen' | 'window'>('screen');
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!request) return;
    setTab('screen');
    setIncludeAudio(request.includeAudio);
    setThumbnails({});
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, [request]);
  useEffect(() => {
    if (!request || !isTauri()) return;
    let cancelled = false;
    const sources = request.sources.filter((source) => source.kind === tab);
    let cursor = 0;
    // A slow/protected window must not block the first visible previews.
    const load = async () => {
      while (!cancelled && cursor < sources.length) {
        const source = sources[cursor++]!;
        const key = thumbnailKey(source);
        const cached = thumbnailCache.get(key);
        if (cached && Date.now() - cached.createdAt < 5_000) {
          setThumbnails((current) => ({
            ...current,
            [`${source.kind}:${source.id}`]: cached.image,
          }));
          continue;
        }
        try {
          const image = await invoke<string>('windows_screen_thumbnail', {
            sourceId: source.id,
            kind: source.kind,
          });
          if (cancelled) return;
          thumbnailCache.delete(key);
          thumbnailCache.set(key, { image, createdAt: Date.now() });
          while (thumbnailCache.size > 24)
            thumbnailCache.delete(thumbnailCache.keys().next().value!);
          setThumbnails((current) => ({ ...current, [`${source.kind}:${source.id}`]: image }));
        } catch {
          /* Minimized and protected windows may not provide a frame. */
        }
      }
    };
    void Promise.all([load(), load()]);
    return () => {
      cancelled = true;
    };
  }, [request, tab]);
  if (!request) return null;
  return createPortal(
    <dialog
      ref={dialog}
      className="native-screen-picker"
      onCancel={(event) => {
        event.preventDefault();
        request.complete(null);
      }}
    >
      <header>
        <div>
          <h2>{t('Демонстрация экрана')}</h2>
          <p>{t('Выберите, что увидят участники звонка')}</p>
        </div>
        <button aria-label={t('Отмена')} onClick={() => request.complete(null)}>
          <X size={20} />
        </button>
      </header>
      <div role="tablist" aria-label={t('Источник демонстрации')}>
        <button role="tab" aria-selected={tab === 'screen'} onClick={() => setTab('screen')}>
          <Monitor size={18} />
          {t('Экраны')}
        </button>
        <button role="tab" aria-selected={tab === 'window'} onClick={() => setTab('window')}>
          <AppWindow size={18} />
          {t('Окна')}
        </button>
      </div>
      <div className="native-screen-sources">
        {request.sources
          .filter((source) => source.kind === tab)
          .map((source, index) => (
            <button key={source.id} onClick={() => request.complete({ ...source, includeAudio })}>
              <span className="native-source-preview">
                {thumbnails[`${source.kind}:${source.id}`] ? (
                  <img src={thumbnails[`${source.kind}:${source.id}`]} alt="" />
                ) : tab === 'screen' ? (
                  <Monitor size={26} />
                ) : (
                  <AppWindow size={26} />
                )}
              </span>
              <span>{source.title || t('Экран {number}', { number: index + 1 })}</span>
            </button>
          ))}
        {!request.sources.some((source) => source.kind === tab) && (
          <p>{t('Нет доступных окон. Откройте нужное приложение и повторите выбор.')}</p>
        )}
      </div>
      <label className="native-screen-audio">
        <input
          type="checkbox"
          checked={includeAudio}
          onChange={(event) => setIncludeAudio(event.target.checked)}
        />
        <span>{t('Транслировать звук')}</span>
      </label>
      <footer>
        <span>
          {tab === 'window'
            ? t('Будет показано только выбранное окно')
            : t('Участники увидят всё на выбранном экране')}
        </span>
        <button onClick={() => request.complete(null)}>{t('Отмена')}</button>
      </footer>
    </dialog>,
    document.body,
  );
}

import { t } from '../lib/app-language';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, Star, Upload, X, RefreshCw, ImagePlus } from 'lucide-react';
import type { GifMessageData } from './ChatsPage';
import { accountClient } from '../lib/api-client';
import { getActiveAccountMediaScope } from '../lib/account-media-cache';
import { useCachedMediaUrl } from '../lib/use-cached-media';
import {
  gifKey,
  MAX_GIF_BYTES,
  refreshGifLibrary,
  toggleGifFavorite,
  useGifLibrary,
} from '../lib/gif-library';
import { searchGifs, type GifProviderConfig } from '../lib/gif-provider';

export function GifImage({
  gif,
  onError,
  preview = false,
}: {
  gif: GifMessageData;
  onError?(): void;
  preview?: boolean;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: '80px' },
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const source = visible ? (preview ? (gif.previewUrl ?? gif.url) : gif.url) : undefined;
  const cached = useCachedMediaUrl(gif.attribution.provider === 'KLIPY' ? undefined : source);
  const src = gif.attribution.provider === 'KLIPY' ? source : cached;
  return (
    <span ref={host} className="gif-media-frame">
      {src && visible ? (
        <img
          src={src}
          alt={gif.alt}
          loading="lazy"
          draggable={false}
          onError={onError}
          referrerPolicy="no-referrer"
        />
      ) : (
        <span className="gif-image-loading" />
      )}
    </span>
  );
}
function GifTile({
  gif,
  busy,
  onSelect,
  onRemove,
}: {
  gif: GifMessageData;
  busy: boolean;
  onSelect(): void;
  onRemove?(): void;
}) {
  const [failed, setFailed] = useState(false);
  const [play, setPlay] = useState(false);
  return (
    <div className="gif-tile">
      <button
        className="gif-tile-send"
        disabled={busy || failed}
        onClick={onSelect}
        aria-label={t('Отправить GIF: {p0}', { p0: gif.alt })}
        data-tooltip={gif.alt}
        onMouseEnter={() => setPlay(true)}
        onMouseLeave={() => setPlay(false)}
        onFocus={() => setPlay(true)}
        onBlur={() => setPlay(false)}
      >
        {failed ? (
          <span className="gif-tile-error">{t('Не удалось загрузить GIF')}</span>
        ) : (
          <GifImage gif={gif} preview={!play} onError={() => setFailed(true)} />
        )}
      </button>
      {onRemove ? (
        <button
          className="gif-tile-remove"
          onClick={onRemove}
          disabled={busy}
          aria-label={t('Убрать из избранного: {p0}', { p0: gif.alt })}
          data-tooltip={t('Убрать из избранного')}
        >
          <Star fill="currentColor" />
        </button>
      ) : null}
    </div>
  );
}
export function GifPicker({
  busy,
  onClose,
  onSelect,
  externalError,
}: {
  busy: boolean;
  onClose(): void;
  onSelect(gif: GifMessageData | File): void;
  externalError?: string;
}) {
  const accountId = getActiveAccountMediaScope();
  const library = useGifLibrary(accountId);
  const [tab, setTab] = useState<'favorites' | 'search'>('favorites');
  const [config, setConfig] = useState<GifProviderConfig>({ provider: null });
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GifMessageData[]>([]);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<File>();
  const [preview, setPreview] = useState('');
  const [mutation, setMutation] = useState(false);
  const [visibleCount, setVisibleCount] = useState(24);
  const picker = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (accountId) void refreshGifLibrary(accountId);
  }, [accountId]);
  useEffect(() => {
    let disposed = false;
    void accountClient
      .request<GifProviderConfig>('/v1/gifs/config')
      .then((value) => {
        if (!disposed) {
          setConfig(value);
          if (value.provider) setTab('search');
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const close = (event: PointerEvent) => {
      if ((event.target as Element)?.closest('.composer-gif-button')) return;
      if (!picker.current?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, [onClose]);
  useEffect(() => {
    if (!pending) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(pending);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [pending]);
  useEffect(() => {
    if (tab !== 'search' || !config.provider) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const timer = setTimeout(() => {
      void searchGifs(config, query, page, controller.signal)
        .then((value) => {
          if (controller.signal.aborted) return;
          setResults((old) => (page === 1 ? value.gifs : [...old, ...value.gifs]));
          setMore(value.hasMore);
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setError(error instanceof Error ? error.message : 'Не удалось загрузить GIF');
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [config, query, page, tab]);
  const choose = (file?: File) => {
    setError('');
    if (!file) return;
    if (!/\.gif$/i.test(file.name) && file.type !== 'image/gif') {
      setError('Выберите файл GIF.');
      return;
    }
    if (!file.size || file.size > MAX_GIF_BYTES) {
      setError('GIF должен быть не больше 30 МБ.');
      return;
    }
    setPending(file);
  };
  const remove = async (gif: GifMessageData) => {
    if (!accountId || mutation) return;
    setMutation(true);
    try {
      await toggleGifFavorite(accountId, gif);
    } catch {
      setError('Не удалось убрать GIF из избранного.');
    } finally {
      setMutation(false);
    }
  };
  const list =
    tab === 'favorites'
      ? library.gifs.filter((gif) =>
          gif.alt.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
        )
      : results;
  return createPortal(
    <div
      ref={picker}
      className="gif-picker gif-library-picker"
      role="dialog"
      aria-label="GIF"
      aria-modal="true"
    >
      <header>
        <div>
          <strong>GIF</strong>
          <small>
            {pending
              ? t('Свой GIF')
              : tab === 'favorites'
                ? t('Твоя коллекция')
                : config.provider
                  ? 'Powered by KLIPY'
                  : t('Поиск GIF')}
          </small>
        </div>
        <button aria-label={t('Закрыть GIF')} onClick={onClose}>
          <X />
        </button>
      </header>
      <input
        ref={input}
        type="file"
        hidden
        accept="image/gif,.gif"
        aria-label={t('Выбрать свой GIF')}
        onChange={(event) => {
          choose(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      {pending && (error || externalError) ? (
        <div className="gif-library-error" role="alert">
          {error || externalError}
        </div>
      ) : null}
      {pending ? (
        <div className="gif-upload-preview">
          <img src={preview} alt={t('Предпросмотр своего GIF')} />
          <strong>{pending.name}</strong>
          <small>
            {(pending.size / 1024 / 1024).toFixed(1)} {t('МБ · Сохранится в избранном')}
          </small>
          <p>{t('GIF увидят участники чата. В общий каталог он не попадёт.')}</p>
          <div>
            <button onClick={() => setPending(undefined)} disabled={busy}>
              {t('Назад')}
            </button>
            <button className="gif-send-local" onClick={() => onSelect(pending)} disabled={busy}>
              {busy ? t('Отправляем…') : t('Отправить GIF')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="gif-library-tabs">
            <button
              aria-pressed={tab === 'favorites'}
              onClick={() => {
                setTab('favorites');
                setQuery('');
                setError('');
              }}
            >
              <Star />
              {t('Избранное')}
            </button>
            <button
              aria-pressed={tab === 'search'}
              onClick={() => {
                setTab('search');
                setQuery('');
                setPage(1);
                setError('');
              }}
            >
              <Search />
              {t('Поиск')}
            </button>
            <button
              className="gif-upload-button"
              onClick={() => input.current?.click()}
              disabled={busy}
            >
              <Upload />
              {t('Свой GIF')}
            </button>
          </div>
          <label className="gif-search-field">
            <Search />
            <input
              value={query}
              placeholder={tab === 'favorites' ? t('Найти в избранном') : t('Поиск GIF')}
              aria-label={t('Поиск GIF')}
              onChange={(event) => {
                setQuery(event.target.value);
                setVisibleCount(24);
                setPage(1);
              }}
            />
          </label>
          {error || externalError || (tab === 'favorites' && library.error) ? (
            <div className="gif-library-error" role="alert">
              {error || externalError || library.error}
              {accountId && library.error ? (
                <button onClick={() => void refreshGifLibrary(accountId)}>
                  <RefreshCw />
                  {t('Повторить')}
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="gif-results" aria-live="polite" aria-busy={loading || library.loading}>
            {tab === 'search' && !config.provider ? (
              <div className="gif-library-empty">
                <Search />
                <strong>{t('Поиск GIF скоро появится')}</strong>
                <p>{t('Пока можно отправить свой GIF или выбрать его из избранного.')}</p>
                <button onClick={() => input.current?.click()}>
                  <Upload />
                  {t('Загрузить GIF')}
                </button>
              </div>
            ) : (tab === 'favorites' ? library.loading : loading && page === 1) ? (
              Array.from({ length: 6 }, (_, i) => <i key={i} />)
            ) : list.length ? (
              (tab === 'favorites' ? list.slice(0, visibleCount) : list).map((gif) => (
                <GifTile
                  key={gifKey(gif)}
                  gif={gif}
                  busy={busy || mutation}
                  onSelect={() => onSelect(gif)}
                  onRemove={tab === 'favorites' ? () => void remove(gif) : undefined}
                />
              ))
            ) : (
              <div className="gif-library-empty">
                <ImagePlus />
                <strong>{query ? t('Ничего не найдено') : t('Собери свои GIF')}</strong>
                <p>
                  {query
                    ? t('Попробуй другой запрос.')
                    : t('Загружай свои гифки или сохраняй понравившиеся из чата.')}
                </p>
                <button onClick={() => input.current?.click()}>
                  <Upload />
                  {t('Загрузить GIF')}
                </button>
              </div>
            )}
          </div>
          {tab === 'search' && more ? (
            <button
              className="gif-load-more"
              disabled={loading}
              onClick={() => setPage((value) => value + 1)}
            >
              {loading ? t('Загружаем…') : t('Ещё GIF')}
            </button>
          ) : null}
          {tab === 'favorites' && list.length > visibleCount ? (
            <button
              className="gif-load-more"
              onClick={() => setVisibleCount((value) => value + 24)}
            >
              {t('Ещё GIF')}
            </button>
          ) : null}
        </>
      )}
      <footer>
        <span>{t('Свои GIF · до 30 МБ')}</span>
        {tab === 'search' && config.provider ? (
          <a href="https://klipy.com" target="_blank" rel="noreferrer">
            Powered by KLIPY
          </a>
        ) : (
          <span>{t('Личное избранное')}</span>
        )}
      </footer>
    </div>,
    document.body,
  );
}

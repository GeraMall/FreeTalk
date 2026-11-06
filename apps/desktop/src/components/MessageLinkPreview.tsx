import { EmbeddedVideo } from './EmbeddedVideo';
import { messageVideo } from '../lib/message-link-preview';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Play, X } from 'lucide-react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { accountClient } from '../lib/api-client';
import { getActiveAccountMediaScope } from '../lib/account-media-cache';
import { t } from '../lib/app-language';
import './message-link-preview.css';

interface Preview {
  url: string;
  provider: string;
  title: string;
  description: string;
  imageKey?: string;
  imageUrl?: string;
}
interface CachedPreview {
  until: number;
  request: Promise<Preview | null>;
  value?: Preview | null;
}
const cache = new Map<string, CachedPreview>();
const previewKey = (url: string) => `${getActiveAccountMediaScope() ?? ''}:${url}`;
const imageCache = new Map<string, { until: number; blob: Blob }>();
const imagePending = new Map<string, Promise<Blob>>();
async function loadImage(key: string) {
  const scoped = previewKey(key),
    cached = imageCache.get(scoped);
  if (cached && cached.until > Date.now()) return cached.blob;
  const pending = imagePending.get(scoped);
  if (pending) return pending;
  const request = accountClient
    .linkPreviewImage(key)
    .then((blob) => {
      if (blob.size > 2 * 1024 * 1024) throw new Error('Preview image too large');
      imageCache.set(scoped, { until: Date.now() + 600000, blob });
      while (
        imageCache.size > 30 ||
        [...imageCache.values()].reduce((sum, item) => sum + item.blob.size, 0) > 8 * 1024 * 1024
      )
        imageCache.delete(imageCache.keys().next().value!);
      return blob;
    })
    .finally(() => imagePending.delete(scoped));
  imagePending.set(scoped, request);
  return request;
}
function load(url: string) {
  const key = previewKey(url),
    cached = cache.get(key);
  if (cached && cached.until > Date.now()) return cached.request;
  if (cache.size >= 100) cache.delete(cache.keys().next().value!);
  const entry: CachedPreview = {
    until: Date.now() + 600000,
    request: Promise.resolve(null) as Promise<Preview | null>,
  };
  entry.request = accountClient
    .request<{ preview: Preview | null }>(`/v1/link-preview?url=${encodeURIComponent(url)}`)
    .then((result) => {
      entry.value = result.preview;
      if (!result.preview) entry.until = Date.now() + 30000;
      return result.preview;
    })
    .catch(() => {
      entry.until = Date.now() + 30000;
      entry.value = null;
      return null;
    });
  cache.set(key, entry);
  return entry.request;
}
function external(event: MouseEvent<HTMLAnchorElement>) {
  if (event.defaultPrevented || !isTauri() || (event.type === 'auxclick' && event.button !== 1))
    return;
  event.preventDefault();
  void invoke('open_chat_link', { url: event.currentTarget.href }).catch(console.error);
}
function PreviewImage({ preview }: { preview: Preview }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let cancelled = false,
      objectUrl: string | undefined;
    setSrc(undefined);
    if (preview.imageKey)
      void loadImage(preview.imageKey)
        .then((blob) => {
          if (cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setSrc(objectUrl);
        })
        .catch(() => {});
    else if (
      preview.imageUrl &&
      /^https:\/\/(i\.ytimg\.com|upload\.wikimedia\.org)\//.test(preview.imageUrl)
    )
      setSrc(preview.imageUrl);
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [preview.imageKey, preview.imageUrl]);
  if (!preview.imageKey && !preview.imageUrl) return null;
  return (
    <span className="link-preview-thumbnail">
      {src && <img src={src} alt="" loading="lazy" onError={() => setSrc(undefined)} />}
    </span>
  );
}
export function MessageLinkPreviewCard({ url }: { url: string }) {
  const [preview, setPreview] = useState<Preview | null | undefined>(
    () => cache.get(previewKey(url))?.value,
  );
  const [playing, setPlaying] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null),
    dialog = useRef<HTMLElement>(null);
  const video = messageVideo(url);
  useEffect(() => {
    let alive = true;
    setPreview(cache.get(previewKey(url))?.value);
    void load(url).then((value) => {
      if (alive) setPreview(value);
    });
    return () => {
      alive = false;
    };
  }, [url]);
  useEffect(() => {
    if (!playing) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setPlaying(false);
      }
      if (event.key === 'Tab') {
        const elements = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a,iframe,input:not(:disabled)',
          ) ?? [],
        );
        const first = elements[0],
          last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, [playing]);
  const data =
    preview ??
    (video ? { url, provider: video.provider, title: video.provider, description: '' } : undefined);
  if (!data) return null;
  const content = (
    <>
      <PreviewImage preview={data} />
      <span className="link-preview-copy">
        <small>{data.provider}</small>
        <strong>{data.title}</strong>
        {data.description && <em>{data.description}</em>}
      </span>
      {video && (
        <span className="link-preview-play">
          <Play size={21} fill="currentColor" />
        </span>
      )}
    </>
  );
  return (
    <>
      {video ? (
        <button
          ref={trigger}
          type="button"
          className="message-link-preview is-video"
          onClick={() => setPlaying(true)}
          aria-label={`${t('Смотреть видео')}: ${data.title}`}
        >
          {content}
        </button>
      ) : (
        <a
          className="message-link-preview"
          href={data.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={external}
          onAuxClick={external}
        >
          {content}
        </a>
      )}
      {playing &&
        video &&
        createPortal(
          <div
            className="message-video-backdrop"
            onClick={(event) => {
              if (event.target === event.currentTarget) setPlaying(false);
            }}
          >
            <section
              ref={dialog}
              className="message-video-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={data.title}
            >
              <button
                className="message-video-close"
                type="button"
                aria-label={t('Закрыть')}
                onClick={() => setPlaying(false)}
              >
                <X size={24} />
              </button>
              <EmbeddedVideo embed={video.embed} provider={video.provider} title={data.title} />
              <a
                className="message-video-external"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={external}
              >
                <ExternalLink size={15} />
                {t('Открыть в браузере')}
              </a>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}

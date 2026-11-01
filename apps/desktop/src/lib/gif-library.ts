import { useEffect, useSyncExternalStore } from 'react';
import { accountClient } from './api-client';
import type { GifMessageData } from '../components/ChatsPage';

export const MAX_GIF_BYTES = 30 * 1024 * 1024;
export const gifKey = (gif: GifMessageData) => gif.assetId ?? gif.url;
interface Library {
  gifs: GifMessageData[];
  loading: boolean;
  error: string;
  loaded: boolean;
}
const empty: Library = { gifs: [], loading: false, error: '', loaded: false };
const libraries = new Map<string, Library>();
const listeners = new Set<() => void>();
const inFlight = new Map<string, Promise<void>>();
const versions = new Map<string, number>();
function update(accountId: string, state: Library) {
  libraries.set(accountId, state);
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function refreshGifLibrary(accountId: string) {
  if (inFlight.has(accountId)) return inFlight.get(accountId)!;
  const version = versions.get(accountId) ?? 0;
  update(accountId, { ...(libraries.get(accountId) ?? empty), loading: true, error: '' });
  const task = accountClient
    .request<{ gifs: GifMessageData[] }>('/v1/gifs/favorites')
    .then((result) => {
      if (!Array.isArray(result.gifs)) throw new Error('Invalid GIF library');
      if ((versions.get(accountId) ?? 0) !== version) return;
      update(accountId, { gifs: result.gifs, loading: false, error: '', loaded: true });
    })
    .catch(() => {
      if ((versions.get(accountId) ?? 0) !== version) return;
      update(accountId, {
        ...(libraries.get(accountId) ?? empty),
        loading: false,
        loaded: true,
        error: 'Не удалось загрузить избранное.',
      });
    })
    .finally(() => inFlight.delete(accountId));
  inFlight.set(accountId, task);
  return task;
}
export function useGifLibrary(accountId?: string) {
  const state = useSyncExternalStore(subscribe, () =>
    accountId ? (libraries.get(accountId) ?? empty) : empty,
  );
  useEffect(() => {
    if (accountId && !state.loaded) void refreshGifLibrary(accountId);
  }, [accountId, state.loaded]);
  return state;
}
export async function toggleGifFavorite(
  accountId: string,
  gif: GifMessageData,
  messageId?: string,
) {
  const state = libraries.get(accountId) ?? empty;
  const saved = state.gifs.find((item) => gifKey(item) === gifKey(gif));
  if (saved?.favoriteId) {
    await accountClient.request(`/v1/gifs/favorites/${saved.favoriteId}`, { method: 'DELETE' });
    versions.set(accountId, (versions.get(accountId) ?? 0) + 1);
    const current = libraries.get(accountId) ?? empty;
    update(accountId, {
      ...current,
      loading: false,
      error: '',
      gifs: current.gifs.filter((item) => item.favoriteId !== saved.favoriteId),
    });
  } else {
    const body = messageId ? { messageId } : gif.assetId ? { assetId: gif.assetId } : { gif };
    const result = await accountClient.request<{ gif: GifMessageData }>('/v1/gifs/favorites', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    versions.set(accountId, (versions.get(accountId) ?? 0) + 1);
    const current = libraries.get(accountId) ?? empty;
    update(accountId, {
      ...current,
      loading: false,
      error: '',
      loaded: true,
      gifs: [result.gif, ...current.gifs.filter((item) => gifKey(item) !== gifKey(gif))],
    });
  }
}
export async function uploadPrivateGif(file: File, accountId: string) {
  if (!file.size || file.size > MAX_GIF_BYTES) throw new Error('Выберите GIF размером до 30 МБ.');
  const body = new FormData();
  body.append('gif', file, file.name);
  body.append('thumbnail', await gifThumbnail(file), 'gif-preview.webp');
  const result = await accountClient.request<{ gif: GifMessageData }>('/v1/gifs/uploads', {
    method: 'POST',
    body,
  });
  versions.set(accountId, (versions.get(accountId) ?? 0) + 1);
  const current = libraries.get(accountId) ?? empty;
  update(accountId, {
    ...current,
    loading: false,
    loaded: true,
    gifs: [result.gif, ...current.gifs.filter((gif) => gifKey(gif) !== gifKey(result.gif))],
  });
  return result.gif;
}

export async function gifThumbnail(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('GIF повреждён или не поддерживается.'));
    });
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth > 4096 ||
      image.naturalHeight > 4096
    )
      throw new Error('Разрешение GIF должно быть не больше 4096 × 4096.');
    const scale = Math.min(1, 320 / image.naturalWidth, 320 / image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось подготовить GIF.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const thumbnail = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Не удалось подготовить GIF.'))),
        'image/webp',
        0.65,
      ),
    );
    image.src = '';
    if (thumbnail.size > 64 * 1024) throw new Error('Не удалось уменьшить миниатюру GIF.');
    return thumbnail;
  } finally {
    URL.revokeObjectURL(url);
  }
}

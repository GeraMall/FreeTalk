import type { GifMessageData } from '../components/ChatsPage';
export interface GifProviderConfig {
  provider: 'KLIPY' | null;
  apiKey?: string;
}
interface Rendition {
  url: string;
  width?: number;
  height?: number;
  size?: number;
}
interface KlipyItem {
  id: string | number;
  title?: string;
  slug?: string;
  file?: Record<string, { gif?: Rendition }>;
}
const trustedMedia = (value: string) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'static.klipy.com' &&
      !url.port &&
      !url.username &&
      !url.password &&
      url.pathname.endsWith('.gif')
    );
  } catch {
    return false;
  }
};
export function klipyGif(item: KlipyItem): GifMessageData | undefined {
  // Use the provider's smaller animated rendition; never use a still thumbnail
  // or reconstruct its media URL (including delivery query parameters).
  const candidates = ['md', 'sm', 'xs', 'hd'].map((size) => item.file?.[size]?.gif);
  const media = candidates.find(
    (file) => file && trustedMedia(file.url) && (!file.size || file.size <= 30 * 1024 * 1024),
  );
  if (!media) return undefined;
  const title = (item.title || 'GIF').trim().slice(0, 200);
  const preview = ['xs', 'sm', 'md']
    .map((size) => item.file?.[size]?.gif)
    .find((file) => file && trustedMedia(file.url) && (!file.size || file.size <= 512 * 1024));
  return {
    providerId: String(item.id),
    url: media.url,
    previewUrl: preview?.url ?? media.url,
    width: media.width,
    height: media.height,
    alt: title,
    attribution: {
      provider: 'KLIPY',
      title,
      pageUrl: `https://klipy.com/gifs/${encodeURIComponent(item.slug || String(item.id))}`,
    },
  };
}
export async function searchGifs(
  config: GifProviderConfig,
  query: string,
  page: number,
  signal: AbortSignal,
) {
  if (!config.apiKey || config.provider !== 'KLIPY') return { gifs: [], hasMore: false };
  const params = new URLSearchParams({
    per_page: '20',
    page: String(page),
    locale: 'ru',
    content_filter: 'high',
  });
  const search = query.trim();
  if (search) params.set('q', search);
  const response = await fetch(
    `https://api.klipy.com/api/v1/${encodeURIComponent(config.apiKey)}/gifs/${search ? 'search' : 'trending'}?${params}`,
    { signal, credentials: 'omit' },
  );
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? 'Поиск временно занят. Попробуйте немного позже.'
        : 'Не удалось загрузить GIF. Попробуйте ещё раз.',
    );
  const result = (await response.json()) as {
    result?: boolean;
    data?: { data?: KlipyItem[]; has_next?: boolean };
  };
  if (!result.result || !Array.isArray(result.data?.data))
    throw new Error('Медиатека GIF временно недоступна.');
  const gifs = result.data.data.map(klipyGif);
  // Keep the original ordering; do not silently turn unknown provider items into
  // a different search feed. The UI reports an unsupported response explicitly.
  if (gifs.some((gif) => !gif))
    throw new Error('Не удалось подобрать уменьшенную анимированную версию GIF.');
  return { gifs: gifs as GifMessageData[], hasMore: result.data.has_next === true };
}

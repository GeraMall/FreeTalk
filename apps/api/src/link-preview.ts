export interface LinkPreview {
  url: string;
  provider: 'YouTube' | 'Wikipedia';
  title: string;
  description: string;
  imageUrl?: string;
}

const cache = new Map<string, { expiresAt: number; value: LinkPreview | null }>();
const CACHE_MS = 10 * 60_000;
const MAX_CACHE_ENTRIES = 200;

function compact(value: unknown, maximum: number) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maximum) : '';
}

function youtubeVideoId(url: URL) {
  const host = url.hostname.toLowerCase();
  let candidate = '';
  if (host === 'youtu.be') candidate = url.pathname.split('/').filter(Boolean)[0] ?? '';
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
    if (url.pathname === '/watch') candidate = url.searchParams.get('v') ?? '';
    else if (/^\/(shorts|embed)\//.test(url.pathname)) candidate = url.pathname.split('/')[2] ?? '';
  }
  return /^[A-Za-z0-9_-]{6,20}$/.test(candidate) ? candidate : undefined;
}

function wikipediaArticle(url: URL) {
  const match = /^([a-z][a-z0-9-]{0,11})\.wikipedia\.org$/i.exec(url.hostname);
  if (!match || !url.pathname.startsWith('/wiki/')) return undefined;
  const encodedTitle = url.pathname.slice('/wiki/'.length);
  if (!encodedTitle || encodedTitle.length > 500) return undefined;
  try {
    return { language: match[1]!.toLowerCase(), title: decodeURIComponent(encodedTitle) };
  } catch {
    return undefined;
  }
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'FreeTalk-LinkPreview/1.0' },
    redirect: 'error',
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok) throw new Error(`Preview provider returned ${response.status}`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > 256 * 1024) throw new Error('Preview response is too large');
  const text = await response.text();
  if (text.length > 256 * 1024) throw new Error('Preview response is too large');
  return JSON.parse(text) as Record<string, unknown>;
}

export async function resolveLinkPreview(input: string): Promise<LinkPreview | null> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  url.hash = '';
  const key = url.toString();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let preview: LinkPreview | null = null;
  const videoId = youtubeVideoId(url);
  const article = wikipediaArticle(url);
  try {
    if (videoId) {
      const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const data = await fetchJson(
        `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(canonicalUrl)}`,
      );
      const title = compact(data.title, 180);
      if (title)
        preview = {
          url: canonicalUrl,
          provider: 'YouTube',
          title,
          description: compact(data.author_name, 120),
          imageUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        };
    } else if (article) {
      const data = await fetchJson(
        `https://${article.language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(article.title)}`,
      );
      const title = compact(data.title, 180);
      const thumbnail =
        data.thumbnail && typeof data.thumbnail === 'object'
          ? (data.thumbnail as Record<string, unknown>).source
          : undefined;
      const imageUrl = typeof thumbnail === 'string' ? new URL(thumbnail) : undefined;
      if (title)
        preview = {
          url: key,
          provider: 'Wikipedia',
          title,
          description: compact(data.extract, 280),
          imageUrl:
            imageUrl?.protocol === 'https:' && imageUrl.hostname === 'upload.wikimedia.org'
              ? imageUrl.toString()
              : undefined,
        };
    }
  } catch {
    preview = null;
  }

  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(key, { expiresAt: Date.now() + CACHE_MS, value: preview });
  return preview;
}

export function isSupportedPreviewUrl(input: string) {
  try {
    const url = new URL(input);
    return Boolean(youtubeVideoId(url) || wikipediaArticle(url));
  } catch {
    return false;
  }
}

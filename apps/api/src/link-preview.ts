import { createHash } from 'node:crypto';
import { fetchPublicPreview, previewUrl } from './safe-preview-fetch.js';

export interface LinkPreview {
  url: string;
  provider: string;
  title: string;
  description: string;
  imageKey?: string;
  imageUrl?: string;
  video?: { provider: 'YouTube' | 'Rutube'; id: string };
}
const cache = new Map<string, { expiresAt: number; value: LinkPreview | null }>();
const pending = new Map<string, Promise<LinkPreview | null>>();
const images = new Map<string, { url: string; expiresAt: number }>();
const CACHE_MS = 10 * 60_000;
function retain<T>(map: Map<string, T>, key: string, value: T) {
  if (map.size >= 200) map.delete(map.keys().next().value!);
  map.set(key, value);
}
function compact(value: unknown, maximum: number) {
  return typeof value === 'string'
    ? decode(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';
}
function decode(value: string) {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,
    (full, entity: string) => {
      const names: Record<string, string> = {
        amp: '&',
        quot: '"',
        apos: "'",
        lt: '<',
        gt: '>',
        nbsp: ' ',
      };
      if (!entity.startsWith('#')) return names[entity.toLowerCase()] ?? full;
      const code =
        entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    },
  );
}
export function previewVideo(url: URL): LinkPreview['video'] {
  const host = url.hostname.toLowerCase();
  let id = '';
  if (host === 'youtu.be') id = url.pathname.split('/')[1] ?? '';
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host))
    id =
      url.pathname === '/watch'
        ? (url.searchParams.get('v') ?? '')
        : /^\/(shorts|embed)\//.test(url.pathname)
          ? (url.pathname.split('/')[2] ?? '')
          : '';
  if (/^[A-Za-z0-9_-]{11}$/.test(id)) return { provider: 'YouTube', id };
  if (['rutube.ru', 'www.rutube.ru'].includes(host)) {
    id = /^\/(?:video|play\/embed)\/([a-f0-9]{32})(?:\/|$)/i.exec(url.pathname)?.[1] ?? '';
    if (id) return { provider: 'Rutube', id: id.toLowerCase() };
  }
  return undefined;
}
export function parsePreviewHtml(html: string, input: string): LinkPreview | null {
  const url = previewUrl(input);
  const metadata = new Map<string, string>();
  // Metadata is text only: never render remote HTML, scripts or an arbitrary iframe.
  for (const tag of html.match(/<meta\b[^>]{0,8192}>/gi) ?? []) {
    const attrs = new Map<string, string>();
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))
      attrs.set(match[1]!.toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
    const key = (attrs.get('property') ?? attrs.get('name') ?? '').toLowerCase();
    if (key && !metadata.has(key)) metadata.set(key, attrs.get('content') ?? '');
  }
  const title = compact(
    metadata.get('og:title') ??
      metadata.get('twitter:title') ??
      /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1],
    180,
  );
  if (!title) return null;
  const preview: LinkPreview = {
    url: url.toString(),
    provider: compact(metadata.get('og:site_name'), 60) || url.hostname.replace(/^www\./, ''),
    title,
    description: compact(
      metadata.get('og:description') ??
        metadata.get('description') ??
        metadata.get('twitter:description'),
      280,
    ),
    video: previewVideo(url),
  };
  const source = metadata.get('og:image') ?? metadata.get('twitter:image');
  if (source) {
    try {
      const imageUrl = new URL(decode(source), url).toString();
      preview.imageKey = rememberImage(imageUrl);
      if (/^https:\/\/(i\.ytimg\.com|upload\.wikimedia\.org)\//.test(imageUrl))
        preview.imageUrl = imageUrl;
    } catch {
      /* optional media */
    }
  }
  return preview;
}
function rememberImage(input: string) {
  const url = previewUrl(input).toString();
  const key = createHash('sha256').update(url).digest('hex');
  retain(images, key, { url, expiresAt: Date.now() + CACHE_MS });
  return key;
}
export async function resolvePreviewImage(key: string) {
  const image = images.get(key);
  if (!image || image.expiresAt <= Date.now()) return undefined;
  try {
    const result = await fetchPublicPreview(image.url, 2 * 1024 * 1024);
    if (!/^image\/(jpeg|png|webp|gif)(?:;|$)/i.test(result.type)) return undefined;
    return result;
  } catch {
    return undefined;
  }
}
async function resolve(url: URL): Promise<LinkPreview | null> {
  const video = previewVideo(url);
  try {
    if (video?.provider === 'YouTube') {
      const canonical = `https://www.youtube.com/watch?v=${video.id}`;
      const result = await fetchPublicPreview(
        `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(canonical)}`,
        256 * 1024,
      );
      const data = JSON.parse(result.body.toString('utf8')) as Record<string, unknown>;
      if (compact(data.title, 180))
        return {
          url: canonical,
          provider: 'YouTube',
          title: compact(data.title, 180),
          description: compact(data.author_name, 120),
          video,
          imageKey: rememberImage(`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`),
          imageUrl: `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
        };
    } else {
      const result = await fetchPublicPreview(url.toString(), 512 * 1024, true);
      if (!/^text\/html(?:;|$)/i.test(result.type)) return null;
      const charset = /charset=["']?([\w-]+)/i.exec(result.type)?.[1] ?? 'utf-8';
      let html: string;
      try {
        html = new TextDecoder(charset).decode(result.body);
      } catch {
        html = result.body.toString('utf8');
      }
      const preview = parsePreviewHtml(html, result.url);
      if (preview) return { ...preview, video: video ?? preview.video };
    }
  } catch {
    /* A failed preview never prevents sending or reading the message. */
  }
  if (video)
    return {
      url: url.toString(),
      provider: video.provider,
      title: video.provider,
      description: '',
      video,
      imageKey:
        video.provider === 'YouTube'
          ? rememberImage(`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`)
          : undefined,
    };
  return null;
}
export async function resolveLinkPreview(input: string): Promise<LinkPreview | null> {
  let url: URL;
  try {
    url = previewUrl(input);
  } catch {
    return null;
  }
  const key = url.toString(),
    cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const existing = pending.get(key);
  if (existing) return existing;
  if (pending.size >= 8) return null;
  const request = resolve(url)
    .then((value) => {
      retain(cache, key, { value, expiresAt: Date.now() + (value ? CACHE_MS : 30000) });
      return value;
    })
    .finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}
export function isSupportedPreviewUrl(input: string) {
  try {
    previewUrl(input);
    return true;
  } catch {
    return false;
  }
}

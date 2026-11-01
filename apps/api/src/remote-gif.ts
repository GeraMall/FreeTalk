import { MAX_GIF_BYTES } from './gif-file.js';
const VERIFIED_GIF_TTL_MS = 30 * 60_000;
const verifiedGifUrls = new Map<string, number>();
type Inspection = { ok: true } | { ok: false; code: string; message: string };
export async function inspectRemoteGif(value: string): Promise<Inspection> {
  const unavailable = {
    ok: false as const,
    code: 'GIF_UNAVAILABLE',
    message:
      'Не удалось загрузить GIF из медиатеки. Попробуйте другую гифку или загрузите свой файл.',
  };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return unavailable;
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'upload.wikimedia.org' ||
    url.port ||
    url.username ||
    url.password ||
    !url.pathname.toLowerCase().endsWith('.gif')
  )
    return unavailable;
  if ((verifiedGifUrls.get(value) ?? 0) > Date.now()) return { ok: true };
  try {
    const response = await fetch(value, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(5_000),
      headers: { accept: 'image/gif' },
    });
    if (!response.ok) return unavailable;
    if (
      response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'image/gif'
    )
      return {
        ok: false,
        code: 'INVALID_GIF',
        message: 'Источник вернул обычную картинку или неподдерживаемый формат вместо GIF.',
      };
    const length = Number(response.headers.get('content-length'));
    if (!Number.isSafeInteger(length) || length <= 0) return unavailable;
    if (length > MAX_GIF_BYTES)
      return {
        ok: false,
        code: 'GIF_TOO_LARGE',
        message:
          'Оригинал GIF превышает 30 МБ. Выберите уменьшенную версию или загрузите свой GIF.',
      };
    if (verifiedGifUrls.size >= 500) verifiedGifUrls.delete(verifiedGifUrls.keys().next().value!);
    verifiedGifUrls.set(value, Date.now() + VERIFIED_GIF_TTL_MS);
    return { ok: true };
  } catch {
    return unavailable;
  }
}
export async function verifyRemoteGif(url: string) {
  return (await inspectRemoteGif(url)).ok;
}

const MAX_REMOTE_GIF_BYTES = 20 * 1024 * 1024;
const VERIFIED_GIF_TTL_MS = 30 * 60_000;
const verifiedGifUrls = new Map<string, number>();

export async function verifyRemoteGif(url: string) {
  const cachedUntil = verifiedGifUrls.get(url);
  if (cachedUntil && cachedUntil > Date.now()) return true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  timeout.unref();
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: controller.signal,
      headers: { accept: 'image/gif' },
    });
    const contentLength = Number(response.headers.get('content-length'));
    const valid =
      response.ok &&
      response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ===
        'image/gif' &&
      Number.isSafeInteger(contentLength) &&
      contentLength > 0 &&
      contentLength <= MAX_REMOTE_GIF_BYTES;
    if (!valid) return false;
    if (verifiedGifUrls.size >= 500) {
      const oldest = verifiedGifUrls.keys().next().value;
      if (oldest) verifiedGifUrls.delete(oldest);
    }
    verifiedGifUrls.set(url, Date.now() + VERIFIED_GIF_TTL_MS);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSupportedPreviewUrl, resolveLinkPreview } from '../src/link-preview.js';

afterEach(() => vi.unstubAllGlobals());

describe('link previews', () => {
  it('stops an oversized chunked response without trusting content-length', async () => {
    let cancelled = false;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(128 * 1024));
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
      ),
    );
    await expect(resolveLinkPreview('https://youtu.be/chunked1234')).resolves.toBeNull();
    expect(cancelled).toBe(true);
  });
  it('only sends supported public providers to the preview service', () => {
    expect(isSupportedPreviewUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    expect(isSupportedPreviewUrl('https://ru.wikipedia.org/wiki/Москва')).toBe(true);
    expect(isSupportedPreviewUrl('http://127.0.0.1/admin')).toBe(false);
    expect(isSupportedPreviewUrl('file:///etc/passwd')).toBe(false);
  });

  it('normalizes a YouTube preview without fetching the user supplied host', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ title: 'Тестовый ролик', author_name: 'Автор' }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(resolveLinkPreview('https://youtu.be/abcDEF12345?t=10')).resolves.toEqual({
      url: 'https://www.youtube.com/watch?v=abcDEF12345',
      provider: 'YouTube',
      title: 'Тестовый ролик',
      description: 'Автор',
      imageUrl: 'https://i.ytimg.com/vi/abcDEF12345/hqdefault.jpg',
    });
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/^https:\/\/www\.youtube\.com\/oembed\?/);
  });
});

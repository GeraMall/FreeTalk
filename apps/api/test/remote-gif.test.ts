import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyRemoteGif } from '../src/remote-gif.js';

afterEach(() => vi.unstubAllGlobals());

describe('remote GIF verification', () => {
  it('accepts a bounded image/gif response after a HEAD request', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 200,
          headers: { 'content-type': 'image/gif', 'content-length': '2578971' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    expect(await verifyRemoteGif('https://upload.wikimedia.org/valid-a.gif')).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://upload.wikimedia.org/valid-a.gif',
      expect.objectContaining({ method: 'HEAD', redirect: 'manual' }),
    );
  });

  it('rejects misleading MIME types and oversized files', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(null, {
            status: 200,
            headers: { 'content-type': 'text/html', 'content-length': '100' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(null, {
            status: 200,
            headers: { 'content-type': 'image/gif', 'content-length': String(21 * 1024 * 1024) },
          }),
        ),
    );

    expect(await verifyRemoteGif('https://upload.wikimedia.org/not-gif-a.gif')).toBe(false);
    expect(await verifyRemoteGif('https://upload.wikimedia.org/too-large-a.gif')).toBe(false);
  });
});

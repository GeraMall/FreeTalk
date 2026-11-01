import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectRemoteGif, verifyRemoteGif } from '../src/remote-gif.js';

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
            headers: { 'content-type': 'image/gif', 'content-length': String(31 * 1024 * 1024) },
          }),
        ),
    );

    expect(await verifyRemoteGif('https://upload.wikimedia.org/not-gif-a.gif')).toBe(false);
    expect(await verifyRemoteGif('https://upload.wikimedia.org/too-large-a.gif')).toBe(false);
  });

  it('does not report an upstream outage as a file-size error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    expect(
      await inspectRemoteGif('https://upload.wikimedia.org/downstream-failure.gif'),
    ).toMatchObject({ ok: false, code: 'GIF_UNAVAILABLE' });
  });
  it('never fetches an unapproved host or a redirect destination', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }),
      );
    vi.stubGlobal('fetch', fetch);
    expect(await verifyRemoteGif('http://127.0.0.1/private.gif')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(await verifyRemoteGif('https://upload.wikimedia.org/redirect-test.gif')).toBe(false);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

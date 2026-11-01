import { afterEach, describe, expect, it, vi } from 'vitest';
import { klipyGif, searchGifs } from './gif-provider';
afterEach(() => vi.unstubAllGlobals());
describe('GIF provider adapter', () => {
  it('chooses a smaller real animation and preserves the provider delivery URL', () => {
    const result = klipyGif({
      id: 1,
      title: 'Реакция',
      slug: 'reaction',
      file: {
        md: { gif: { url: 'https://static.klipy.com/large.gif', size: 35 * 1024 * 1024 } },
        sm: {
          gif: {
            url: 'https://static.klipy.com/small.gif?delivery=keep',
            size: 200000,
            width: 320,
            height: 180,
          },
        },
        xs: { gif: { url: 'https://static.klipy.com/preview.gif?delivery=keep', size: 10000 } },
      },
    });
    expect(result).toMatchObject({
      url: 'https://static.klipy.com/small.gif?delivery=keep',
      previewUrl: 'https://static.klipy.com/preview.gif?delivery=keep',
      alt: 'Реакция',
      attribution: { provider: 'KLIPY' },
    });
  });
  it('rejects untrusted media origins and never proxies search through TRLKA', async () => {
    expect(
      klipyGif({
        id: 1,
        file: { md: { gif: { url: 'https://static.klipy.com.evil.test/a.gif' } } },
      }),
    ).toBeUndefined();
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ result: true, data: { data: [], has_next: false } }));
    vi.stubGlobal('fetch', fetch);
    await searchGifs(
      { provider: 'KLIPY', apiKey: 'fixture-key' },
      'кот',
      1,
      new AbortController().signal,
    );
    expect(String(fetch.mock.calls[0]![0])).toContain(
      'https://api.klipy.com/api/v1/fixture-key/gifs/search?',
    );
    expect(String(fetch.mock.calls[0]![0])).toContain('q=%D0%BA%D0%BE%D1%82');
  });
  it('does not make provider requests before the owner connects a key', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await searchGifs({ provider: null }, '', 1, new AbortController().signal)).toEqual({
      gifs: [],
      hasMore: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAccountMediaCache,
  collectAccountMediaUrls,
  loadAccountMedia,
  peekAccountMedia,
  setActiveAccountMediaScope,
  warmAccountMediaCache,
} from './account-media-cache';

describe('account media cache', () => {
  beforeEach(async () => {
    await clearAccountMediaCache('account-a');
    await clearAccountMediaCache('account-b');
    setActiveAccountMediaScope('account-a');
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('deduplicates downloads and exposes a synchronous memory hit', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(new Blob(['avatar'], { type: 'image/webp' }), {
          status: 200,
          headers: { 'content-type': 'image/webp' },
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const sourceUrl = 'https://api.example.test/avatar.webp?v=1';

    const [first, second] = await Promise.all([
      loadAccountMedia(sourceUrl),
      loadAccountMedia(sourceUrl),
    ]);

    expect(first).toBe(second);
    expect(peekAccountMedia(sourceUrl)).toBe(first);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('keeps cached media isolated between accounts', async () => {
    const sourceUrl = 'https://api.example.test/avatar.webp?v=2';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['avatar'], { type: 'image/png' }), { status: 200 })),
    );
    await loadAccountMedia(sourceUrl, 'account-a');

    expect(peekAccountMedia(sourceUrl, 'account-a')).toBeTruthy();
    expect(peekAccountMedia(sourceUrl, 'account-b')).toBeUndefined();
  });

  it('rejects oversized remote media before storing it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new Blob([], { type: 'image/gif' }), {
            status: 200,
            headers: {
              'content-type': 'image/gif',
              'content-length': String(21 * 1024 * 1024),
            },
          }),
      ),
    );

    await expect(loadAccountMedia('https://upload.wikimedia.org/oversized.gif')).rejects.toThrow(
      'превышает допустимый размер',
    );
  });

  it('evicts the least recently used blobs when the memory byte budget is exceeded', async () => {
    const mediaBytes = 20 * 1024 * 1024;
    let objectUrlSequence = 0;
    const createObjectUrl = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => `blob:cached-${objectUrlSequence++}`);
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const blob = new Blob(['gif'], { type: 'image/gif' });
        Object.defineProperty(blob, 'size', { value: mediaBytes });
        return {
          ok: true,
          headers: new Headers({
            'content-type': 'image/gif',
            'content-length': String(mediaBytes),
          }),
          blob: async () => blob,
        } as Response;
      }),
    );
    const urls = Array.from(
      { length: 4 },
      (_, index) => `https://upload.wikimedia.org/lru-${index}.gif`,
    );

    const firstDisplayUrl = await loadAccountMedia(urls[0]);
    const secondDisplayUrl = await loadAccountMedia(urls[1]);
    await loadAccountMedia(urls[2]);
    expect(peekAccountMedia(urls[0])).toBe(firstDisplayUrl);
    await loadAccountMedia(urls[3]);

    expect(peekAccountMedia(urls[0])).toBe(firstDisplayUrl);
    expect(peekAccountMedia(urls[1])).toBeUndefined();
    expect(peekAccountMedia(urls[2])).toBeTruthy();
    expect(peekAccountMedia(urls[3])).toBeTruthy();
    expect(createObjectUrl).toHaveBeenCalledTimes(4);
    expect(revokeObjectUrl).toHaveBeenCalledWith(secondDisplayUrl);
  });

  it('collects avatars and covers from startup payloads and warms them', async () => {
    const payload = {
      user: { avatarUrl: 'https://api.example.test/user.webp', coverUrl: null },
      chats: [{ avatarUrl: 'https://api.example.test/group.webp' }],
      calls: [{ participants: [{ avatarUrl: 'https://api.example.test/caller.webp' }] }],
      unrelatedUrl: 'https://api.example.test/ignore.webp',
    };
    const urls = collectAccountMediaUrls(payload);
    const fetcher = vi.fn(
      async () => new Response(new Blob(['image'], { type: 'image/webp' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetcher);

    await warmAccountMediaCache('account-a', urls);

    expect([...urls]).toEqual([
      'https://api.example.test/user.webp',
      'https://api.example.test/group.webp',
      'https://api.example.test/caller.webp',
    ]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(peekAccountMedia('https://api.example.test/caller.webp')).toBeTruthy();
  });
});

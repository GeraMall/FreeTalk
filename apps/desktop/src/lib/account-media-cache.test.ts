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

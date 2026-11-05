import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearChatImageCache,
  loadChatImage,
  seedChatImageCache,
  peekChatImageDisplay,
  loadChatImageDisplay,
  rememberChatImageDimensions,
} from './chat-image-cache';

describe('chat image cache', () => {
  beforeEach(async () => {
    await clearChatImageCache('account-a');
    await clearChatImageCache('account-b');
  });
  afterEach(() => vi.restoreAllMocks());

  it('reuses display URLs and measured dimensions, isolates accounts and revokes on clearing', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cached');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const identity = {
      accountId: 'account-a',
      messageId: 'display-a',
      variant: 'thumbnail' as const,
    };
    const options = { ...identity, fetcher: vi.fn(async () => new Blob(['image'])) };
    const first = await loadChatImageDisplay(options);
    rememberChatImageDimensions(identity, 360, 640);
    expect(peekChatImageDisplay(identity)).toEqual({ src: first.src, width: 360, height: 640 });
    expect(peekChatImageDisplay({ ...identity, accountId: 'account-b' })).toBeUndefined();
    expect(create).toHaveBeenCalledOnce();
    await clearChatImageCache('account-a');
    expect(revoke).toHaveBeenCalledWith('blob:cached');
    expect(peekChatImageDisplay(identity)).toBeUndefined();
  });

  it('bounds browser image resources and does not restore expired URLs', () => {
    const create = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => `blob:${Math.random()}`);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    for (let index = 0; index < 66; index++) {
      seedChatImageCache('account-a', `display-${index}`, 'thumbnail', new Blob(['image']), null);
      peekChatImageDisplay({
        accountId: 'account-a',
        messageId: `display-${index}`,
        variant: 'thumbnail',
      });
    }
    expect(create).toHaveBeenCalledTimes(66);
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(
      peekChatImageDisplay({
        accountId: 'account-a',
        messageId: 'display-65',
        variant: 'thumbnail',
        expiresAt: '2000-01-01T00:00:00Z',
      }),
    ).toBeUndefined();
    expect(revoke).toHaveBeenCalledTimes(3);
  });

  it('deduplicates simultaneous authenticated downloads', async () => {
    const blob = new Blob(['image'], { type: 'image/webp' });
    const fetcher = vi.fn(async () => blob);
    const options = {
      accountId: 'account-a',
      messageId: 'message-a',
      variant: 'thumbnail' as const,
      fetcher,
    };

    const [first, second] = await Promise.all([loadChatImage(options), loadChatImage(options)]);

    expect(first).toBe(blob);
    expect(second).toBe(blob);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('uses a seeded outgoing image without another request', async () => {
    const blob = new Blob(['local'], { type: 'image/webp' });
    seedChatImageCache('account-a', 'message-b', 'full', blob, null);
    const fetcher = vi.fn(async () => new Blob(['remote']));

    const result = await loadChatImage({
      accountId: 'account-a',
      messageId: 'message-b',
      variant: 'full',
      fetcher,
    });

    expect(result).toBe(blob);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not share private images between accounts', async () => {
    seedChatImageCache('account-a', 'message-c', 'thumbnail', new Blob(['private-a']), null);
    const remote = new Blob(['private-b']);
    const fetcher = vi.fn(async () => remote);

    const result = await loadChatImage({
      accountId: 'account-b',
      messageId: 'message-c',
      variant: 'thumbnail',
      fetcher,
    });

    expect(result).toBe(remote);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

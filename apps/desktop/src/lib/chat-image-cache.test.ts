import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearChatImageCache, loadChatImage, seedChatImageCache } from './chat-image-cache';

describe('chat image cache', () => {
  beforeEach(async () => {
    await clearChatImageCache('account-a');
    await clearChatImageCache('account-b');
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

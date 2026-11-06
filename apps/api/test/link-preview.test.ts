import { beforeEach, describe, expect, it, vi } from 'vitest';
const fetchPublic = vi.hoisted(() => vi.fn());
vi.mock('../src/safe-preview-fetch.js', async () => ({
  ...(await vi.importActual('../src/safe-preview-fetch.js')),
  fetchPublicPreview: fetchPublic,
}));
import {
  isSupportedPreviewUrl,
  parsePreviewHtml,
  previewVideo,
  resolveLinkPreview,
  resolvePreviewImage,
} from '../src/link-preview.js';
beforeEach(() => {
  fetchPublic.mockReset();
});
describe('link previews', () => {
  it('rejects local destinations and unsupported schemes', () => {
    for (const url of [
      'http://127.1/admin',
      'http://[::1]/',
      'file:///etc/passwd',
      'https://user:pass@example.com/',
      'http://example.com:8080/',
      'http://localhost/',
    ])
      expect(isSupportedPreviewUrl(url)).toBe(false);
    expect(isSupportedPreviewUrl('https://funpay.com/')).toBe(true);
  });
  it('uses a fixed YouTube endpoint, deduplicates requests, and proxies the thumbnail', async () => {
    fetchPublic.mockResolvedValue({
      body: Buffer.from(JSON.stringify({ title: 'Тестовый ролик', author_name: 'Автор' })),
      type: 'application/json',
    });
    const [first, second] = await Promise.all([
      resolveLinkPreview('https://youtu.be/abcDEF12345?t=10'),
      resolveLinkPreview('https://youtu.be/abcDEF12345?t=10'),
    ]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      url: 'https://www.youtube.com/watch?v=abcDEF12345',
      provider: 'YouTube',
      title: 'Тестовый ролик',
      video: { provider: 'YouTube', id: 'abcDEF12345' },
      imageKey: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(fetchPublic).toHaveBeenCalledTimes(1);
    expect(fetchPublic.mock.calls[0]?.[0]).toMatch(/^https:\/\/www\.youtube\.com\/oembed\?/);
    fetchPublic.mockResolvedValue({ body: Buffer.from('png'), type: 'image/png' });
    expect(await resolvePreviewImage(first!.imageKey!)).toMatchObject({ type: 'image/png' });
    expect(fetchPublic.mock.calls[1]?.[0]).toBe('https://i.ytimg.com/vi/abcDEF12345/hqdefault.jpg');
  });
  it('extracts generic metadata as text, decodes entities and resolves relative images', () => {
    const preview = parsePreviewHtml(
      `<title>Fallback</title><meta content="Игра &amp; общение" property="og:title"><meta name='description' content='Описание сайта'><meta property='og:image' content='/cover.png'>`,
      'https://example.com/path',
    );
    expect(preview).toMatchObject({
      title: 'Игра & общение',
      description: 'Описание сайта',
      provider: 'example.com',
      imageKey: expect.any(String),
    });
  });
  it('recognizes Rutube and never accepts an arbitrary embed hostname', () => {
    expect(previewVideo(new URL('https://rutube.ru/video/' + 'a'.repeat(32) + '/'))).toEqual({
      provider: 'Rutube',
      id: 'a'.repeat(32),
    });
    expect(
      previewVideo(new URL('https://youtube.com.evil.invalid/watch?v=abcDEF12345')),
    ).toBeUndefined();
  });
  it('keeps a playable provider card on metadata failure and no broken card for ordinary sites', async () => {
    fetchPublic.mockRejectedValue(new Error('Timeout'));
    const outcome = await resolveLinkPreview(
      'https://rutube.ru/video/' + 'b'.repeat(32) + '/',
    ).catch((error) => {
      throw new Error('Rutube resolver leaked', { cause: error });
    });
    expect(outcome).toMatchObject({ provider: 'Rutube', video: { provider: 'Rutube' } });
    expect(
      await resolveLinkPreview('https://unavailable.example/').catch((error) => {
        throw new Error('Generic resolver leaked', { cause: error });
      }),
    ).toBeNull();
    expect(await resolvePreviewImage('f'.repeat(64))).toBeUndefined();
  });
});

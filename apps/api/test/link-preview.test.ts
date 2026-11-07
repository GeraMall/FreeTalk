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
  previewVkId,
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
    expect(previewVideo(new URL('https://www.youtube.com/live/9aPR9UXI1kY?si=test'))).toEqual({
      provider: 'YouTube',
      id: '9aPR9UXI1kY',
    });
    expect(previewVideo(new URL('https://rutube.ru/video/' + 'a'.repeat(32) + '/'))).toEqual({
      provider: 'Rutube',
      id: 'a'.repeat(32),
    });
    expect(
      previewVideo(new URL('https://youtube.com.evil.invalid/watch?v=abcDEF12345')),
    ).toBeUndefined();
  });
  it('resolves VK covers through the official public oEmbed endpoint without rendering its HTML', async () => {
    fetchPublic.mockResolvedValue({
      body: Buffer.from(
        JSON.stringify({
          response: {
            title: 'VK ролик',
            author_name: 'Канал',
            thumbnail_url: 'https://sun9-49.userapi.com/impg/cover.jpg',
            html: '<script>alert(1)</script>',
          },
        }),
      ),
      type: 'application/json',
    });
    const preview = await resolveLinkPreview('https://vkvideo.ru/video-233694859_456239045');
    expect(preview).toMatchObject({
      provider: 'VK Видео',
      title: 'VK ролик',
      imageUrl: 'https://sun9-49.userapi.com/impg/cover.jpg',
      imageKey: expect.any(String),
    });
    expect(preview).not.toHaveProperty('html');
    expect(fetchPublic.mock.calls[0]?.[0]).toBe(
      'https://api.vk.com/method/video.getOembed?v=5.199&maxwidth=1280&maxheight=720&url=https%3A%2F%2Fvkvideo.ru%2Fvideo-233694859_456239045',
    );
    expect(previewVkId(new URL('https://vk.com/video-123_456?list=test'))).toBe('-123_456');
    expect(previewVkId(new URL('https://vkvideo.ru.evil.invalid/video-123_456'))).toBeUndefined();
  });
  it('preserves a Rutube cover and only permits trusted direct-image fallbacks', () => {
    const html =
      '<meta property="og:title" content="Видео"><meta property="og:image" content="https://pic.rtbcdn.ru/video/cover.jpg">';
    expect(parsePreviewHtml(html, 'https://rutube.ru/video/' + 'c'.repeat(32))).toMatchObject({
      imageUrl: 'https://pic.rtbcdn.ru/video/cover.jpg',
      imageKey: expect.any(String),
    });
    expect(
      parsePreviewHtml(
        html.replace('pic.rtbcdn.ru', 'pic.rtbcdn.ru.evil.invalid'),
        'https://example.com',
      )?.imageUrl,
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

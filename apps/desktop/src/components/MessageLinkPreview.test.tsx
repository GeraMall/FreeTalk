// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../lib/api-client', () => ({
  accountClient: {
    request: vi.fn().mockResolvedValue({ preview: null }),
    linkPreviewImage: vi.fn(),
  },
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
import { messageVideo } from '../lib/message-link-preview';
import { MessageLinkPreviewCard } from './MessageLinkPreview';
import { accountClient } from '../lib/api-client';
afterEach(cleanup);
it('only embeds the two trusted providers with validated identifiers', () => {
  expect(messageVideo('https://youtu.be/abcDEF12345')?.embed).toContain(
    'https://www.youtube-nocookie.com/embed/abcDEF12345',
  );
  expect(messageVideo('https://www.youtube.com/live/9aPR9UXI1kY?si=test')?.thumbnail).toBe(
    'https://i.ytimg.com/vi/9aPR9UXI1kY/hqdefault.jpg',
  );
  expect(messageVideo('https://rutube.ru/video/' + 'a'.repeat(32) + '/')?.embed).toContain(
    'https://rutube.ru/play/embed/',
  );
  for (const url of [
    'https://rutube.ru.evil.com/video/' + 'a'.repeat(32),
    'javascript:alert(1)',
    'https://example.com/embed/abcDEF12345',
  ])
    expect(messageVideo(url)).toBeUndefined();
});
it('loads a YouTube cover directly when the API cannot supply metadata', async () => {
  const page = render(<MessageLinkPreviewCard url="https://www.youtube.com/live/9aPR9UXI1kY" />);
  expect(page.container.querySelector('img')?.src).toBe(
    'https://i.ytimg.com/vi/9aPR9UXI1kY/hqdefault.jpg',
  );
  fireEvent.error(page.container.querySelector('img')!);
  expect(page.container.querySelector('.link-preview-thumbnail.is-unavailable')).toBeTruthy();
  expect(page.getByRole('button', { name: 'Смотреть видео: YouTube' })).toBeTruthy();
});
it.each([
  ['https://rutube.ru/video/' + 'd'.repeat(32), 'Rutube', 'https://pic.rtbcdn.ru/video/cover.jpg'],
  ['https://vkvideo.ru/video-123_456', 'VK Видео', 'https://sun9-49.userapi.com/impg/cover.jpg'],
])('keeps the cover for %s when its image proxy fails', async (url, provider, imageUrl) => {
  vi.mocked(accountClient.request).mockResolvedValueOnce({
    preview: {
      url,
      provider,
      title: 'Обложка видео',
      description: '',
      imageKey: 'missing-image',
      imageUrl,
    },
  });
  vi.mocked(accountClient.linkPreviewImage).mockRejectedValueOnce(new Error('Expired image key'));
  const page = render(<MessageLinkPreviewCard url={url} />);
  await waitFor(() => expect(page.container.querySelector('img')?.src).toBe(imageUrl));
  expect(page.getByText('Обложка видео')).toBeTruthy();
});
it('opens a centered modal, closes and unloads the iframe on Escape, then restores focus', async () => {
  const page = render(<MessageLinkPreviewCard url="https://youtu.be/xyzABC12345" />);
  const button = page.getByRole('button', { name: 'Смотреть видео: YouTube' });
  button.focus();
  fireEvent.click(button);
  expect(page.getByRole('dialog')).toBeTruthy();
  expect(document.querySelector('iframe')?.src).toContain('youtube-nocookie.com/embed/xyzABC12345');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(document.querySelector('iframe')).toBeNull();
  expect(document.activeElement).toBe(button);
});

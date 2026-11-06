// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
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
afterEach(cleanup);
it('only embeds the two trusted providers with validated identifiers', () => {
  expect(messageVideo('https://youtu.be/abcDEF12345')?.embed).toContain(
    'https://www.youtube-nocookie.com/embed/abcDEF12345',
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

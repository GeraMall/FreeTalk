// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
import { EmbeddedVideo } from './EmbeddedVideo';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('controls YouTube playback and seeks the real player from the bottom timeline', async () => {
  const player = {
    playVideo: vi.fn(),
    pauseVideo: vi.fn(),
    seekTo: vi.fn(),
    setVolume: vi.fn(),
    unMute: vi.fn(),
    getCurrentTime: () => 9,
    getDuration: () => 120,
    getPlayerState: () => 1,
    getVolume: () => 70,
    isMuted: () => false,
    destroy: vi.fn(),
  };
  vi.stubGlobal('YT', {
    Player: vi.fn(function (_frame, options) {
      queueMicrotask(() => options.events.onReady());
      return player;
    }),
  });
  const page = render(
    <EmbeddedVideo
      provider="YouTube"
      embed="https://www.youtube-nocookie.com/embed/abcDEF12345?enablejsapi=1"
      title="Видео"
    />,
  );
  await waitFor(() =>
    expect(page.getByRole('slider', { name: 'Перемотка видео' }).getAttribute('max')).toBe('120'),
  );
  expect(page.getByText('0:09')).toBeTruthy();
  const seek = page.getByRole('slider', { name: 'Перемотка видео' });
  fireEvent.change(seek, { target: { value: '80' } });
  fireEvent.pointerUp(seek);
  expect(player.seekTo).toHaveBeenCalledWith(80, true);
  fireEvent.click(page.getByRole('button', { name: 'Пауза' }));
  expect(player.pauseVideo).toHaveBeenCalledOnce();
  fireEvent.change(page.getByRole('slider', { name: 'Громкость видео' }), {
    target: { value: '0.3' },
  });
  expect(player.setVolume).toHaveBeenCalledWith(30);
  page.unmount();
  expect(player.destroy).toHaveBeenCalledOnce();
});
it('uses Rutube events for duration and ignores messages from other windows or origins', async () => {
  const page = render(
    <EmbeddedVideo
      provider="Rutube"
      embed="https://rutube.ru/play/embed/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"
      title="Видео"
    />,
  );
  const frame = page.getByTitle('Видео') as HTMLIFrameElement;
  const send = vi.spyOn(frame.contentWindow!, 'postMessage');
  const receive = (
    type: string,
    data: unknown,
    origin = 'https://rutube.ru',
    source: Window | null = frame.contentWindow,
  ) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { origin, source, data: JSON.stringify({ type, data }) }),
      );
    });
  receive('player:ready', {});
  receive('player:durationChange', { duration: 120 }, 'https://evil.invalid');
  expect(
    page.getByRole('slider', { name: 'Перемотка видео' }).getAttribute('disabled'),
  ).not.toBeNull();
  receive('player:durationChange', { duration: 120 });
  receive('player:currentTime', { time: 9 });
  receive('player:changeState', { state: 'playing' });
  const seek = page.getByRole('slider', { name: 'Перемотка видео' });
  expect(seek.getAttribute('max')).toBe('120');
  fireEvent.change(seek, { target: { value: '30' } });
  fireEvent.pointerUp(seek);
  expect(send).toHaveBeenCalledWith(
    JSON.stringify({ type: 'player:setCurrentTime', data: { time: 30 } }),
    'https://rutube.ru',
  );
  fireEvent.click(page.getByRole('button', { name: 'Пауза' }));
  expect(send).toHaveBeenCalledWith(
    JSON.stringify({ type: 'player:pause', data: {} }),
    'https://rutube.ru',
  );
});

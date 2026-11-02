// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { installMobileViewport } from './mobile-viewport';
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('fits the app above the keyboard and restores the window origin on dismissal', () => {
  vi.useFakeTimers();
  const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 });
  vi.stubGlobal('visualViewport', viewport);
  vi.stubGlobal('innerHeight', 844);
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
    (cb) => setTimeout(() => cb(0), 0) as unknown as number,
  );
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(clearTimeout);
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  document.body.innerHTML = '<div class="mobile-account-shell"><textarea></textarea></div>';
  const stop = installMobileViewport();
  document.querySelector('textarea')!.focus();
  viewport.height = 520;
  viewport.offsetTop = 110;
  viewport.dispatchEvent(new Event('resize'));
  vi.advanceTimersByTime(1);
  expect(document.documentElement.classList.contains('mobile-keyboard-open')).toBe(true);
  expect(document.documentElement.style.getPropertyValue('--trlka-visible-height')).toBe('520px');
  vi.stubGlobal('scrollY', 110);
  viewport.height = 844;
  viewport.offsetTop = 0;
  viewport.dispatchEvent(new Event('resize'));
  vi.advanceTimersByTime(1);
  expect(document.documentElement.classList.contains('mobile-keyboard-open')).toBe(false);
  expect(scroll).toHaveBeenCalledWith(0, 0);
  stop();
});

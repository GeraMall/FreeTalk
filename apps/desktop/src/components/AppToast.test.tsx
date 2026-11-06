// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppToast } from './AppToast';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('fades out and dismisses automatically without restarting on callback updates', () => {
  vi.useFakeTimers();
  const first = vi.fn(),
    latest = vi.fn();
  const page = render(<AppToast message="Звонок завершён" onClose={first} />);
  act(() => vi.advanceTimersByTime(4000));
  page.rerender(<AppToast message="Звонок завершён" onClose={latest} />);
  act(() => vi.advanceTimersByTime(220));
  expect(page.getByRole('status').classList.contains('closing')).toBe(true);
  act(() => vi.advanceTimersByTime(280));
  expect(latest).toHaveBeenCalledOnce();
  expect(first).not.toHaveBeenCalled();
});
it('cancels the previous dismissal when a new notice arrives', () => {
  vi.useFakeTimers();
  const close = vi.fn();
  const page = render(<AppToast message="Первое" onClose={close} />);
  act(() => vi.advanceTimersByTime(4300));
  page.rerender(<AppToast message="Второе" onClose={close} />);
  act(() => vi.advanceTimersByTime(300));
  expect(close).not.toHaveBeenCalled();
  expect(page.getByRole('status').classList.contains('closing')).toBe(false);
  act(() => vi.advanceTimersByTime(4200));
  expect(close).toHaveBeenCalledOnce();
});

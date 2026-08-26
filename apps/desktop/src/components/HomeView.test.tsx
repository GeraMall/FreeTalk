// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TransientNotice } from './HomeView';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TransientNotice', () => {
  it('starts a smooth exit and dismisses itself after four seconds', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { getByRole } = render(
      <TransientNotice message="Комната не найдена" onDismiss={onDismiss} />,
    );
    const notice = getByRole('alert');

    act(() => vi.advanceTimersByTime(3_600));
    expect(notice.classList.contains('closing')).toBe(true);
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(400));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

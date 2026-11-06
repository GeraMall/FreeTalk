// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useSoloCallTimeout } from './use-solo-call-timeout';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const base = {
  roomId: 'room',
  joined: true,
  joining: false,
  selfId: 'self',
  participantIds: ['self'],
  connected: true,
};
it('ends exactly once after five minutes, without extending on rerenders', () => {
  vi.useFakeTimers();
  const onTimeout = vi.fn();
  const view = renderHook((props) => useSoloCallTimeout(props), {
    initialProps: { ...base, onTimeout },
  });
  act(() => vi.advanceTimersByTime(150000));
  view.rerender({ ...base, participantIds: ['self'], onTimeout });
  act(() => vi.advanceTimersByTime(149999));
  expect(onTimeout).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(onTimeout).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(300000));
  expect(onTimeout).toHaveBeenCalledTimes(1);
});
it('never ends a call with another participant and starts fresh after the last peer leaves', () => {
  vi.useFakeTimers();
  const onTimeout = vi.fn();
  const view = renderHook((props) => useSoloCallTimeout(props), {
    initialProps: { ...base, onTimeout },
  });
  act(() => vi.advanceTimersByTime(299999));
  view.rerender({ ...base, participantIds: ['self', 'friend'], onTimeout });
  act(() => vi.advanceTimersByTime(900000));
  expect(onTimeout).not.toHaveBeenCalled();
  view.rerender({ ...base, onTimeout });
  act(() => vi.advanceTimersByTime(299999));
  expect(onTimeout).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(onTimeout).toHaveBeenCalledOnce();
});
it('does not end a disconnected call from an incomplete peer snapshot, and cancels on leaving', () => {
  vi.useFakeTimers();
  const onTimeout = vi.fn();
  const view = renderHook((props) => useSoloCallTimeout(props), {
    initialProps: { ...base, onTimeout },
  });
  view.rerender({ ...base, connected: false, onTimeout });
  act(() => vi.advanceTimersByTime(310000));
  expect(onTimeout).not.toHaveBeenCalled();
  view.rerender({ ...base, participantIds: ['self', 'friend'], onTimeout });
  act(() => vi.advanceTimersByTime(1));
  expect(onTimeout).not.toHaveBeenCalled();
  view.rerender({ ...base, onTimeout });
  act(() => vi.advanceTimersByTime(100000));
  view.unmount();
  act(() => vi.advanceTimersByTime(300000));
  expect(onTimeout).not.toHaveBeenCalled();
});

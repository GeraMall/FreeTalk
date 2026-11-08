// @vitest-environment jsdom
import { useRef } from 'react';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useTypingSender, useVisibleMessageReads, emitChatInteraction } from './chat-interactions';
import { TypingIndicator } from '../components/TypingIndicator';
import translations from './interaction-translations.json';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('throttles typing, stops on idle and blur, and tears down on navigation', () => {
  vi.useFakeTimers();
  const send = vi.fn();
  const hook = renderHook(({ scope }) => useTypingSender(scope, send), {
    initialProps: { scope: 'one' },
  });
  act(() => {
    for (let i = 0; i < 30; i++) hook.result.current(true);
  });
  expect(send.mock.calls).toEqual([[true]]);
  act(() => vi.advanceTimersByTime(2600));
  act(() => hook.result.current(true));
  expect(send.mock.calls).toEqual([[true], [true]]);
  act(() => vi.advanceTimersByTime(3000));
  expect(send.mock.calls.at(-1)).toEqual([false]);
  act(() => hook.result.current(true));
  act(() => window.dispatchEvent(new Event('blur')));
  expect(send.mock.calls.at(-1)).toEqual([false]);
  act(() => hook.result.current(true));
  hook.rerender({ scope: 'two' });
  expect(send.mock.calls.at(-1)).toEqual([false]);
  hook.unmount();
  act(() => vi.advanceTimersByTime(5000));
  expect(send).toHaveBeenCalledTimes(7);
});
it('shows only other people in the current chat, translates and smoothly expires names', () => {
  vi.useFakeTimers();
  const view = render(<TypingIndicator scope="one" selfId="self" />);
  const typing = (userId: string, chatId = 'one', expiresAt = Date.now() + 5000) =>
    emitChatInteraction({ type: 'chat-typing', chatId, userId, name: userId, expiresAt });
  act(() => {
    typing('self');
    typing('Elsewhere', 'two');
    typing('Alex');
    typing('German');
  });
  expect(view.getByText('Alex, German печатают…')).toBeTruthy();
  expect(view.queryByText(/Elsewhere|self/)).toBeNull();
  act(() => typing('German', 'one', 0));
  expect(view.getByText('Alex печатает…')).toBeTruthy();
  act(() => vi.advanceTimersByTime(5100));
  expect(view.container.querySelector('.leaving')).toBeTruthy();
  act(() => vi.advanceTimersByTime(230));
  expect(view.queryByText('Alex печатает…')).toBeNull();
  for (const [source, locales] of Object.entries(translations)) {
    expect(Object.keys(locales)).toHaveLength(6);
    const placeholders = source.match(/\{\w+\}/g) ?? [];
    for (const translation of Object.values(locales))
      expect(translation.match(/\{\w+\}/g) ?? []).toEqual(placeholders);
  }
});
it('marks only genuinely visible messages after dwell, never hidden, unfocused, or under a modal', async () => {
  vi.useFakeTimers();
  let focused = true,
    hidden = false;
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() =>
    hidden ? 'hidden' : 'visible',
  );
  let callback!: IntersectionObserverCallback;
  const observed: Element[] = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: IntersectionObserverCallback) {
        callback = cb;
      }
      observe(el: Element) {
        observed.push(el);
      }
      disconnect() {}
    },
  );
  const send = vi.fn().mockResolvedValue({ ok: true });
  function Fixture() {
    const root = useRef<HTMLDivElement>(null);
    useVisibleMessageReads(root, 'one', 'incoming,own', send);
    return (
      <div ref={root}>
        <div data-message-id="incoming" data-read-eligible="true" />
        <div data-message-id="own" data-read-eligible="false" />
      </div>
    );
  }
  render(<Fixture />);
  expect(observed).toHaveLength(1);
  const intersection = (visible: boolean) =>
    callback(
      [
        {
          target: observed[0],
          isIntersecting: visible,
          intersectionRect: { height: visible ? 80 : 0 },
          boundingClientRect: { height: 100 },
        },
      ] as IntersectionObserverEntry[],
      {} as IntersectionObserver,
    );
  act(() => intersection(true));
  act(() => vi.advanceTimersByTime(599));
  expect(send).not.toHaveBeenCalled();
  hidden = true;
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  act(() => vi.advanceTimersByTime(1000));
  expect(send).not.toHaveBeenCalled();
  hidden = false;
  focused = false;
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  act(() => vi.advanceTimersByTime(1000));
  expect(send).not.toHaveBeenCalled();
  focused = true;
  const modal = document.createElement('dialog');
  modal.setAttribute('open', '');
  document.body.append(modal);
  act(() => window.dispatchEvent(new Event('focus')));
  act(() => vi.advanceTimersByTime(1000));
  expect(send).not.toHaveBeenCalled();
  modal.remove();
  act(() => window.dispatchEvent(new Event('focus')));
  await act(async () => vi.advanceTimersByTime(721));
  expect(send).toHaveBeenCalledExactlyOnceWith(['incoming']);
  act(() => {
    intersection(false);
    intersection(true);
    vi.advanceTimersByTime(1000);
  });
  expect(send).toHaveBeenCalledTimes(1);
});

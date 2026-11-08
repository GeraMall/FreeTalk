import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { accountClient } from './api-client';
export const CHAT_INTERACTION_EVENT = 'trlka-chat-interaction';
export type TypingEvent = {
  type: 'chat-typing';
  chatId: string;
  userId: string;
  name: string;
  expiresAt: number;
};
export function emitChatInteraction(detail: unknown) {
  window.dispatchEvent(new CustomEvent(CHAT_INTERACTION_EVENT, { detail }));
}
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export function useTypingSender(scope: string | undefined, send?: (active: boolean) => void) {
  const change = useRef<(active: boolean) => void>(() => {});
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    if (!scope) return;
    let active = false,
      last = 0,
      timer = 0,
      pending: boolean | undefined,
      writing = false;
    const transmit = async () => {
      if (writing) return;
      writing = true;
      try {
        while (pending !== undefined) {
          const next = pending;
          pending = undefined;
          if (sendRef.current) sendRef.current(next);
          else if (uuid.test(scope))
            await accountClient.request(`/v1/chats/${scope}/typing`, {
              method: 'POST',
              body: JSON.stringify({ active: next }),
            });
        }
      } catch {
        /* Typing is best effort; never interrupt a message or a call. */
      } finally {
        writing = false;
      }
    };
    const publish = (next: boolean) => {
      pending = next;
      void transmit();
    };
    const stop = () => {
      window.clearTimeout(timer);
      if (active) {
        active = false;
        publish(false);
      }
    };
    change.current = (next) => {
      if (!next) {
        stop();
        return;
      }
      const now = Date.now();
      if (!active || now - last >= 2500) {
        active = true;
        last = now;
        publish(true);
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(stop, 3000);
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') stop();
    };
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      stop();
      change.current = () => {};
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [scope]);
  return useCallback((active: boolean) => change.current(active), []);
}

/** A read is sent only after dwell in the visible, focused viewport; never on history fetch. */
export function useVisibleMessageReads(
  root: RefObject<HTMLElement | null>,
  scope: string | undefined,
  signature: string,
  send: (ids: string[]) => Promise<unknown> | void,
) {
  const callback = useRef(send);
  callback.current = send;
  const seen = useRef(new Set<string>()),
    identity = useRef(scope);
  if (identity.current !== scope) {
    identity.current = scope;
    seen.current = new Set();
  }
  useEffect(() => {
    const el = root.current;
    if (!scope || !el || typeof IntersectionObserver === 'undefined') return;
    const visible = new Set<string>(),
      dwell = new Map<string, number>(),
      queue = new Set<string>();
    let batch = 0,
      disposed = false;
    const focused = () =>
      document.visibilityState !== 'hidden' &&
      document.hasFocus() &&
      !document.querySelector('dialog[open],[aria-modal="true"]');
    const flush = () => {
      batch = 0;
      if (disposed || !focused()) return;
      const ids = [...queue].slice(0, 50);
      ids.forEach((id) => {
        queue.delete(id);
        seen.current.add(id);
      });
      if (ids.length)
        Promise.resolve(callback.current(ids)).catch(() => {
          if (!disposed) ids.forEach((id) => seen.current.delete(id));
        });
      if (queue.size) batch = window.setTimeout(flush, 250);
    };
    const schedule = (id: string) => {
      if (seen.current.has(id) || dwell.has(id) || !focused()) return;
      dwell.set(
        id,
        window.setTimeout(() => {
          dwell.delete(id);
          if (!disposed && visible.has(id) && focused()) {
            queue.add(id);
            if (!batch) batch = window.setTimeout(flush, 120);
          }
        }, 600),
      );
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.messageId!;
          if (
            entry.isIntersecting &&
            entry.intersectionRect.height >= Math.min(60, entry.boundingClientRect.height / 2)
          ) {
            visible.add(id);
            schedule(id);
          } else {
            visible.delete(id);
            window.clearTimeout(dwell.get(id));
            dwell.delete(id);
            queue.delete(id);
          }
        }
      },
      { root: el, threshold: [0, 0.25, 0.5, 1] },
    );
    el.querySelectorAll<HTMLElement>('[data-message-id][data-read-eligible="true"]').forEach(
      (node) => observer.observe(node),
    );
    const visibility = () => {
      if (focused()) visible.forEach(schedule);
      else {
        dwell.forEach(window.clearTimeout);
        dwell.clear();
        queue.clear();
      }
    };
    window.addEventListener('focus', visibility);
    window.addEventListener('blur', visibility);
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('focusin', visibility);
    return () => {
      disposed = true;
      observer.disconnect();
      dwell.forEach(window.clearTimeout);
      window.clearTimeout(batch);
      window.removeEventListener('focus', visibility);
      window.removeEventListener('blur', visibility);
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('focusin', visibility);
    };
  }, [root, scope, signature]);
}

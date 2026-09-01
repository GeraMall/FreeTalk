import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

export const ACCOUNT_SIDEBAR_MIN_WIDTH = 240;
export const ACCOUNT_SIDEBAR_MAX_WIDTH = 380;

const ACCOUNT_SIDEBAR_WIDTH_KEY = 'freetalkAccountSidebarWidth';

function defaultAccountSidebarWidth() {
  if (typeof window === 'undefined') return 280;
  return Math.min(300, Math.max(250, window.innerWidth * 0.16));
}

function clampAccountSidebarWidth(width: number) {
  return Math.min(ACCOUNT_SIDEBAR_MAX_WIDTH, Math.max(ACCOUNT_SIDEBAR_MIN_WIDTH, width));
}

function storedAccountSidebarWidth() {
  if (typeof window === 'undefined') return defaultAccountSidebarWidth();
  const stored = Number(window.localStorage.getItem(ACCOUNT_SIDEBAR_WIDTH_KEY));
  return Number.isFinite(stored) && stored > 0
    ? clampAccountSidebarWidth(stored)
    : defaultAccountSidebarWidth();
}

export function useAccountSidebarWidth() {
  const [width, setWidth] = useState(storedAccountSidebarWidth);
  const widthRef = useRef(width);
  const resizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | undefined>(
    undefined,
  );

  const updateWidth = (nextWidth: number) => {
    const next = clampAccountSidebarWidth(nextWidth);
    widthRef.current = next;
    setWidth(next);
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button > 0 || window.innerWidth <= 760) return;
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: widthRef.current,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const activeResize = resizeRef.current;
    if (!activeResize || activeResize.pointerId !== event.pointerId) return;
    updateWidth(activeResize.startWidth + event.clientX - activeResize.startX);
  };

  const finishResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const activeResize = resizeRef.current;
    if (!activeResize || activeResize.pointerId !== event.pointerId) return;
    resizeRef.current = undefined;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    window.localStorage.setItem(ACCOUNT_SIDEBAR_WIDTH_KEY, String(widthRef.current));
  };

  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    updateWidth(widthRef.current + (event.key === 'ArrowLeft' ? -12 : 12));
    window.localStorage.setItem(ACCOUNT_SIDEBAR_WIDTH_KEY, String(widthRef.current));
  };

  const resetWidth = () => {
    updateWidth(defaultAccountSidebarWidth());
    window.localStorage.removeItem(ACCOUNT_SIDEBAR_WIDTH_KEY);
  };

  return {
    width,
    startResize,
    resize,
    finishResize,
    resizeWithKeyboard,
    resetWidth,
  };
}

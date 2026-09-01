import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { ChevronLeft, ChevronRight, Copy, Minus, Square, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { PhysicalPosition } from '@tauri-apps/api/dpi';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { compactVersionLabel } from '../lib/version-label';
import { BrandLogo } from './BrandLogo';

export function CustomTitleBar() {
  const [maximized, setMaximized] = useState(false);
  const appWindow = useMemo(() => getCurrentWindow(), []);
  const windowPosition = useRef({ x: 0, y: 0 });
  const windowScaleFactor = useRef(1);
  const drag = useRef<
    | {
        screenX: number;
        screenY: number;
        originX: number;
        originY: number;
      }
    | undefined
  >(undefined);

  const refreshMaximized = useCallback(async () => {
    setMaximized(await appWindow.isMaximized());
  }, [appWindow]);

  useEffect(() => {
    let disposed = false;
    let stopResize: (() => void) | undefined;
    let stopMove: (() => void) | undefined;
    void Promise.all([appWindow.outerPosition(), appWindow.scaleFactor()])
      .then(([position, scaleFactor]) => {
        windowPosition.current = position;
        windowScaleFactor.current = scaleFactor;
      })
      .catch(() => undefined);
    void appWindow
      .isMaximized()
      .then((value) => {
        if (!disposed) setMaximized(value);
      })
      .catch(() => undefined);
    void appWindow
      .onResized(() => void refreshMaximized().catch(() => undefined))
      .then((unlisten) => {
        if (disposed) unlisten();
        else stopResize = unlisten;
      })
      .catch(() => undefined);
    void appWindow
      .onMoved(({ payload }) => {
        windowPosition.current = payload;
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else stopMove = unlisten;
      })
      .catch(() => undefined);
    const moveWindow = (event: globalThis.MouseEvent) => {
      const active = drag.current;
      if (!active || event.buttons !== 1) return;
      const scaleFactor = windowScaleFactor.current;
      const x = active.originX + (event.screenX - active.screenX) * scaleFactor;
      const y = active.originY + (event.screenY - active.screenY) * scaleFactor;
      windowPosition.current = { x, y };
      void appWindow.setPosition(new PhysicalPosition(x, y)).catch(() => undefined);
    };
    const stopMoving = () => {
      drag.current = undefined;
    };
    window.addEventListener('mousemove', moveWindow);
    window.addEventListener('mouseup', stopMoving);
    return () => {
      disposed = true;
      stopResize?.();
      stopMove?.();
      window.removeEventListener('mousemove', moveWindow);
      window.removeEventListener('mouseup', stopMoving);
    };
  }, [appWindow, refreshMaximized]);

  const toggleMaximize = async () => {
    await appWindow.toggleMaximize();
    await refreshMaximized();
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    void toggleMaximize().catch(() => undefined);
  };

  const handleMouseDown = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    void invoke('main_window_start_dragging').catch(() => undefined);
    drag.current = {
      screenX: event.screenX,
      screenY: event.screenY,
      originX: windowPosition.current.x,
      originY: windowPosition.current.y,
    };
  };

  return (
    <header
      className={`custom-titlebar${maximized ? ' is-maximized' : ''}`}
      onDoubleClick={handleDoubleClick}
      onMouseDown={handleMouseDown}
    >
      <nav className="titlebar-navigation" aria-label="Навигация">
        <button type="button" aria-label="Назад" title="Назад" onClick={() => history.back()}>
          <ChevronLeft size={15} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Вперёд" title="Вперёд" onClick={() => history.forward()}>
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      </nav>
      <div className="titlebar-meta" aria-label="Состояние приложения">
        <span className="titlebar-service-status">
          <i aria-hidden="true" /> Сервисы доступны
        </span>
        <span className="titlebar-version-badge">
          {compactVersionLabel(__FREETALK_APP_VERSION__)}
        </span>
      </div>
      <span className="custom-titlebar-drag" aria-hidden="true" />
      <span className="custom-titlebar-brand">
        <BrandLogo variant="compact" />
      </span>
      <div className="window-controls" aria-label="Управление окном">
        <button
          type="button"
          aria-label="Свернуть"
          title="Свернуть"
          onClick={() => void appWindow.minimize().catch(() => undefined)}
        >
          <Minus size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={maximized ? 'Восстановить' : 'Развернуть'}
          title={maximized ? 'Восстановить' : 'Развернуть'}
          onClick={() => void toggleMaximize().catch(() => undefined)}
        >
          {maximized ? (
            <Copy className="restore-window-icon" size={13} aria-hidden="true" />
          ) : (
            <Square size={12} aria-hidden="true" />
          )}
        </button>
        <button
          className="window-close-control"
          type="button"
          aria-label="Свернуть в фон"
          title="Свернуть в фон"
          onClick={() => void appWindow.close().catch(() => undefined)}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { ChevronLeft, ChevronRight, Copy, Minus, Square, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { BrandLogo } from './BrandLogo';

export function CustomTitleBar() {
  const [maximized, setMaximized] = useState(false);
  const appWindow = useMemo(() => getCurrentWindow(), []);

  const refreshMaximized = useCallback(async () => {
    setMaximized(await appWindow.isMaximized());
  }, [appWindow]);

  useEffect(() => {
    let disposed = false;
    let stopResize: (() => void) | undefined;
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
    return () => {
      disposed = true;
      stopResize?.();
    };
  }, [appWindow, refreshMaximized]);

  const toggleMaximize = async () => {
    await appWindow.toggleMaximize();
    await refreshMaximized();
  };

  const handleDoubleClick = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    void toggleMaximize().catch(() => undefined);
  };

  return (
    <header
      className={`custom-titlebar${maximized ? ' is-maximized' : ''}`}
      data-tauri-drag-region
      onDoubleClick={handleDoubleClick}
    >
      <nav className="titlebar-navigation" aria-label="Навигация">
        <button type="button" aria-label="Назад" title="Назад" onClick={() => history.back()}>
          <ChevronLeft size={15} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Вперёд" title="Вперёд" onClick={() => history.forward()}>
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      </nav>
      <span className="custom-titlebar-drag" data-tauri-drag-region aria-hidden="true" />
      <span className="custom-titlebar-brand" data-tauri-drag-region>
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
          aria-label="Закрыть"
          title="Закрыть"
          onClick={() => void appWindow.close().catch(() => undefined)}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

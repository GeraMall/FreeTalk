import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, ArchiveRestore, Bell, BellOff, Pin, PinOff, Trash2, Ban } from 'lucide-react';
import { t } from '../lib/app-language';

export interface ChatArchiveMenuTarget {
  chatId: string;
  name: string;
  archived: boolean;
  muted?: boolean;
  pinned?: boolean;
  group?: boolean;
  x: number;
  y: number;
  trigger: HTMLElement;
}

export function ChatArchiveMenu({
  target,
  onClose,
  onArchive,
  onManage,
  onDestructive,
}: {
  target: ChatArchiveMenuTarget;
  onClose(): void;
  onArchive(chatId: string, archived: boolean): Promise<void> | void;
  onManage?(chatId: string, action: 'mute' | 'pin'): Promise<void> | void;
  onDestructive?(action: 'delete' | 'block'): void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: target.x, top: target.y });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action: () => Promise<void> | void) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      onClose();
      target.trigger.focus();
    } catch {
      setError(t('Не удалось выполнить действие. Попробуйте ещё раз.'));
    } finally {
      setBusy(false);
    }
  };
  useLayoutEffect(() => {
    const bounds = menuRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setPosition({
      left: Math.max(8, Math.min(target.x, window.innerWidth - bounds.width - 8)),
      top: Math.max(8, Math.min(target.y, window.innerHeight - bounds.height - 8)),
    });
    menuRef.current?.querySelector('button')?.focus();
  }, [target]);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        onClose();
        if (event.key === 'Escape') target.trigger.focus();
      }
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', key);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', key);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose, target]);
  return createPortal(
    <div
      ref={menuRef}
      className="chat-archive-menu"
      role="menu"
      aria-label={target.name}
      style={position}
    >
      {onManage && (
        <>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => void run(() => onManage(target.chatId, 'pin'))}
          >
            {target.pinned ? <PinOff /> : <Pin />}
            {t(target.pinned ? 'Открепить чат' : 'Закрепить чат')}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => void run(() => onManage(target.chatId, 'mute'))}
          >
            {target.muted ? <Bell /> : <BellOff />}
            {t(target.muted ? 'Включить уведомления' : 'Отключить уведомления')}
          </button>
        </>
      )}
      <button
        type="button"
        role="menuitem"
        disabled={busy}
        onClick={() => void run(() => onArchive(target.chatId, !target.archived))}
      >
        {target.archived ? <ArchiveRestore /> : <Archive />}
        {target.archived ? t('Вернуть из архива') : t('В архив')}
      </button>
      {onDestructive && (
        <>
          <button
            type="button"
            className="danger"
            role="menuitem"
            disabled={busy}
            onClick={() => onDestructive('delete')}
          >
            <Trash2 />
            {t(target.group ? 'Покинуть группу' : 'Удалить чат')}
          </button>
          {!target.group && (
            <button
              type="button"
              className="danger"
              role="menuitem"
              disabled={busy}
              onClick={() => onDestructive('block')}
            >
              <Ban />
              {t('Заблокировать')}
            </button>
          )}
        </>
      )}
      {error && <small role="alert">{error}</small>}
    </div>,
    document.body,
  );
}

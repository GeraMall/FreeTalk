import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, ArchiveRestore } from 'lucide-react';
import { t } from '../lib/app-language';

export interface ChatArchiveMenuTarget {
  chatId: string;
  name: string;
  archived: boolean;
  x: number;
  y: number;
  trigger: HTMLElement;
}

export function ChatArchiveMenu({
  target,
  onClose,
  onArchive,
}: {
  target: ChatArchiveMenuTarget;
  onClose(): void;
  onArchive(chatId: string, archived: boolean): Promise<void> | void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: target.x, top: target.y });
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
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          target.trigger.focus();
          void onArchive(target.chatId, !target.archived);
        }}
      >
        {target.archived ? <ArchiveRestore /> : <Archive />}
        {target.archived ? t('Вернуть из архива') : t('В архив')}
      </button>
    </div>,
    document.body,
  );
}

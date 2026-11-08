import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, X } from 'lucide-react';
import { t, appLanguage } from '../lib/app-language';
import { CachedMediaImage } from './CachedMedia';
import { CHAT_INTERACTION_EVENT } from '../lib/chat-interactions';
import './chat-interactions.css';
export interface MessageReader {
  id: string;
  name: string;
  readAt: string | number;
  avatarUrl?: string | null;
  username?: string;
}
export function MessageReadersDialog({
  messageId,
  load,
  readers,
  onClose,
}: {
  messageId: string;
  load?: () => Promise<{ readers: MessageReader[] }>;
  readers?: MessageReader[];
  onClose(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    loader = useRef(load);
  loader.current = load;
  const [loaded, setLoaded] = useState<MessageReader[]>([]),
    [busy, setBusy] = useState(!!load),
    [error, setError] = useState(false);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    let disposed = false,
      sequence = 0;
    const refresh = () => {
      const id = ++sequence;
      if (!loader.current) return;
      void loader
        .current()
        .then((value) => {
          if (!disposed && id === sequence) {
            setLoaded(value.readers);
            setError(false);
          }
        })
        .catch(() => {
          if (!disposed && id === sequence) setError(true);
        })
        .finally(() => {
          if (!disposed && id === sequence) setBusy(false);
        });
    };
    refresh();
    const changed = (e: Event) => {
      const data = (e as CustomEvent).detail;
      if (data.type === 'chat-reads' && data.messageIds.includes(messageId)) refresh();
    };
    window.addEventListener(CHAT_INTERACTION_EVENT, changed);
    return () => {
      disposed = true;
      window.removeEventListener(CHAT_INTERACTION_EVENT, changed);
    };
  }, [messageId]);
  const list = readers ?? loaded;
  return createPortal(
    <dialog
      ref={ref}
      className="message-readers-dialog"
      aria-label={t('Кто просмотрел')}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            onClose();
        }
      }}
    >
      <header>
        <span>
          <Eye size={20} />
          <strong>{t('Кто просмотрел')}</strong>
        </span>
        <button aria-label={t('Закрыть')} onClick={onClose}>
          <X size={19} />
        </button>
      </header>
      {busy ? (
        <p>{t('Загрузка…')}</p>
      ) : error ? (
        <p role="alert">{t('Не удалось загрузить просмотры')}</p>
      ) : list.length ? (
        <div className="message-readers-list">
          {list.map((person) => (
            <div key={person.id}>
              <span className="message-reader-avatar">
                {person.avatarUrl ? (
                  <CachedMediaImage src={person.avatarUrl} alt="" />
                ) : (
                  person.name.slice(0, 1)
                )}
              </span>
              <strong>{person.name}</strong>
              <time dateTime={new Date(person.readAt).toISOString()}>
                {new Intl.DateTimeFormat(appLanguage(), {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                }).format(new Date(person.readAt))}
              </time>
            </div>
          ))}
        </div>
      ) : (
        <p>{t('Просмотры ещё не зафиксированы')}</p>
      )}
    </dialog>,
    document.body,
  );
}

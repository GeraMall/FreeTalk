import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCheck, ChevronRight } from 'lucide-react';
import { t, appLanguage } from '../lib/app-language';
import { CachedMediaImage } from './CachedMedia';
import { CHAT_INTERACTION_EVENT } from '../lib/chat-interactions';
import { accountClient } from '../lib/api-client';
import './chat-interactions.css';
export interface MessageReader {
  id: string;
  name: string;
  readAt: string | number;
  avatarUrl?: string | null;
  username?: string;
}
export interface MessageReceiptSource {
  chatId?: string;
  group: boolean;
  readers?: MessageReader[];
}
const cache = new Map<string, MessageReader[]>();
export function MessageReceiptMenuItem({
  messageId,
  source,
}: {
  messageId: string;
  source: MessageReceiptSource;
}) {
  const key = `${accountClient.user?.id ?? 'local'}:${source.chatId}:${messageId}`;
  const [loaded, setLoaded] = useState<MessageReader[]>(cache.get(key) ?? []),
    [busy, setBusy] = useState(!!source.chatId && !cache.has(key)),
    [error, setError] = useState(false),
    [open, setOpen] = useState(false),
    [position, setPosition] = useState({ left: 0, top: 0 });
  const trigger = useRef<HTMLButtonElement>(null),
    hide = useRef(0);
  useEffect(() => {
    if (!source.chatId) return;
    let disposed = false,
      sequence = 0;
    const refresh = () => {
      const seq = ++sequence;
      void accountClient
        .request<{ readers: MessageReader[] }>(
          `/v1/chats/${source.chatId}/messages/${messageId}/readers`,
        )
        .then((result) => {
          if (disposed || seq !== sequence) return;
          cache.set(key, result.readers);
          if (cache.size > 256) cache.delete(cache.keys().next().value!);
          setLoaded(result.readers);
          setError(false);
        })
        .catch(() => {
          if (!disposed && seq === sequence) setError(true);
        })
        .finally(() => {
          if (!disposed && seq === sequence) setBusy(false);
        });
    };
    refresh();
    const updated = (event: Event) => {
      const data = (event as CustomEvent).detail;
      if (
        data.type === 'chat-reads' &&
        data.chatId === source.chatId &&
        data.messageIds.includes(messageId)
      )
        refresh();
    };
    window.addEventListener(CHAT_INTERACTION_EVENT, updated);
    return () => {
      disposed = true;
      window.removeEventListener(CHAT_INTERACTION_EVENT, updated);
    };
  }, [key, messageId, source.chatId]);
  useEffect(() => () => window.clearTimeout(hide.current), []);
  const readers = source.readers ?? loaded;
  const keep = () => window.clearTimeout(hide.current);
  const closeLater = () => {
    keep();
    hide.current = window.setTimeout(() => setOpen(false), 180);
  };
  const show = () => {
    keep();
    if (!source.group || !readers.length) return;
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(270, window.innerWidth - 20),
      height = Math.min(300, readers.length * 58 + 16);
    const left =
      rect.right + 8 + width <= window.innerWidth - 8
        ? rect.right + 8
        : rect.left - width - 8 >= 8
          ? rect.left - width - 8
          : Math.max(10, window.innerWidth - width - 10);
    const top = Math.max(10, Math.min(rect.top, window.innerHeight - height - 10));
    setPosition({ left, top });
    setOpen(true);
  };
  const count = readers.length;
  const category = new Intl.PluralRules(appLanguage()).select(count);
  const label = busy
    ? t('Загружаем просмотры…')
    : error
      ? t('Не удалось загрузить просмотры')
      : source.group
        ? t(
            category === 'one'
              ? '{count} просмотр'
              : category === 'few'
                ? '{count} просмотра'
                : '{count} просмотров',
            { count },
          )
        : count
          ? t('Просмотрено')
          : t('Ещё не просмотрено');
  const content = (
    <>
      <CheckCheck size={17} />
      <span>{label}</span>
      {source.group && count > 0 && (
        <>
          <span className="message-receipt-avatars" aria-hidden="true">
            {readers.slice(0, 3).map((person) => (
              <ReaderAvatar key={person.id} person={person} />
            ))}
          </span>
          <ChevronRight size={14} />
        </>
      )}
    </>
  );
  return (
    <>
      {source.group && count > 0 ? (
        <button
          ref={trigger}
          type="button"
          role="menuitem"
          className="message-receipt-item"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={show}
          onMouseEnter={show}
          onMouseLeave={closeLater}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              show();
            }
          }}
        >
          {content}
        </button>
      ) : (
        <div
          role="menuitem"
          aria-disabled="true"
          className={`message-receipt-item${!count ? ' not-seen' : ''}`}
        >
          {content}
        </div>
      )}
      {open &&
        source.group &&
        count > 0 &&
        createPortal(
          <section
            data-message-readers="true"
            className="message-readers-popover"
            style={position}
            role="dialog"
            aria-label={t('Кто просмотрел')}
            onMouseEnter={keep}
            onMouseLeave={closeLater}
          >
            {readers.map((person) => (
              <div className="message-reader-row" key={person.id}>
                <ReaderAvatar person={person} />
                <span>
                  <strong>{person.name}</strong>
                  <time dateTime={new Date(person.readAt).toISOString()}>
                    <CheckCheck size={12} />
                    {new Intl.DateTimeFormat(appLanguage(), {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    }).format(new Date(person.readAt))}
                  </time>
                </span>
              </div>
            ))}
          </section>,
          document.body,
        )}
    </>
  );
}
function ReaderAvatar({ person }: { person: MessageReader }) {
  return (
    <span className="message-reader-avatar">
      {person.avatarUrl ? (
        <CachedMediaImage src={person.avatarUrl} alt="" />
      ) : (
        person.name.slice(0, 1)
      )}
    </span>
  );
}

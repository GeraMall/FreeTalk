import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RoomChatMessage } from '@freetalk/protocol';
import { ArrowDown, MessageCircle, Send, X } from 'lucide-react';
import { isNearBottom } from '../lib/chat-scroll';
import { CachedMediaImage } from './CachedMedia';

interface RoomChatPanelProps {
  messages: RoomChatMessage[];
  selfId: string;
  closing?: boolean;
  onClosed?(): void;
  onClose(): void;
  onSend(text: string): boolean;
}

export function RoomChatPanel({
  messages,
  selfId,
  closing = false,
  onClosed,
  onClose,
  onSend,
}: RoomChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [showNewMessages, setShowNewMessages] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const previousCount = useRef(messages.length);

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    const list = listRef.current;
    if (!list) return;
    if (typeof list.scrollTo === 'function') list.scrollTo({ top: list.scrollHeight, behavior });
    else list.scrollTop = list.scrollHeight;
    stickToBottom.current = true;
    setShowNewMessages(false);
  };

  useLayoutEffect(() => {
    scrollToBottom('auto');
    // Opening a panel always starts at the latest message.
  }, []);

  useEffect(() => {
    if (messages.length <= previousCount.current) {
      previousCount.current = messages.length;
      return;
    }
    previousCount.current = messages.length;
    if (stickToBottom.current) scrollToBottom();
    else setShowNewMessages(true);
  }, [messages.length]);

  const submit = () => {
    const text = draft.trim();
    if (!text || !onSend(text)) return;
    setDraft('');
    stickToBottom.current = true;
  };

  return (
    <aside
      className={`room-chat-panel ${closing ? 'closing' : ''}`}
      aria-label="Чат комнаты"
      onAnimationEnd={(event) => {
        if (closing && event.currentTarget === event.target) onClosed?.();
      }}
    >
      <header className="room-chat-header">
        <span className="room-chat-heading-icon">
          <MessageCircle size={18} />
        </span>
        <span>
          <strong>Чат комнаты</strong>
          <small>Исчезнет после завершения звонка</small>
        </span>
        <button aria-label="Закрыть чат комнаты" onClick={onClose}>
          <X size={18} />
        </button>
      </header>

      <div
        className="room-chat-messages"
        ref={listRef}
        onScroll={(event) => {
          stickToBottom.current = isNearBottom(event.currentTarget, 54);
          if (stickToBottom.current) setShowNewMessages(false);
        }}
      >
        {messages.length === 0 ? (
          <div className="room-chat-empty">
            <MessageCircle size={28} />
            <strong>Сообщений пока нет</strong>
            <span>Напишите первое сообщение участникам комнаты.</span>
          </div>
        ) : (
          messages.map((message) => {
            const own = message.participantId === selfId;
            return (
              <article className={`room-chat-message ${own ? 'own' : ''}`} key={message.id}>
                <span className="room-chat-avatar" aria-hidden="true">
                  {message.senderAvatar ? (
                    <CachedMediaImage src={message.senderAvatar} alt="" />
                  ) : (
                    message.senderName.slice(0, 1).toUpperCase()
                  )}
                </span>
                <span className="room-chat-bubble">
                  <span className="room-chat-message-meta">
                    <strong>{own ? 'Вы' : message.senderName}</strong>
                    <time dateTime={new Date(message.timestamp).toISOString()}>
                      {new Date(message.timestamp).toLocaleTimeString('ru-RU', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </span>
                  <span className="room-chat-message-text">{message.text}</span>
                </span>
              </article>
            );
          })
        )}
      </div>

      {showNewMessages && (
        <button className="room-chat-new" onClick={() => scrollToBottom()}>
          <ArrowDown size={14} /> Новые сообщения
        </button>
      )}

      <div className="room-chat-composer">
        <textarea
          aria-label="Сообщение в чат комнаты"
          placeholder="Написать сообщение…"
          maxLength={2_000}
          rows={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return;
            event.preventDefault();
            submit();
          }}
        />
        <button aria-label="Отправить сообщение" disabled={!draft.trim()} onClick={submit}>
          <Send size={17} />
        </button>
      </div>
    </aside>
  );
}

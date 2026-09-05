import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CachedMediaImage } from './CachedMedia';

export interface ChatNotificationPreview {
  sequence: number;
  chatId: string;
  senderName: string;
  avatarUrl?: string | null;
  body: string;
}

export function ChatNotificationStack({
  previews,
  onDismiss,
  onDismissAll,
  onOpen,
}: {
  previews: ChatNotificationPreview[];
  onDismiss(sequence: number): void;
  onDismissAll(): void;
  onOpen(preview: ChatNotificationPreview): void;
}) {
  return (
    <section className="chat-notification-stack" aria-label="Новые сообщения">
      {previews.length > 1 && (
        <button type="button" className="chat-notification-dismiss-all" onClick={onDismissAll}>
          Скрыть все
        </button>
      )}
      {previews.map((preview) => (
        <ChatMessageNotification
          key={preview.sequence}
          preview={preview}
          onDismiss={() => onDismiss(preview.sequence)}
          onOpen={() => onOpen(preview)}
        />
      ))}
    </section>
  );
}

function ChatMessageNotification({
  preview,
  onDismiss,
  onOpen,
}: {
  preview: ChatNotificationPreview;
  onDismiss(): void;
  onOpen(): void;
}) {
  const [closing, setClosing] = useState(false);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const closingTimer = window.setTimeout(() => setClosing(true), 3_000);
    const removeTimer = window.setTimeout(() => onDismissRef.current(), 3_360);
    return () => {
      window.clearTimeout(closingTimer);
      window.clearTimeout(removeTimer);
    };
  }, []);

  return (
    <article className={`chat-message-notification${closing ? ' closing' : ''}`}>
      <button
        type="button"
        className="chat-message-notification-main"
        aria-label={`Сообщение от ${preview.senderName}: ${preview.body}`}
        onClick={onOpen}
      >
        <span className="chat-message-notification-avatar">
          {preview.avatarUrl ? (
            <CachedMediaImage src={preview.avatarUrl} alt="" referrerPolicy="no-referrer" />
          ) : (
            preview.senderName.slice(0, 1).toUpperCase()
          )}
        </span>
        <span className="chat-message-notification-copy">
          <strong>{preview.senderName}</strong>
          <small>{preview.body}</small>
        </span>
      </button>
      <button
        type="button"
        className="chat-message-notification-close"
        aria-label={`Скрыть уведомление от ${preview.senderName}`}
        onClick={onDismiss}
      >
        <X aria-hidden="true" />
      </button>
    </article>
  );
}

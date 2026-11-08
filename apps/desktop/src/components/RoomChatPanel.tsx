import { appLanguage, t } from '../lib/app-language';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RoomChatMessage, RoomChatAttachment } from '@freetalk/protocol';
import {
  ArrowDown,
  MessageCircle,
  Send,
  X,
  Paperclip,
  Download,
  FileText,
  LoaderCircle,
} from 'lucide-react';
import { loadRoomChatFile } from '../lib/room-chat-files';
import { createPortal } from 'react-dom';
import { isNearBottom } from '../lib/chat-scroll';
import { CachedMediaImage } from './CachedMedia';

interface RoomChatPanelProps {
  messages: RoomChatMessage[];
  selfId: string;
  closing?: boolean;
  onClosed?(): void;
  onClose(): void;
  onSend(text: string): boolean;
  fileToken?: string;
  onSendFile?(file: File, caption: string): Promise<boolean>;
}

function fileSize(bytes: number) {
  const divisor = bytes < 1024 ? 1 : bytes < 1024 * 1024 ? 1024 : 1024 * 1024;
  return new Intl.NumberFormat(appLanguage(), {
    style: 'unit',
    unit: divisor === 1 ? 'byte' : divisor === 1024 ? 'kilobyte' : 'megabyte',
    maximumFractionDigits: 1,
  }).format(bytes / divisor);
}

export function RoomChatPanel({
  messages,
  selfId,
  closing = false,
  onClosed,
  onClose,
  onSend,
  fileToken,
  onSendFile,
}: RoomChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [file, setFile] = useState<File>();
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const chooseFile = (next?: File) => {
    if (!next || sendingRef.current) return;
    if (next.size > 10 * 1024 * 1024) {
      setError(t('Файл должен быть не больше 10 МБ'));
      return;
    }
    setError('');
    setFile(next);
  };
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
    if (file && onSendFile && !sendingRef.current) {
      sendingRef.current = true;
      setSending(true);
      setError('');
      void onSendFile(file, text)
        .then((sent) => {
          if (!sent) throw new Error('Не удалось отправить файл');
          setFile(undefined);
          setDraft('');
          stickToBottom.current = true;
        })
        .catch((caught) =>
          setError(caught instanceof Error ? t(caught.message) : t('Не удалось отправить файл')),
        )
        .finally(() => {
          sendingRef.current = false;
          setSending(false);
        });
      return;
    }
    if (sendingRef.current) return;
    if (!text || !onSend(text)) return;
    setDraft('');
    stickToBottom.current = true;
  };

  return (
    <aside
      className={`room-chat-panel ${closing ? 'closing' : ''}`}
      aria-label={t('Чат комнаты')}
      onAnimationEnd={(event) => {
        if (closing && event.currentTarget === event.target) onClosed?.();
      }}
    >
      <header className="room-chat-header">
        <span className="room-chat-heading-icon">
          <MessageCircle size={18} />
        </span>
        <span>
          <strong>{t('Чат комнаты')}</strong>
          <small>{t('Исчезнет после завершения звонка')}</small>
        </span>
        <button aria-label={t('Закрыть чат комнаты')} onClick={onClose}>
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
            <strong>{t('Сообщений пока нет')}</strong>
            <span>{t('Напишите первое сообщение участникам комнаты.')}</span>
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
                    <strong>{own ? t('Вы') : message.senderName}</strong>
                    <time dateTime={new Date(message.timestamp).toISOString()}>
                      {new Date(message.timestamp).toLocaleTimeString('ru-RU', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </span>
                  {message.attachment && fileToken && (
                    <RoomAttachment attachment={message.attachment} token={fileToken} />
                  )}
                  {(!message.attachment || message.text !== message.attachment.name) && (
                    <span className="room-chat-message-text">{message.text}</span>
                  )}
                </span>
              </article>
            );
          })
        )}
      </div>

      {showNewMessages && (
        <button className="room-chat-new" onClick={() => scrollToBottom()}>
          <ArrowDown size={14} /> {t('Новые сообщения')}
        </button>
      )}

      <div className="room-chat-footer">
        {file && (
          <div className="room-chat-file-draft">
            <FileText size={17} />
            <span>
              {file.name}
              <small>{fileSize(file.size)}</small>
            </span>
            <button
              aria-label={t('Убрать вложение')}
              disabled={sending}
              onClick={() => setFile(undefined)}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {error && (
          <p className="room-chat-error" role="alert">
            {error}
          </p>
        )}
        <div
          className="room-chat-composer"
          onDragOver={(event) => {
            if (onSendFile) event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            chooseFile(event.dataTransfer.files[0]);
          }}
        >
          {onSendFile && (
            <>
              <input
                ref={input}
                className="sr-only"
                type="file"
                aria-label={t('Прикрепить файл')}
                disabled={sending}
                onChange={(event) => {
                  chooseFile(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              <button
                className="room-chat-attach"
                aria-label={t('Добавить фото или файл')}
                disabled={sending || !fileToken}
                onClick={() => input.current?.click()}
              >
                <Paperclip size={19} />
              </button>
            </>
          )}
          <textarea
            aria-label={t('Сообщение в чат комнаты')}
            placeholder={t('Написать сообщение…')}
            maxLength={2_000}
            rows={1}
            value={draft}
            disabled={sending}
            onPaste={(event) => {
              const pasted = event.clipboardData.files[0];
              if (pasted && onSendFile) {
                event.preventDefault();
                chooseFile(pasted);
              }
            }}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey) return;
              event.preventDefault();
              submit();
            }}
          />
          <button
            aria-label={t('Отправить сообщение')}
            disabled={sending || (!draft.trim() && !file)}
            onClick={submit}
          >
            {sending ? (
              <LoaderCircle className="room-chat-uploading" size={17} />
            ) : (
              <Send size={17} />
            )}
          </button>
        </div>
      </div>
    </aside>
  );
}

function RoomAttachment({ attachment, token }: { attachment: RoomChatAttachment; token: string }) {
  const [preview, setPreview] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!attachment.image) return;
    const controller = new AbortController();
    let url = '';
    void loadRoomChatFile(attachment.id, token, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setPreview(url);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [attachment.id, attachment.image, token]);
  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [expanded]);
  const download = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const blob = await loadRoomChatFile(attachment.id, token),
        url = URL.createObjectURL(blob),
        link = document.createElement('a');
      link.href = url;
      link.download = attachment.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="room-chat-attachment">
      {attachment.image && preview && (
        <button
          className="room-chat-photo"
          aria-label={t('Открыть фото')}
          onClick={() => setExpanded(true)}
        >
          <img src={preview} alt={attachment.name} />
        </button>
      )}
      <button className="room-chat-download" disabled={busy} onClick={() => void download()}>
        <FileText size={18} />
        <span>
          <strong>{attachment.name}</strong>
          <small>{fileSize(attachment.size)}</small>
        </span>
        {busy ? <LoaderCircle size={17} /> : <Download size={17} />}
      </button>
      {failed && <small role="alert">{t('Файл больше недоступен')}</small>}
      {expanded &&
        preview &&
        createPortal(
          <div
            className="room-chat-photo-viewer"
            role="dialog"
            aria-modal="true"
            aria-label={t('Просмотр фотографии')}
            onClick={() => setExpanded(false)}
          >
            <button aria-label={t('Закрыть')} onClick={() => setExpanded(false)}>
              <X />
            </button>
            <img src={preview} alt={attachment.name} />
          </div>,
          document.body,
        )}
    </span>
  );
}

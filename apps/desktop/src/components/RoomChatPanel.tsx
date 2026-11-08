import { clipboardPng } from '../lib/clipboard-image';
import { appLanguage, t } from '../lib/app-language';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChatActionConfirmDialog } from './ChatActionConfirmDialog';
import type { RoomChatMessage, RoomChatAttachment, RoomChatAction } from '@freetalk/protocol';
import { MessageContextMenu, type MessageContextState, type MessageItem } from './ChatsPage';
import { TypingIndicator } from './TypingIndicator';
import { AppToast } from './AppToast';
import { useTypingSender } from '../lib/chat-interactions';
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
  onSend(text: string, replyTo?: string): boolean;
  fileToken?: string;
  onSendFile?(file: File, caption: string, replyTo?: string): Promise<boolean>;
  onAction?(action: RoomChatAction): void;
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
  onAction,
}: RoomChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [file, setFile] = useState<File>();
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<string>();
  const [menu, setMenu] = useState<MessageContextState>(),
    [reply, setReply] = useState<RoomChatMessage>(),
    [editing, setEditing] = useState<string>(),
    [notice, setNotice] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const hold = useRef<{ timer: number; x: number; y: number } | undefined>(undefined);
  const suppressClick = useRef(false);
  const cancelHold = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = undefined;
  };
  useEffect(
    () => () => {
      if (hold.current) window.clearTimeout(hold.current.timer);
    },
    [],
  );
  const typing = useTypingSender(onAction ? 'room' : undefined, (active) =>
    onAction?.({ kind: 'typing', active }),
  );
  const asMessage = useCallback(
    (m: RoomChatMessage): MessageItem => ({
      id: m.id,
      sender_id: m.participantId,
      display_name: m.senderName,
      body: m.deleted ? t('Сообщение удалено') : m.text,
      kind:
        !onAction || m.deleted
          ? 'system'
          : m.attachment?.image
            ? 'image'
            : m.attachment
              ? 'file'
              : 'text',
      created_at: new Date(m.timestamp).toISOString(),
      expires_at: null,
      pinned_at: m.pinned ? new Date(m.timestamp).toISOString() : null,
      reactions: m.reactions?.map((r) => ({
        emoji: r.emoji,
        count: r.userIds.length,
        userIds: r.userIds,
      })),
    }),
    [onAction],
  );
  const showMenu = (m: RoomChatMessage, x: number, y: number) =>
    setMenu({
      message: asMessage(m),
      x: Math.max(8, Math.min(x, window.innerWidth - 220)),
      y: Math.max(8, Math.min(y, window.innerHeight - 200)),
      expanded: false,
    });
  const menuId = menu?.message.id;
  useEffect(() => {
    if (!menuId) return;
    const close = (e: PointerEvent) => {
      if ((e.target as Element)?.closest?.('[data-message-readers]')) return;
      if (!menuRef.current?.contains(e.target as Node)) setMenu(undefined);
    };
    document.addEventListener('pointerdown', close, true);
    const frame = requestAnimationFrame(() =>
      menuRef.current?.querySelector<HTMLElement>('button')?.focus(),
    );
    return () => {
      document.removeEventListener('pointerdown', close, true);
      cancelAnimationFrame(frame);
    };
  }, [menuId]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenu(undefined);
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, []);
  useEffect(() => {
    setMenu((old) => {
      if (!old) return old;
      const latest = messages.find((m) => m.id === old.message.id);
      return latest && !latest.deleted ? { ...old, message: asMessage(latest) } : undefined;
    });
  }, [messages, asMessage]);
  const copy = async (items: RoomChatMessage[]) => {
    try {
      if (items.length === 1 && items[0]!.attachment?.image && fileToken) {
        const image = loadRoomChatFile(items[0]!.attachment!.id, fileToken).then(clipboardPng);
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })]);
      } else await navigator.clipboard.writeText(items.map((m) => m.text).join('\n'));
      setNotice(t('Скопировано'));
    } catch {
      setError(t('Не удалось скопировать сообщение'));
    }
  };
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
    if (editing) {
      if (text && onAction) {
        onAction({ kind: 'edit', id: editing, text });
        setEditing(undefined);
        setDraft('');
        typing(false);
      }
      return;
    }
    if (file && onSendFile && !sendingRef.current) {
      sendingRef.current = true;
      setSending(true);
      setError('');
      void (reply ? onSendFile(file, text, reply.id) : onSendFile(file, text))
        .then((sent) => {
          if (!sent) throw new Error('Не удалось отправить файл');
          setFile(undefined);
          setDraft('');
          setReply(undefined);
          typing(false);
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
    if (!text || !(reply ? onSend(text, reply.id) : onSend(text))) return;
    setDraft('');
    setReply(undefined);
    typing(false);
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
              <article
                className={`room-chat-message ${own ? 'own' : ''}`}
                key={message.id}
                data-message-id={message.id}
                tabIndex={0}
                onPointerDown={(event) => {
                  cancelHold();
                  if (
                    event.pointerType === 'mouse' ||
                    (event.target as HTMLElement).closest('button,input,textarea,a')
                  )
                    return;
                  const { clientX: x, clientY: y } = event;
                  hold.current = {
                    x,
                    y,
                    timer: window.setTimeout(() => {
                      suppressClick.current = true;
                      showMenu(message, x, y);
                      hold.current = undefined;
                    }, 480),
                  };
                }}
                onPointerMove={(event) => {
                  if (
                    hold.current &&
                    Math.hypot(event.clientX - hold.current.x, event.clientY - hold.current.y) > 8
                  )
                    cancelHold();
                }}
                onPointerUp={cancelHold}
                onPointerCancel={cancelHold}
                onClickCapture={(event) => {
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    event.preventDefault();
                    event.stopPropagation();
                  }
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  showMenu(message, event.clientX, event.clientY);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                    event.preventDefault();
                    const box = event.currentTarget.getBoundingClientRect();
                    showMenu(message, box.left + 40, box.top + 20);
                  }
                }}
              >
                <span className="room-chat-avatar" aria-hidden="true">
                  {message.senderAvatar ? (
                    <CachedMediaImage src={message.senderAvatar} alt="" />
                  ) : (
                    message.senderName.slice(0, 1).toUpperCase()
                  )}
                </span>
                <span className="room-chat-message-content">
                  <span className="room-chat-bubble">
                    <span className="room-chat-message-meta">
                      <strong>{own ? t('Вы') : message.senderName}</strong>
                      <time dateTime={new Date(message.timestamp).toISOString()}>
                        {new Date(message.timestamp).toLocaleTimeString(appLanguage(), {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    </span>
                    {message.replyTo && (
                      <button
                        className="room-chat-reply-preview"
                        onClick={() =>
                          listRef.current
                            ?.querySelector<HTMLElement>(`[data-message-id="${message.replyTo}"]`)
                            ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
                        }
                      >
                        {(() => {
                          const original = messages.find((m) => m.id === message.replyTo);
                          return original?.deleted
                            ? t('Сообщение удалено')
                            : original
                              ? `${original.senderName}: ${original.text}`
                              : t('Сообщение');
                        })()}
                      </button>
                    )}
                    {!message.deleted && message.attachment && fileToken && (
                      <RoomAttachment attachment={message.attachment} token={fileToken} />
                    )}
                    {(!message.attachment || message.text !== message.attachment.name) && (
                      <span className="room-chat-message-text">
                        {message.deleted ? t('Сообщение удалено') : message.text}
                        {message.editedAt && (
                          <small className="room-chat-edited">{t('изменено')}</small>
                        )}
                      </span>
                    )}
                  </span>
                  {!message.deleted && !!message.reactions?.length && (
                    <span
                      className="message-reactions room-chat-message-reactions"
                      aria-label={t('Реакции на сообщение')}
                    >
                      {message.reactions.map((r) => (
                        <button
                          key={r.emoji}
                          className={r.userIds.includes(selfId) ? 'mine' : ''}
                          aria-label={`${r.emoji}: ${r.userIds.length}`}
                          onClick={() =>
                            onAction?.({ kind: 'react', id: message.id, emoji: r.emoji })
                          }
                        >
                          <span>{r.emoji}</span>
                          <b>{r.userIds.length}</b>
                        </button>
                      ))}
                    </span>
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
        <TypingIndicator scope={onAction ? 'room' : undefined} selfId={selfId} />
        {(reply || editing) && (
          <div className="room-chat-reply-draft">
            <span>
              {editing ? t('Изменить') : reply ? `${reply.senderName}: ${reply.text}` : ''}
            </span>
            <button
              aria-label={t('Отмена')}
              onClick={() => {
                setReply(undefined);
                if (editing) setDraft('');
                setEditing(undefined);
              }}
            >
              <X size={15} />
            </button>
          </div>
        )}
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
            ref={composerRef}
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
            onChange={(event) => {
              setDraft(event.target.value);
              typing(!!event.target.value.trim());
            }}
            onBlur={() => typing(false)}
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
      {menu &&
        createPortal(
          <MessageContextMenu
            menuRef={menuRef}
            state={menu}
            accountId={selfId}
            own={menu.message.sender_id === selfId}
            canDelete={!!onAction && menu.message.sender_id === selfId}
            compact
            canPin={false}
            onExpand={() =>
              setMenu((old) =>
                old
                  ? {
                      ...old,
                      expanded: !old.expanded,
                      y: Math.min(old.y, Math.max(8, window.innerHeight - 340)),
                    }
                  : old,
              )
            }
            onReact={(emoji) => {
              onAction?.({ kind: 'react', id: menu.message.id, emoji });
              setMenu(undefined);
            }}
            onReply={() => {
              setEditing(undefined);
              setReply(messages.find((m) => m.id === menu.message.id));
              setMenu(undefined);
              composerRef.current?.focus();
            }}
            onEdit={() => {
              setReply(undefined);
              setEditing(menu.message.id);
              setDraft(menu.message.body);
              setMenu(undefined);
              composerRef.current?.focus();
            }}
            onPin={() => {
              onAction?.({ kind: 'pin', id: menu.message.id, pinned: !menu.message.pinned_at });
              setMenu(undefined);
            }}
            onCopy={() => {
              void copy(messages.filter((m) => m.id === menu.message.id));
              setMenu(undefined);
            }}
            onDelete={() => {
              setDeleting(menu.message.id);
              setMenu(undefined);
            }}
          />,
          document.body,
        )}
      {deleting && (
        <ChatActionConfirmDialog
          title={t('Удалить сообщение?')}
          description={t('Сообщение исчезнет у всех участников этого чата.')}
          confirmLabel="Удалить"
          busy={false}
          error=""
          onCancel={() => setDeleting(undefined)}
          onConfirm={() => {
            onAction?.({ kind: 'delete', id: deleting });
            setDeleting(undefined);
          }}
        />
      )}
      <AppToast message={notice} onClose={() => setNotice('')} />
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

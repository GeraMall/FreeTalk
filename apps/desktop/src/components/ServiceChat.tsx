import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  Bug,
  Lightbulb,
  Send,
  ShieldCheck,
  Sparkles,
  AlertCircle,
} from 'lucide-react';
import { accountClient } from '../lib/api-client';
import { SERVICE_CHAT_UPDATED, type ServiceMessage } from '../lib/service-chat';
import mascot from '../assets/freetalk-mascot.png';
import './service-chat.css';

const actions = [
  { command: '/bug', label: 'Сообщить об ошибке', Icon: Bug },
  { command: '/idea', label: 'Предложить улучшение', Icon: Lightbulb },
  { command: '/subscription', label: 'Подписка', Icon: Sparkles },
];
export function ServiceChat({ onBack }: { onBack(): void }) {
  const [messages, setMessages] = useState<ServiceMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const list = useRef<HTMLDivElement>(null);
  const lastRequest = useRef<{ id: string; body: string } | undefined>(undefined);
  const refresh = useCallback(async () => {
    try {
      const result = await accountClient.request<{ messages: ServiceMessage[] }>(
        '/v1/service-chat/messages',
      );
      setMessages(result.messages);
      setError('');
    } catch {
      setError('Не удалось загрузить служебный чат. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let alive = true;
    void refresh();
    const update = () => {
      if (alive) void refresh();
    };
    window.addEventListener(SERVICE_CHAT_UPDATED, update);
    return () => {
      alive = false;
      window.removeEventListener(SERVICE_CHAT_UPDATED, update);
    };
  }, [refresh]);
  useEffect(() => {
    list.current?.scrollTo?.({ top: list.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);
  const send = async (body: string) => {
    body = body.trim();
    if (!body || busy) return;
    setBusy(true);
    setError('');
    if (lastRequest.current?.body !== body) lastRequest.current = { id: crypto.randomUUID(), body };
    try {
      await accountClient.request('/v1/service-chat/messages', {
        method: 'POST',
        body: JSON.stringify({
          body,
          requestId: lastRequest.current.id,
          version: __FREETALK_APP_VERSION__,
        }),
      });
      lastRequest.current = undefined;
      setText((current) => (current.trim() === body ? '' : current));
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось отправить сообщение');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="service-chat" aria-label="Служебный чат TRLKA">
      <header className="service-chat-header">
        <button className="service-chat-back" aria-label="Вернуться к чатам" onClick={onBack}>
          <ArrowLeft size={20} />
        </button>
        <img src={mascot} alt="" />
        <div>
          <strong>
            TRLKA <span>БОТ</span>
          </strong>
          <small>Уведомления и поддержка</small>
        </div>
        <ShieldCheck aria-label="Официальный служебный чат" />
      </header>
      <div
        className="service-chat-history"
        ref={list}
        role="log"
        aria-live="polite"
        aria-busy={loading}
      >
        <div className="service-chat-intro">
          <Bot size={26} />
          <h2>На связи — TRLKA</h2>
          <p>Здесь уведомления о звонках, сообщения об ошибках и ваши предложения.</p>
        </div>
        {loading ? (
          <p>Загружаем сообщения…</p>
        ) : (
          messages.map((message) => (
            <article
              key={message.id}
              className={`service-chat-message ${message.author} kind-${message.kind}`}
            >
              {message.author === 'bot' && <img src={mascot} alt="TRLKA" />}
              <div>
                {message.kind === 'call-timeout' && (
                  <span className="service-chat-event-label">
                    <ShieldCheck size={14} />
                    Ожидание завершено
                  </span>
                )}
                {message.kind === 'accepted' && (
                  <span className="service-chat-event-label">
                    <ShieldCheck size={14} />
                    Обращение принято
                  </span>
                )}
                <p>{message.body}</p>
                <time dateTime={message.created_at}>
                  {new Date(message.created_at).toLocaleString('ru-RU', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </div>
            </article>
          ))
        )}
      </div>
      <footer className="service-chat-footer">
        {error && (
          <div className="service-chat-error" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
            <button onClick={() => void refresh()}>Повторить</button>
          </div>
        )}
        <div className="service-chat-actions">
          {actions.map(({ command, label, Icon }) => (
            <button key={command} disabled={busy} onClick={() => void send(command)}>
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send(text);
          }}
        >
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={4000}
            rows={2}
            placeholder="Сообщение или /help"
            aria-label="Сообщение боту TRLKA"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send(text);
              }
            }}
          />
          <button type="submit" disabled={busy || !text.trim()} aria-label="Отправить сообщение">
            <Send size={20} />
          </button>
        </form>
        <small>Не отправляйте пароли и коды входа. /cancel — отменить ввод обращения.</small>
      </footer>
    </section>
  );
}

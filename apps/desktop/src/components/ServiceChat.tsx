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
  PanelRightOpen,
  PanelRightClose,
  Search,
  X,
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
  const [profileOpen, setProfileOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const requestVersion = useRef(0);
  const lastRequest = useRef<{ id: string; body: string } | undefined>(undefined);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const result = await accountClient.request<{ messages: ServiceMessage[] }>(
        `/v1/service-chat/messages${search ? `?search=${encodeURIComponent(search)}` : ''}`,
      );
      if (version !== requestVersion.current) return;
      setMessages(result.messages);
      setError('');
    } catch {
      if (version === requestVersion.current)
        setError('Не удалось загрузить служебный чат. Попробуйте ещё раз.');
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [search]);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);
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
    <section
      className={`service-chat${profileOpen ? ' service-profile-open' : ''}`}
      aria-label="Служебный чат TRLKA"
    >
      <header className="service-chat-header">
        <button className="service-chat-back" aria-label="Вернуться к чатам" onClick={onBack}>
          <ArrowLeft size={20} />
        </button>
        <button
          className="service-chat-identity"
          aria-label="Открыть профиль TRLKA"
          onClick={() => setProfileOpen(true)}
        >
          <img src={mascot} alt="" />
          <span>
            <strong>
              TRLKA <span>БОТ</span>
            </strong>
            <small>Уведомления и поддержка</small>
          </span>
        </button>
        <div className="service-chat-tools">
          <button
            aria-label={profileOpen ? 'Скрыть профиль' : 'Показать профиль'}
            aria-pressed={profileOpen}
            onClick={() => setProfileOpen((open) => !open)}
          >
            {profileOpen ? <PanelRightClose size={19} /> : <PanelRightOpen size={19} />}
          </button>
          <label className="service-chat-search">
            <Search size={15} />
            <input
              value={query}
              maxLength={200}
              aria-label="Искать в чате TRLKA"
              placeholder="Искать в «TRLKA»"
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button aria-label="Очистить поиск по сообщениям" onClick={() => setQuery('')}>
                <X size={14} />
              </button>
            )}
          </label>
        </div>
      </header>
      <div
        className="service-chat-history"
        ref={list}
        role="log"
        aria-live="polite"
        aria-busy={loading}
      >
        {!search && (
          <div className="service-chat-intro">
            <Bot size={26} />
            <h2>На связи — TRLKA</h2>
            <p>Здесь уведомления о звонках, сообщения об ошибках и ваши предложения.</p>
          </div>
        )}
        {search && !loading && (
          <p className="service-chat-search-result">
            {messages.length ? `Найдено сообщений: ${messages.length}` : 'Сообщения не найдены'}
          </p>
        )}
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
            rows={1}
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
      </footer>
      {profileOpen && (
        <aside className="chat-profile-panel service-chat-profile" aria-label="Профиль бота TRLKA">
          <button
            className="service-profile-close"
            aria-label="Закрыть профиль TRLKA"
            onClick={() => setProfileOpen(false)}
          >
            <X size={18} />
          </button>
          <div className="chat-profile-island">
            <div className="chat-profile-cover" />
            <div className="chat-profile-avatar">
              <img src={mascot} alt="Логотип TRLKA" />
            </div>
            <section className="chat-profile-identity">
              <h2>
                TRLKA <span className="service-bot-badge">БОТ</span>
              </h2>
              <p>Официальный служебный чат</p>
            </section>
            <section className="chat-profile-block">
              <h3>О БОТЕ</h3>
              <p>Уведомления о звонках, сообщения об ошибках и ваши предложения команде TRLKA.</p>
            </section>
            <section className="chat-profile-block">
              <h3>КОМАНДЫ</h3>
              <p>
                /bug — сообщить об ошибке
                <br />
                /idea — предложить улучшение
                <br />
                /subscription — подписка
                <br />
                /cancel — отменить обращение
                <br />
                /help — помощь
              </p>
            </section>
            <section className="chat-profile-block">
              <h3>ПРЕДЛОЖЕНИЯ</h3>
              <p>Одно предложение за 24 часа. Об ошибках можно сообщать отдельно.</p>
            </section>
            <footer>
              <ShieldCheck size={14} /> Проверенный бот TRLKA
            </footer>
          </div>
        </aside>
      )}
    </section>
  );
}

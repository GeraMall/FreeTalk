import { appLanguage, t } from '../lib/app-language';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
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
import { accountClient, type AccountUser } from '../lib/api-client';
import {
  SERVICE_CHAT_UPDATED,
  localizedServiceBody,
  type ServiceMessage,
} from '../lib/service-chat';
import { ServiceBotAvatar } from './ServiceBotAvatar';
import { ChatAvatar } from './ChatsPage';
import './service-chat.css';

const actions = [
  { command: '/bug', label: 'Сообщить об ошибке', Icon: Bug },
  { command: '/idea', label: 'Предложить улучшение', Icon: Lightbulb },
  { command: '/subscription', label: 'Подписка', Icon: Sparkles },
  { command: '/cancel', label: 'Отмена', Icon: X },
];
export interface ServiceChatCache {
  snapshot?: { messages: ServiceMessage[]; fetchedAt: number };
}
export function ServiceChat({
  user,
  onBack,
  cache,
}: {
  user: Pick<AccountUser, 'displayName' | 'username' | 'avatarUrl'>;
  onBack(): void;
  cache?: ServiceChatCache;
}) {
  const [messages, setMessages] = useState<ServiceMessage[]>(() => cache?.snapshot?.messages ?? []);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!cache?.snapshot);
  const [profileOpen, setProfileOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const initialPositioned = useRef(false);
  const followLatest = useRef(true);
  const lastVisibleMessage = useRef<string | undefined>(undefined);
  const snapshotSearch = useRef(search);
  const requestVersion = useRef(0);
  const lastRequest = useRef<{ id: string; body: string } | undefined>(undefined);
  const refresh = useCallback(
    async (force = false) => {
      const version = ++requestVersion.current;
      try {
        const retained = !search && !force ? cache?.snapshot : undefined;
        const result =
          retained && Date.now() - retained.fetchedAt < 30_000
            ? retained
            : await accountClient.request<{ messages: ServiceMessage[] }>(
                `/v1/service-chat/messages${search ? `?search=${encodeURIComponent(search)}` : ''}`,
              );
        if (version !== requestVersion.current) return;
        if (cache && !search)
          cache.snapshot = {
            messages: result.messages,
            fetchedAt: retained === result ? retained.fetchedAt : Date.now(),
          };
        if (snapshotSearch.current !== search) initialPositioned.current = false;
        snapshotSearch.current = search;
        setMessages(result.messages);
        setError('');
      } catch {
        if (version === requestVersion.current)
          setError('Не удалось загрузить служебный чат. Попробуйте ещё раз.');
      } finally {
        if (version === requestVersion.current) setLoading(false);
      }
    },
    [cache, search],
  );
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    let alive = true;
    void refresh();
    const update = () => {
      if (alive) void refresh(true);
    };
    window.addEventListener(SERVICE_CHAT_UPDATED, update);
    return () => {
      alive = false;
      requestVersion.current += 1;
      window.removeEventListener(SERVICE_CHAT_UPDATED, update);
    };
  }, [refresh]);
  useLayoutEffect(() => {
    const element = list.current;
    if (!element || loading) return;
    const lastId = messages.at(-1)?.id;
    if (!initialPositioned.current) {
      element.scrollTo?.({ top: element.scrollHeight, behavior: 'instant' });
      initialPositioned.current = true;
      followLatest.current = true;
    } else if (followLatest.current && lastVisibleMessage.current !== lastId) {
      element.scrollTo?.({
        top: element.scrollHeight,
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      });
    }
    lastVisibleMessage.current = lastId;
  }, [loading, messages]);
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
      await refresh(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось отправить сообщение');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className={`service-chat${profileOpen ? ' service-profile-open' : ''}`}
      aria-label={t('Служебный чат TRLKA')}
    >
      <header className="service-chat-header">
        <button className="service-chat-back" aria-label={t('Вернуться к чатам')} onClick={onBack}>
          <ArrowLeft size={20} />
        </button>
        <button
          className="service-chat-identity"
          aria-label={t('Открыть профиль TRLKA')}
          onClick={() => setProfileOpen(true)}
        >
          <ServiceBotAvatar />
          <span>
            <strong>
              TRLKA <span>{t('БОТ')}</span>
            </strong>
            <small>{t('Уведомления и поддержка')}</small>
          </span>
        </button>
        <div className="service-chat-tools">
          <button
            aria-label={profileOpen ? t('Скрыть профиль') : t('Показать профиль')}
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
              aria-label={t('Искать в чате TRLKA')}
              placeholder={t('Искать в «TRLKA»')}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button aria-label={t('Очистить поиск по сообщениям')} onClick={() => setQuery('')}>
                <X size={14} />
              </button>
            )}
          </label>
        </div>
      </header>
      <div
        className="service-chat-history"
        ref={list}
        onScroll={() => {
          const element = list.current;
          if (element)
            followLatest.current =
              element.scrollHeight - element.clientHeight - element.scrollTop < 80;
        }}
        role="log"
        aria-live="polite"
        aria-busy={loading}
      >
        {search && !loading && (
          <p className="service-chat-search-result">
            {messages.length
              ? t('Найдено сообщений: {p0}', { p0: messages.length })
              : t('Сообщения не найдены')}
          </p>
        )}
        {messages.map((message) => (
          <article
            key={message.id}
            className={`service-chat-message ${message.author} kind-${message.kind}`}
          >
            {message.author === 'bot' ? (
              <ServiceBotAvatar alt="TRLKA" />
            ) : (
              <ChatAvatar
                name={user.displayName || user.username}
                avatarUrl={user.avatarUrl}
                group={false}
                compact
              />
            )}
            <div>
              {message.kind === 'call-timeout' && (
                <span className="service-chat-event-label">
                  <ShieldCheck size={14} />
                  {t('Ожидание завершено')}
                </span>
              )}
              {message.kind === 'accepted' && (
                <span className="service-chat-event-label">
                  <ShieldCheck size={14} />
                  {t('Обращение принято')}
                </span>
              )}
              <p>{localizedServiceBody(message)}</p>
              <time dateTime={message.created_at}>
                {new Date(message.created_at).toLocaleString(appLanguage(), {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
            </div>
          </article>
        ))}
      </div>
      <footer className="service-chat-footer">
        {error && (
          <div className="service-chat-error" role="alert">
            <AlertCircle size={16} />
            <span>{t(error)}</span>
            <button onClick={() => void refresh()}>{t('Повторить')}</button>
          </div>
        )}
        <div className="service-chat-actions">
          {actions.map(({ command, label, Icon }) => (
            <button type="button" key={command} disabled={busy} onClick={() => void send(command)}>
              <Icon size={16} />
              {t(label)}
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
            placeholder={t('Сообщение или /help')}
            aria-label={t('Сообщение боту TRLKA')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send(text);
              }
            }}
          />
          <button
            type="submit"
            disabled={busy || !text.trim()}
            aria-label={t('Отправить сообщение')}
          >
            <Send size={20} />
          </button>
        </form>
      </footer>
      {profileOpen && (
        <aside
          className="chat-profile-panel service-chat-profile"
          aria-label={t('Профиль бота TRLKA')}
        >
          <button
            className="service-profile-close"
            aria-label={t('Закрыть профиль TRLKA')}
            onClick={() => setProfileOpen(false)}
          >
            <X size={18} />
          </button>
          <div className="chat-profile-island">
            <div className="chat-profile-cover" />
            <div className="chat-profile-avatar">
              <ServiceBotAvatar alt={t('Логотип TRLKA')} />
            </div>
            <section className="chat-profile-identity">
              <h2>
                TRLKA <span className="service-bot-badge">{t('БОТ')}</span>
              </h2>
              <p>{t('Официальный служебный чат')}</p>
            </section>
            <section className="chat-profile-block">
              <h3>{t('О БОТЕ')}</h3>
              <p>
                {t('Уведомления о звонках, сообщения об ошибках и ваши предложения команде TRLKA.')}
              </p>
            </section>
            <section className="chat-profile-block">
              <h3>{t('КОМАНДЫ')}</h3>
              <p>
                {t('/bug — сообщить об ошибке')}
                <br />
                {t('/idea — предложить улучшение')}
                <br />
                {t('/subscription — подписка')}
                <br />
                {t('/cancel — отменить обращение')}
                <br />
                {t('/help — помощь')}
              </p>
            </section>
            <section className="chat-profile-block">
              <h3>{t('ПРЕДЛОЖЕНИЯ')}</h3>
              <p>{t('Одно предложение за 24 часа. Об ошибках можно сообщать отдельно.')}</p>
            </section>
            <footer>
              <ShieldCheck size={14} /> {t('Проверенный бот TRLKA')}
            </footer>
          </div>
        </aside>
      )}
    </section>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock3, DoorOpen, History, ShieldCheck, Users } from 'lucide-react';
import { accountClient, type AccountUser } from '../lib/api-client';
import { ChatRealtimeClient } from '../lib/chat-realtime';
import { generateRoomCode } from '../lib/room-code';
import { AccountSidebar, type AccountPage } from './AccountSidebar';
import { ChatsPage, type ChatItem, type MessageItem } from './ChatsPage';
import { FriendsPage, type BlockedItem, type FriendItem, type PendingItem } from './FriendsPage';
interface CallItem {
  id: string;
  room_id: string;
  started_at: string;
  duration_seconds: number;
  participants: Array<{ displayName: string; userId?: string | null; avatarUrl?: string | null }>;
}

export function HomeView({
  user,
  busy,
  error,
  onCreateRoom,
  onJoinRoom,
  onSettings,
  onLogout,
  onClearError,
  page: controlledPage,
  onPageChange,
  embedded = false,
}: {
  user: AccountUser;
  busy: boolean;
  error: string;
  onCreateRoom(roomId?: string): void;
  onJoinRoom(code: string): void;
  onSettings(): void;
  onLogout(): void;
  onClearError?(): void;
  page?: AccountPage;
  onPageChange?(page: AccountPage): void;
  embedded?: boolean;
}) {
  const [internalPage, setInternalPage] = useState<AccountPage>('home');
  const page = controlledPage ?? internalPage;
  const [roomCode, setRoomCode] = useState('');
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [blocked, setBlocked] = useState<BlockedItem[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(controlledPage === 'friends');
  const [friendsLoadError, setFriendsLoadError] = useState('');
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [activeChat, setActiveChat] = useState<string>();
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [chatsLoading, setChatsLoading] = useState(controlledPage === 'chats');
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState('');
  const [sentMessageVersion, setSentMessageVersion] = useState(0);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [profileRevision, setProfileRevision] = useState(0);
  const [history, setHistory] = useState<CallItem[]>([]);
  const [localError, setLocalError] = useState('');
  const activeChatRef = useRef(activeChat);

  useEffect(() => {
    activeChatRef.current = activeChat;
  }, [activeChat]);

  useEffect(() => {
    const realtime = new ChatRealtimeClient((event) => {
      if (event.type === 'message-created') {
        setChats((current) =>
          promoteChat(current, event.chatId, event.message).map((chat) =>
            chat.id === event.chatId && activeChatRef.current !== event.chatId
              ? { ...chat, unreadCount: (chat.unreadCount ?? 0) + 1 }
              : chat,
          ),
        );
        if (activeChatRef.current === event.chatId)
          setMessages((current) => appendMessage(current, event.message));
      } else if (event.type === 'history-cleared') {
        if (activeChatRef.current === event.chatId) setMessages([]);
        setChats((current) =>
          current.map((chat) =>
            chat.id === event.chatId
              ? { ...chat, lastMessage: null, lastMessageAt: null, lastMessageKind: null }
              : chat,
          ),
        );
      } else if (event.type === 'retention-changed') {
        setChats((current) =>
          current.map((chat) =>
            chat.id === event.chatId ? { ...chat, retentionHours: event.retentionHours } : chat,
          ),
        );
      } else if (event.type === 'profile-updated') {
        setProfileRevision((revision) => revision + 1);
        void Promise.all([
          accountClient.request<{ chats: ChatItem[] }>('/v1/chats'),
          accountClient.request<{
            friends: FriendItem[];
            pending: PendingItem[];
            blocked: BlockedItem[];
          }>('/v1/friends'),
        ])
          .then(([chatResult, friendResult]) => {
            setChats((current) =>
              chatResult.chats.map((chat) => ({
                ...chat,
                unreadCount: current.find((item) => item.id === chat.id)?.unreadCount,
              })),
            );
            setFriends(friendResult.friends);
            setPending(friendResult.pending);
            setBlocked(friendResult.blocked);
          })
          .catch(() => {
            // The next normal page refresh will retry without interrupting realtime chat.
          });
      }
    });
    realtime.start();
    return () => realtime.stop();
  }, [user.id]);

  const navigatePage = (next: AccountPage) => {
    if (next === 'friends') setFriendsLoading(true);
    if (next === 'chats') setChatsLoading(true);
    setInternalPage(next);
    onPageChange?.(next);
  };

  const loadPage = useCallback(async (next: AccountPage) => {
    setLocalError('');
    if (next === 'friends') {
      setFriendsLoading(true);
      setFriendsLoadError('');
    }
    if (next === 'chats') setChatsLoading(true);
    try {
      if (next === 'friends') {
        const result = await accountClient.request<{
          friends: FriendItem[];
          pending: PendingItem[];
          blocked: BlockedItem[];
        }>('/v1/friends');
        setFriends(result.friends);
        setPending(result.pending);
        setBlocked(result.blocked);
      }
      if (next === 'chats') {
        const [chatResult, friendResult] = await Promise.all([
          accountClient.request<{ chats: ChatItem[] }>('/v1/chats'),
          accountClient.request<{ friends: FriendItem[] }>('/v1/friends'),
        ]);
        setChats(chatResult.chats);
        setFriends(friendResult.friends);
      }
      if (next === 'history')
        setHistory((await accountClient.request<{ calls: CallItem[] }>('/v1/history')).calls);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Ошибка загрузки';
      if (next === 'friends') setFriendsLoadError(message);
      else setLocalError(message);
    } finally {
      if (next === 'friends') setFriendsLoading(false);
      if (next === 'chats') setChatsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPage(page);
  }, [loadPage, page]);

  const loadChatMessages = useCallback(async (chatId: string, silent = false) => {
    if (!silent) {
      setMessagesLoading(true);
      setMessagesError('');
    }
    try {
      const result = await accountClient.request<{ messages: MessageItem[]; hasMore?: boolean }>(
        `/v1/chats/${chatId}/messages`,
      );
      setMessages(result.messages);
      setHasMoreMessages(Boolean(result.hasMore));
      return true;
    } catch (caught) {
      if (!silent)
        setMessagesError(caught instanceof Error ? caught.message : 'Не удалось открыть чат');
      return false;
    } finally {
      if (!silent) setMessagesLoading(false);
    }
  }, []);

  const openChat = async (chatId: string) => {
    setActiveChat(chatId);
    setChats((current) =>
      current.map((chat) => (chat.id === chatId ? { ...chat, unreadCount: 0 } : chat)),
    );
    setMessages([]);
    await loadChatMessages(chatId);
  };

  const loadOlderMessages = async () => {
    if (!activeChat || !hasMoreMessages || !messages[0]) return;
    try {
      const before = encodeURIComponent(messages[0].created_at);
      const result = await accountClient.request<{ messages: MessageItem[]; hasMore: boolean }>(
        `/v1/chats/${activeChat}/messages?before=${before}`,
      );
      setMessages((current) => {
        const known = new Set(current.map((message) => message.id));
        return [...result.messages.filter((message) => !known.has(message.id)), ...current];
      });
      setHasMoreMessages(result.hasMore);
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Не удалось загрузить историю');
    }
  };

  const sendMessage = async (body: string) => {
    if (!activeChat || !body.trim()) return false;
    try {
      const result = await accountClient.request<{ message: MessageItem }>(
        `/v1/chats/${activeChat}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({ body }),
        },
      );
      setMessages((current) => appendMessage(current, result.message));
      setChats((current) => promoteChat(current, activeChat, result.message));
      setSentMessageVersion((version) => version + 1);
      return true;
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Не удалось отправить сообщение');
      return false;
    }
  };

  const startDirectChat = async (friendId: string) => {
    try {
      const result = await accountClient.request<{ chat: { id: string } }>('/v1/chats', {
        method: 'POST',
        body: JSON.stringify({ type: 'direct', memberIds: [friendId] }),
      });
      navigatePage('chats');
      await loadPage('chats');
      await openChat(result.chat.id);
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Не удалось создать чат');
    }
  };

  const createGroup = async (title: string, memberIds: string[]) => {
    if (!title.trim() || !memberIds.length) return false;
    try {
      await accountClient.request('/v1/chats', {
        method: 'POST',
        body: JSON.stringify({ type: 'group', title, memberIds }),
      });
      await loadPage('chats');
      return true;
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Не удалось создать группу');
      return false;
    }
  };

  const createInvite = async () => {
    if (!activeChat) return;
    try {
      const result = await accountClient.request<{ invite: { token: string } }>(
        `/v1/chats/${activeChat}/invites`,
        { method: 'POST', body: JSON.stringify({ expiresInHours: 24, maxUses: 25 }) },
      );
      await navigator.clipboard.writeText(`freetalk://chat/${result.invite.token}`);
      setLocalError('Ссылка-приглашение скопирована');
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Не удалось создать приглашение');
    }
  };

  const joinInvite = async (rawToken: string) => {
    const token = rawToken.replace(/^freetalk:\/\/chat\//, '').trim();
    if (!token) return false;
    try {
      const result = await accountClient.request<{ chatId: string }>(
        `/v1/chat-invites/${token}/join`,
        { method: 'POST' },
      );
      navigatePage('chats');
      await loadPage('chats');
      await openChat(result.chatId);
      return true;
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Приглашение недействительно');
      return false;
    }
  };

  const startChatCall = async () => {
    if (!activeChat) return;
    const roomId = generateRoomCode();
    try {
      await accountClient.request(`/v1/chats/${activeChat}/calls`, {
        method: 'POST',
        body: JSON.stringify({ roomId }),
      });
      onCreateRoom(roomId);
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Не удалось начать звонок');
    }
  };

  const addChatMember = async (username: string) => {
    if (!activeChat || !username.trim()) return false;
    try {
      await accountClient.request(`/v1/chats/${activeChat}/members`, {
        method: 'POST',
        body: JSON.stringify({ username: username.replace(/^@/, '') }),
      });
      await loadPage('chats');
      await loadChatMessages(activeChat, true);
      return true;
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Не удалось добавить участника');
      return false;
    }
  };

  const updateChatRetention = async (retentionHours: 24 | 168 | 720 | null) => {
    if (!activeChat) return;
    try {
      await accountClient.request(`/v1/chats/${activeChat}/retention`, {
        method: 'PATCH',
        body: JSON.stringify({ retentionHours }),
      });
      setChats((current) =>
        current.map((chat) => (chat.id === activeChat ? { ...chat, retentionHours } : chat)),
      );
      await loadChatMessages(activeChat, true);
      setLocalError(`Срок хранения изменён`);
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Не удалось изменить срок хранения');
    }
  };

  const clearChatHistory = async () => {
    if (!activeChat) return;
    try {
      await accountClient.request(`/v1/chats/${activeChat}/messages`, { method: 'DELETE' });
      setMessages([]);
      setChats((current) =>
        current.map((chat) =>
          chat.id === activeChat
            ? { ...chat, lastMessage: null, lastMessageAt: null, lastMessageKind: null }
            : chat,
        ),
      );
      setLocalError('История чата очищена');
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Не удалось очистить историю');
    }
  };

  const blockChatUser = async (userId: string) => {
    await accountClient.request(`/v1/blocks/${userId}`, { method: 'POST' });
    setActiveChat(undefined);
    setMessages([]);
    await loadPage('chats');
    setLocalError('Пользователь заблокирован');
  };

  const leaveChat = async () => {
    if (!activeChat) return;
    await accountClient.request(`/v1/chats/${activeChat}/members/me`, { method: 'DELETE' });
    setActiveChat(undefined);
    setMessages([]);
    await loadPage('chats');
    setLocalError('Вы покинули чат');
  };

  return (
    <main className={embedded ? 'account-view-embedded' : 'account-shell'}>
      {!embedded && (
        <AccountSidebar
          user={user}
          activePage={page}
          onNavigate={(next) => next !== 'room' && navigatePage(next)}
          onSettings={onSettings}
          onLogout={onLogout}
        />
      )}
      <section
        className={`account-content page-enter ${page === 'chats' ? 'account-content-chat' : ''}`}
      >
        <TransientNotice
          message={error || localError}
          onDismiss={() => {
            setLocalError('');
            onClearError?.();
          }}
        />
        {page === 'home' && (
          <div className="home-dashboard">
            <section className="home-hero">
              <p className="eyebrow">СТАБИЛЬНАЯ СВЯЗЬ И РАБОТА БЕЗ VPN!</p>
              <h1>Добрый вечер, {user.displayName}</h1>
              <p>Создайте приватную комнату или войдите по приглашению.</p>
              <div className="home-room-actions">
                <button
                  className="primary home-create"
                  disabled={busy}
                  onClick={() => onCreateRoom()}
                >
                  <DoorOpen /> Создать комнату
                </button>
                <div className="join-row">
                  <input
                    value={roomCode}
                    placeholder="Код или ссылка комнаты"
                    onChange={(event) => setRoomCode(event.target.value)}
                  />
                  <button disabled={busy || !roomCode} onClick={() => onJoinRoom(roomCode)}>
                    Войти
                  </button>
                </div>
              </div>
            </section>
            <div className="home-proof-row" aria-label="Преимущества FreeTalk">
              <span>
                <Users size={17} /> До 6 участников
              </span>
              <span>
                <ShieldCheck size={17} /> Приватный WebRTC
              </span>
              <span>
                <Clock3 size={17} /> Без записи разговоров
              </span>
            </div>
          </div>
        )}
        {page === 'friends' && (
          <FriendsPage
            userId={user.id}
            friends={friends}
            pending={pending}
            blocked={blocked}
            loading={friendsLoading}
            loadError={friendsLoadError}
            onRetry={() => void loadPage('friends')}
            onAdd={async (username) => {
              try {
                await accountClient.request('/v1/friends/requests', {
                  method: 'POST',
                  body: JSON.stringify({ username }),
                });
                await loadPage('friends');
              } catch (caught) {
                setLocalError(
                  caught instanceof Error ? caught.message : 'Не удалось отправить запрос',
                );
              }
            }}
            onAccept={async (requestId) => {
              try {
                await accountClient.request(`/v1/friends/requests/${requestId}/accept`, {
                  method: 'POST',
                });
                await loadPage('friends');
              } catch (caught) {
                setLocalError(
                  caught instanceof Error ? caught.message : 'Не удалось принять запрос',
                );
              }
            }}
            onDecline={async (requestId) => {
              try {
                await accountClient.request(`/v1/friends/requests/${requestId}/decline`, {
                  method: 'POST',
                });
                await loadPage('friends');
              } catch (caught) {
                setLocalError(
                  caught instanceof Error ? caught.message : 'Не удалось отклонить запрос',
                );
              }
            }}
            onMessage={startDirectChat}
            onRemove={async (friendId) => {
              try {
                await accountClient.request(`/v1/friends/${friendId}`, { method: 'DELETE' });
                await loadPage('friends');
              } catch (caught) {
                setLocalError(
                  caught instanceof Error ? caught.message : 'Не удалось удалить друга',
                );
              }
            }}
            onBlock={async (friendId) => {
              try {
                await accountClient.request(`/v1/blocks/${friendId}`, { method: 'POST' });
                await loadPage('friends');
              } catch (caught) {
                setLocalError(
                  caught instanceof Error
                    ? caught.message
                    : 'Не удалось заблокировать пользователя',
                );
              }
            }}
            onUnblock={async (friendId) => {
              try {
                await accountClient.request(`/v1/blocks/${friendId}`, { method: 'DELETE' });
                await loadPage('friends');
              } catch (caught) {
                setLocalError(
                  caught instanceof Error ? caught.message : 'Не удалось снять блокировку',
                );
              }
            }}
          />
        )}
        {page === 'chats' && (
          <ChatsPage
            userId={user.id}
            chats={chats}
            friends={friends.map((friend) => ({
              id: friend.id,
              displayName: friend.displayName ?? friend.display_name,
              avatarUrl: friend.avatarUrl,
            }))}
            activeChatId={activeChat}
            messages={messages}
            chatsLoading={chatsLoading}
            messagesLoading={messagesLoading}
            messagesError={messagesError}
            sentMessageVersion={sentMessageVersion}
            hasMoreMessages={hasMoreMessages}
            profileRevision={profileRevision}
            onOpenChat={openChat}
            onRetryMessages={() => activeChat && void loadChatMessages(activeChat)}
            onLoadOlder={loadOlderMessages}
            onSendMessage={sendMessage}
            onCreateGroup={createGroup}
            onJoinInvite={joinInvite}
            onStartCall={startChatCall}
            onCreateInvite={createInvite}
            onUpdateRetention={updateChatRetention}
            onClearHistory={clearChatHistory}
            onBlockUser={blockChatUser}
            onLeaveChat={leaveChat}
            onAddMember={addChatMember}
            onJoinCall={onJoinRoom}
          />
        )}
        {page === 'history' && (
          <div>
            <Header title="История звонков" subtitle="Содержание разговоров не сохраняется" />
            <div className="history-list">
              {(['Сегодня', 'Вчера', 'Ранее'] as const).map((period) => {
                const calls = history.filter((call) => historyPeriod(call.started_at) === period);
                if (!calls.length) return null;
                return (
                  <section className="history-period" key={period}>
                    <h2>{period}</h2>
                    {calls.map((call) => (
                      <article className="social-card" key={call.id}>
                        <span className="history-participant-avatars" aria-hidden="true">
                          {call.participants.slice(0, 4).map((participant, index) => (
                            <span key={participant.userId ?? `${participant.displayName}-${index}`}>
                              {participant.avatarUrl ? (
                                <img
                                  src={participant.avatarUrl}
                                  alt=""
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                participant.displayName.slice(0, 1).toUpperCase()
                              )}
                            </span>
                          ))}
                        </span>
                        <span>
                          <strong>{new Date(call.started_at).toLocaleString('ru-RU')}</strong>
                          <small>
                            {call.participants
                              .map((participant) => participant.displayName)
                              .join(', ')}{' '}
                            · {Math.max(1, Math.round(call.duration_seconds / 60))} мин
                          </small>
                        </span>
                        <button onClick={() => onCreateRoom()}>Позвонить снова</button>
                      </article>
                    ))}
                  </section>
                );
              })}
            </div>
            {history.length === 0 && (
              <div className="dashboard-empty">
                <span>
                  <History size={24} />
                </span>
                <strong>История звонков пуста</strong>
                <p>Здесь будут отображаться только время, длительность и участники звонков.</p>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

export function TransientNotice({ message, onDismiss }: { message: string; onDismiss(): void }) {
  const [closing, setClosing] = useState(false);
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);
  useEffect(() => {
    if (!message) return;
    setClosing(false);
    const fadeTimer = window.setTimeout(() => setClosing(true), 3_600);
    const dismissTimer = window.setTimeout(() => onDismissRef.current(), 4_000);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(dismissTimer);
    };
  }, [message]);
  if (!message) return null;
  return (
    <div className={`home-transient-notice ${closing ? 'closing' : ''}`} role="alert">
      {message}
    </div>
  );
}

function appendMessage(messages: MessageItem[], message: MessageItem) {
  if (messages.some((current) => current.id === message.id)) return messages;
  return [...messages, message].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

function promoteChat(chats: ChatItem[], chatId: string, message: MessageItem) {
  const changed = chats.find((chat) => chat.id === chatId);
  if (!changed) return chats;
  return [
    {
      ...changed,
      lastMessage: message.body,
      lastMessageAt: message.created_at,
      lastMessageKind: message.kind,
    },
    ...chats.filter((chat) => chat.id !== chatId),
  ];
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="account-page-header">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
    </header>
  );
}

function historyPeriod(startedAt: string): 'Сегодня' | 'Вчера' | 'Ранее' {
  const day = new Date(startedAt);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const callDay = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  if (callDay === today) return 'Сегодня';
  if (callDay === today - 86_400_000) return 'Вчера';
  return 'Ранее';
}

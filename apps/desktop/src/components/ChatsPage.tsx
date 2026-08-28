import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import {
  ArrowDown,
  Ban,
  Check,
  Clock3,
  Link2,
  MessageCircle,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { isNearBottom } from '../lib/chat-scroll';
import { accountClient } from '../lib/api-client';
import type { PresenceStatus } from '@freetalk/protocol';

export interface ChatMember {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  presence?: PresenceStatus;
}

interface ChatProfile {
  id: string;
  username: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  registeredAt: string;
  mutualFriendsCount: number;
  mutualFriends: Array<{ id: string; displayName: string; avatarUrl: string | null }>;
  presence?: PresenceStatus;
}

export interface ChatItem {
  id: string;
  type: 'direct' | 'group';
  title: string | null;
  members: ChatMember[];
  lastMessage?: string | null;
  lastMessageAt?: string | null;
  lastMessageKind?: string | null;
  retentionHours?: 24 | 168 | 720 | null;
  currentUserRole?: 'owner' | 'admin' | 'member';
  unreadCount?: number;
}

export interface MessageItem {
  id: string;
  body: string;
  kind: string;
  sender_id?: string | null;
  username?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  created_at: string;
  expires_at: string | null;
  metadata?: { roomId?: string };
}

interface FriendOption {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
}

interface ChatsPageProps {
  userId: string;
  chats: ChatItem[];
  friends: FriendOption[];
  activeChatId?: string;
  messages: MessageItem[];
  chatsLoading: boolean;
  messagesLoading: boolean;
  messagesError: string;
  sentMessageVersion: number;
  hasMoreMessages?: boolean;
  profileRevision?: number;
  onOpenChat(chatId: string): Promise<void>;
  onRetryMessages(): void;
  onLoadOlder?(): Promise<void>;
  onSendMessage(body: string): Promise<boolean>;
  onCreateGroup(title: string, memberIds: string[]): Promise<boolean>;
  onJoinInvite(token: string): Promise<boolean>;
  onStartCall(): Promise<void>;
  onCreateInvite(): Promise<void>;
  onUpdateRetention(retentionHours: 24 | 168 | 720 | null): Promise<void>;
  onClearHistory(): Promise<void>;
  onBlockUser?(userId: string): Promise<void>;
  onLeaveChat?(): Promise<void>;
  onAddMember(username: string): Promise<boolean>;
  onJoinCall(roomId: string): void;
}

export function ChatsPage({
  userId,
  chats,
  friends,
  activeChatId,
  messages,
  chatsLoading,
  messagesLoading,
  messagesError,
  sentMessageVersion,
  hasMoreMessages = false,
  profileRevision = 0,
  onOpenChat,
  onRetryMessages,
  onLoadOlder = async () => {},
  onSendMessage,
  onCreateGroup,
  onJoinInvite,
  onStartCall,
  onCreateInvite,
  onUpdateRetention,
  onClearHistory,
  onBlockUser = async () => {},
  onLeaveChat = async () => {},
  onAddMember,
  onJoinCall,
}: ChatsPageProps) {
  const [search, setSearch] = useState('');
  const [showGroup, setShowGroup] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showMember, setShowMember] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [inviteToken, setInviteToken] = useState('');
  const [memberUsername, setMemberUsername] = useState('');
  const [actionBusy, setActionBusy] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [showChatSettings, setShowChatSettings] = useState(false);
  const [profileVisible, setProfileVisible] = useState(true);
  const [profile, setProfile] = useState<ChatProfile>();
  const [profileLoading, setProfileLoading] = useState(false);

  const activeChat = chats.find((chat) => chat.id === activeChatId);
  const retentionHours = activeChat?.retentionHours === undefined ? 720 : activeChat.retentionHours;
  const profileTarget = activeChat?.members.find((member) => member.id !== userId);
  const profileTargetId = profileTarget?.id;
  useEffect(() => {
    setConfirmClear(false);
    setShowChatMenu(false);
    setShowChatSettings(false);
  }, [activeChatId]);
  useEffect(() => {
    if (!profileTargetId) {
      setProfile(undefined);
      return;
    }
    let cancelled = false;
    setProfileLoading(true);
    void accountClient
      .request<{ profile: ChatProfile }>(`/v1/users/${profileTargetId}/profile`)
      .then((result) => {
        if (!cancelled) setProfile(result.profile);
      })
      .catch(() => {
        if (!cancelled) setProfile(undefined);
      })
      .finally(() => {
        if (!cancelled) setProfileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profileRevision, profileTargetId]);
  const visibleChats = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ru-RU');
    if (!query) return chats;
    return chats.filter((chat) =>
      chatName(chat, userId).toLocaleLowerCase('ru-RU').includes(query),
    );
  }, [chats, search, userId]);

  const runAction = async (key: string, action: () => Promise<boolean | void>) => {
    if (actionBusy) return false;
    setActionBusy(key);
    try {
      return (await action()) !== false;
    } finally {
      setActionBusy('');
    }
  };

  const createGroup = async () => {
    if (!groupTitle.trim() || groupMembers.length === 0) return;
    const completed = await runAction('group', () => onCreateGroup(groupTitle, groupMembers));
    if (completed) {
      setGroupTitle('');
      setGroupMembers([]);
      setShowGroup(false);
    }
  };

  const joinInvite = async () => {
    if (!inviteToken.trim()) return;
    const completed = await runAction('invite', () => onJoinInvite(inviteToken));
    if (completed) {
      setInviteToken('');
      setShowInvite(false);
    }
  };

  const addMember = async () => {
    if (!memberUsername.trim()) return;
    const completed = await runAction('member', () => onAddMember(memberUsername));
    if (completed) {
      setMemberUsername('');
      setShowMember(false);
    }
  };

  return (
    <div className={`messenger-layout page-enter ${profileVisible ? '' : 'profile-hidden'}`}>
      <aside className="conversation-sidebar" aria-label="Список чатов">
        <header className="conversation-sidebar-header">
          <div>
            <p className="messenger-eyebrow">СООБЩЕНИЯ</p>
            <h1>Чаты</h1>
            <p>Срок хранения задаётся для каждого чата</p>
          </div>
          <button
            className="new-chat-button"
            title="Новый групповой чат"
            aria-label="Новый групповой чат"
            aria-expanded={showGroup}
            onClick={() => setShowGroup((visible) => !visible)}
          >
            <Plus />
          </button>
        </header>

        <label className="conversation-search">
          <Search aria-hidden="true" />
          <span className="sr-only">Поиск по чатам</span>
          <input
            value={search}
            placeholder="Поиск по чатам"
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <button aria-label="Очистить поиск" onClick={() => setSearch('')}>
              <X />
            </button>
          )}
        </label>

        <button
          className="join-chat-button"
          aria-expanded={showInvite}
          onClick={() => setShowInvite((visible) => !visible)}
        >
          <Link2 /> Войти по приглашению
        </button>

        {showInvite && (
          <div className="compact-chat-form chat-popover-card">
            <div>
              <strong>Приглашение в чат</strong>
              <button aria-label="Закрыть" onClick={() => setShowInvite(false)}>
                <X />
              </button>
            </div>
            <input
              value={inviteToken}
              placeholder="Вставьте ссылку или токен"
              onChange={(event) => setInviteToken(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void joinInvite()}
            />
            <button
              disabled={!inviteToken.trim() || actionBusy === 'invite'}
              onClick={() => void joinInvite()}
            >
              Войти
            </button>
          </div>
        )}

        {showGroup && (
          <div className="compact-chat-form group-chat-form">
            <div>
              <strong>Новый групповой чат</strong>
              <button aria-label="Закрыть" onClick={() => setShowGroup(false)}>
                <X />
              </button>
            </div>
            <input
              value={groupTitle}
              maxLength={80}
              placeholder="Название группы"
              onChange={(event) => setGroupTitle(event.target.value)}
            />
            <div className="group-member-options">
              {friends.map((friend) => (
                <label key={friend.id}>
                  <input
                    type="checkbox"
                    checked={groupMembers.includes(friend.id)}
                    onChange={(event) =>
                      setGroupMembers((old) =>
                        event.target.checked
                          ? [...old, friend.id]
                          : old.filter((id) => id !== friend.id),
                      )
                    }
                  />
                  <ChatAvatar
                    name={friend.displayName}
                    group={false}
                    avatarUrl={friend.avatarUrl}
                    compact
                  />
                  <span>{friend.displayName}</span>
                  {groupMembers.includes(friend.id) && <Check />}
                </label>
              ))}
              {friends.length === 0 && <small>Сначала добавьте друзей</small>}
            </div>
            <button
              disabled={!groupTitle.trim() || groupMembers.length === 0 || actionBusy === 'group'}
              onClick={() => void createGroup()}
            >
              <Users /> Создать группу
            </button>
          </div>
        )}

        <div className="conversation-list">
          {chatsLoading ? (
            <ChatListSkeleton />
          ) : visibleChats.length > 0 ? (
            visibleChats.map((chat) => (
              <ChatListItem
                key={chat.id}
                chat={chat}
                userId={userId}
                active={chat.id === activeChatId}
                onClick={() => void onOpenChat(chat.id)}
              />
            ))
          ) : chats.length > 0 ? (
            <div className="conversation-list-empty">
              <Search />
              <strong>Чаты не найдены</strong>
              <small>Попробуйте другой запрос</small>
            </div>
          ) : (
            <div className="conversation-list-empty">
              <MessageCircle />
              <strong>Чатов пока нет</strong>
              <small>Начните личный чат из раздела «Друзья»</small>
              <button onClick={() => setShowGroup(true)}>Новый групповой чат</button>
            </div>
          )}
        </div>
      </aside>

      <section className="active-conversation" aria-label="Активный чат">
        {activeChat ? (
          <>
            <ChatHeader
              chat={activeChat}
              userId={userId}
              showMember={showMember}
              memberUsername={memberUsername}
              actionBusy={actionBusy}
              profileVisible={profileVisible}
              showMenu={showChatMenu}
              onMemberUsername={setMemberUsername}
              onToggleMember={() => setShowMember((visible) => !visible)}
              onAddMember={() => void addMember()}
              onStartCall={() => void runAction('call', onStartCall)}
              onCreateInvite={() => void runAction('create-invite', onCreateInvite)}
              onToggleProfile={() => setProfileVisible((visible) => !visible)}
              onToggleMenu={() => setShowChatMenu((visible) => !visible)}
            />
            {showChatMenu && (
              <div className="chat-actions-popover" role="menu">
                <button onClick={() => setShowChatSettings((visible) => !visible)}>
                  <Clock3 /> Настройки чата
                </button>
                {activeChat.type === 'direct' && profileTarget && (
                  <button
                    className="destructive"
                    onClick={() => void runAction('block', () => onBlockUser(profileTarget.id))}
                  >
                    <Ban /> Заблокировать
                  </button>
                )}
                {activeChat.currentUserRole === 'owner' && (
                  <button
                    className={confirmClear ? 'destructive confirm-clear' : ''}
                    onClick={() => {
                      if (!confirmClear) return setConfirmClear(true);
                      void runAction('clear-history', async () => {
                        await onClearHistory();
                        setConfirmClear(false);
                        setShowChatMenu(false);
                      });
                    }}
                  >
                    <Trash2 /> {confirmClear ? 'Подтвердить очистку' : 'Очистить чат'}
                  </button>
                )}
                <button
                  className="destructive"
                  onClick={() => void runAction('leave', onLeaveChat)}
                >
                  <X /> Покинуть чат
                </button>
                {showChatSettings && (
                  <div className="chat-menu-settings">
                    <span>История: {retentionLabel(retentionHours)}</span>
                    {activeChat.currentUserRole === 'owner' ? (
                      <select
                        aria-label="Срок хранения сообщений"
                        value={retentionHours === null ? 'forever' : String(retentionHours)}
                        onChange={(event) => {
                          const value = event.target.value;
                          const next = value === 'forever' ? null : Number(value);
                          if (next === null || next === 24 || next === 168 || next === 720)
                            void runAction('retention', () => onUpdateRetention(next));
                        }}
                      >
                        <option value="24">24 часа</option>
                        <option value="168">7 дней</option>
                        <option value="720">30 дней</option>
                        <option value="forever">Без ограничения</option>
                      </select>
                    ) : null}
                  </div>
                )}
              </div>
            )}
            <MessageList
              chatId={activeChat.id}
              userId={userId}
              groupChat={activeChat.type === 'group'}
              messages={messages}
              loading={messagesLoading}
              error={messagesError}
              sentMessageVersion={sentMessageVersion}
              hasMore={hasMoreMessages}
              onRetry={onRetryMessages}
              onLoadOlder={onLoadOlder}
              onJoinCall={onJoinCall}
            />
            <MessageComposer disabled={messagesLoading} onSend={onSendMessage} />
          </>
        ) : (
          <ChatEmptyState />
        )}
      </section>
      {activeChat && profileVisible && (
        <ProfilePanel
          profile={profile}
          loading={profileLoading}
          fallback={profileTarget}
          groupTitle={activeChat.type === 'group' ? chatName(activeChat, userId) : undefined}
          members={activeChat.members}
        />
      )}
    </div>
  );
}

function ChatListItem({
  chat,
  userId,
  active,
  onClick,
}: {
  chat: ChatItem;
  userId: string;
  active: boolean;
  onClick(): void;
}) {
  const name = chatName(chat, userId);
  const other = chat.members.find((member) => member.id !== userId);
  const preview = chat.lastMessage
    ? chat.lastMessageKind === 'call'
      ? 'Начат голосовой звонок'
      : chat.lastMessage
    : chat.type === 'group'
      ? `${chat.members.length} участников`
      : 'Откройте беседу';
  return (
    <button
      className={`conversation-card ${active ? 'active' : ''}`}
      aria-label={`${name}. ${preview}`}
      aria-current={active ? 'true' : undefined}
      onClick={onClick}
    >
      <ChatAvatar name={name} group={chat.type === 'group'} avatarUrl={other?.avatarUrl} />
      <span className="conversation-card-copy">
        <strong>{name}</strong>
        <small>
          {chat.type === 'direct' && other
            ? `${presenceLabel(other.presence)} · ${preview}`
            : preview}
        </small>
      </span>
      <span className="conversation-meta">
        {chat.lastMessageAt && <time>{formatConversationTime(chat.lastMessageAt)}</time>}
        {Boolean(chat.unreadCount) && <b>{Math.min(chat.unreadCount ?? 0, 99)}</b>}
      </span>
    </button>
  );
}

function ChatHeader({
  chat,
  userId,
  showMember,
  memberUsername,
  actionBusy,
  profileVisible,
  showMenu,
  onMemberUsername,
  onToggleMember,
  onAddMember,
  onStartCall,
  onCreateInvite,
  onToggleProfile,
  onToggleMenu,
}: {
  chat: ChatItem;
  userId: string;
  showMember: boolean;
  memberUsername: string;
  actionBusy: string;
  profileVisible: boolean;
  showMenu: boolean;
  onMemberUsername(value: string): void;
  onToggleMember(): void;
  onAddMember(): void;
  onStartCall(): void;
  onCreateInvite(): void;
  onToggleProfile(): void;
  onToggleMenu(): void;
}) {
  const name = chatName(chat, userId);
  const other = chat.members.find((member) => member.id !== userId);
  return (
    <header className="active-chat-header">
      <ChatAvatar name={name} group={chat.type === 'group'} avatarUrl={other?.avatarUrl} />
      <div className="active-chat-identity">
        <strong>{name}</strong>
        <small>
          {chat.type === 'group'
            ? `${chat.members.length} участников`
            : other
              ? `@${other.username}`
              : 'Личный чат'}
        </small>
        {chat.type === 'direct' && other && (
          <span className={`chat-presence ${other.presence ?? 'offline'}`}>
            <i /> {presenceLabel(other.presence)}
          </span>
        )}
      </div>
      <div className="active-chat-actions">
        <button
          title="Начать голосовой звонок"
          aria-label="Начать голосовой звонок"
          disabled={actionBusy === 'call'}
          onClick={onStartCall}
        >
          <Phone />
        </button>
        {chat.type === 'group' && (
          <button
            title="Скопировать приглашение"
            aria-label="Скопировать приглашение"
            disabled={actionBusy === 'create-invite'}
            onClick={onCreateInvite}
          >
            <Link2 />
          </button>
        )}
        <button
          title={profileVisible ? 'Скрыть профиль' : 'Показать профиль'}
          aria-label={profileVisible ? 'Скрыть профиль' : 'Показать профиль'}
          aria-pressed={profileVisible}
          onClick={onToggleProfile}
        >
          {profileVisible ? <PanelRightClose /> : <PanelRightOpen />}
        </button>
        {chat.type === 'group' && (
          <button
            title="Добавить участника"
            aria-label="Добавить участника"
            aria-expanded={showMember}
            onClick={onToggleMember}
          >
            <UserPlus />
          </button>
        )}
        <button
          title="Действия с чатом"
          aria-label="Действия с чатом"
          aria-expanded={showMenu}
          onClick={onToggleMenu}
        >
          <MoreHorizontal />
        </button>
      </div>
      {showMember && chat.type === 'group' && (
        <div className="chat-member-popover">
          <input
            value={memberUsername}
            placeholder="@username друга"
            onChange={(event) => onMemberUsername(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && onAddMember()}
          />
          <button
            disabled={!memberUsername.trim() || actionBusy === 'member'}
            onClick={onAddMember}
          >
            Добавить
          </button>
        </div>
      )}
    </header>
  );
}

function ProfilePanel({
  profile,
  loading,
  fallback,
  groupTitle,
  members,
}: {
  profile?: ChatProfile;
  loading: boolean;
  fallback?: ChatMember;
  groupTitle?: string;
  members: ChatMember[];
}) {
  if (loading)
    return (
      <aside className="chat-profile-panel" aria-label="Профиль собеседника" aria-busy="true">
        <div className="profile-panel-skeleton" />
      </aside>
    );
  const name = profile?.displayName ?? fallback?.displayName ?? groupTitle ?? 'Профиль';
  return (
    <aside className="chat-profile-panel" aria-label="Профиль собеседника">
      <div
        className="chat-profile-cover"
        style={profile?.coverUrl ? { backgroundImage: `url(${profile.coverUrl})` } : undefined}
      />
      <div className="chat-profile-avatar">
        {profile?.avatarUrl || fallback?.avatarUrl ? (
          <img src={profile?.avatarUrl ?? fallback?.avatarUrl ?? ''} alt="" />
        ) : (
          name.slice(0, 1).toUpperCase()
        )}
      </div>
      <section className="chat-profile-identity">
        <h2>{name}</h2>
        <p>@{profile?.username ?? fallback?.username ?? 'freetalk'}</p>
        <span className={`chat-presence ${profile?.presence ?? fallback?.presence ?? 'offline'}`}>
          <i /> {presenceLabel(profile?.presence ?? fallback?.presence)}
        </span>
      </section>
      <section className="chat-profile-block">
        <h3>О СЕБЕ</h3>
        <p>{profile?.bio || 'Пользователь пока ничего о себе не рассказал.'}</p>
      </section>
      <section className="chat-profile-block mutual-friends-block">
        <h3>ОБЩИЕ ДРУЗЬЯ</h3>
        <div className="mutual-friend-avatars">
          {(profile?.mutualFriends ?? []).map((friend) => (
            <span title={friend.displayName} key={friend.id}>
              {friend.avatarUrl ? <img src={friend.avatarUrl} alt="" /> : friend.displayName[0]}
            </span>
          ))}
        </div>
        <p>{profile?.mutualFriendsCount ?? 0} общих друзей</p>
      </section>
      {groupTitle && (
        <section className="chat-profile-block">
          <h3>УЧАСТНИКИ ЧАТА</h3>
          <p>
            {members.length} участников · {groupTitle}
          </p>
        </section>
      )}
      {profile?.registeredAt && (
        <footer>
          В FreeTalk с{' '}
          {new Date(profile.registeredAt).toLocaleDateString('ru-RU', {
            month: 'long',
            year: 'numeric',
          })}
        </footer>
      )}
    </aside>
  );
}

function presenceLabel(status: PresenceStatus = 'offline') {
  if (status === 'online') return 'В сети';
  if (status === 'away') return 'Нет на месте';
  if (status === 'dnd') return 'Не беспокоить';
  return 'Не в сети';
}

export function MessageList({
  chatId,
  userId,
  groupChat,
  messages,
  loading,
  error,
  sentMessageVersion,
  hasMore = false,
  onRetry,
  onLoadOlder = async () => {},
  onJoinCall,
}: {
  chatId: string;
  userId: string;
  groupChat: boolean;
  messages: MessageItem[];
  loading: boolean;
  error: string;
  sentMessageVersion: number;
  hasMore?: boolean;
  onRetry(): void;
  onLoadOlder?(): Promise<void>;
  onJoinCall(roomId: string): void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  const previousRef = useRef({
    chatId: '',
    length: 0,
    firstId: '',
    scrollHeight: 0,
    sentMessageVersion: 0,
  });
  const nearBottomRef = useRef(true);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [olderBusy, setOlderBusy] = useState(false);

  const scrollToBottom = useCallback((smooth = false) => {
    const container = scrollRef.current;
    if (!container) return;
    const top = container.scrollHeight;
    if (smooth && typeof container.scrollTo === 'function') {
      container.scrollTo({ top, behavior: 'smooth' });
    } else {
      container.scrollTop = top;
    }
    nearBottomRef.current = true;
    setNewMessageCount(0);
  }, []);

  useLayoutEffect(() => {
    if (loading) return;
    const previous = previousRef.current;
    const container = scrollRef.current;
    const changedChat = previous.chatId !== chatId;
    const added = Math.max(0, messages.length - previous.length);
    const ownMessageSent = previous.sentMessageVersion !== sentMessageVersion;
    const prependedHistory =
      !changedChat &&
      added > 0 &&
      Boolean(previous.firstId) &&
      messages[added]?.id === previous.firstId;

    if (changedChat) {
      scrollToBottom(false);
    } else if (prependedHistory && container) {
      container.scrollTop += container.scrollHeight - previous.scrollHeight;
    } else if (added > 0 || ownMessageSent) {
      if (ownMessageSent || nearBottomRef.current) scrollToBottom(true);
      else setNewMessageCount((count) => count + Math.max(1, added));
    }

    previousRef.current = {
      chatId,
      length: messages.length,
      firstId: messages[0]?.id ?? '',
      scrollHeight: container?.scrollHeight ?? 0,
      sentMessageVersion,
    };
  }, [chatId, loading, messages, scrollToBottom, sentMessageVersion]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (nearBottomRef.current) scrollToBottom(false);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [chatId, scrollToBottom]);

  const onScroll = () => {
    const container = scrollRef.current;
    if (!container) return;
    nearBottomRef.current = isNearBottom(container);
    if (nearBottomRef.current && newMessageCount) setNewMessageCount(0);
    if (container.scrollTop < 80 && hasMore && !olderBusy) {
      setOlderBusy(true);
      void onLoadOlder().finally(() => setOlderBusy(false));
    }
  };

  if (loading) return <MessageSkeleton />;
  if (error)
    return (
      <div className="message-load-error" role="alert">
        <RefreshCw />
        <strong>Не удалось загрузить сообщения</strong>
        <p>{error}</p>
        <button onClick={onRetry}>Повторить</button>
      </div>
    );

  return (
    <div className="message-scroll-shell">
      <div
        className="message-scroll-container"
        ref={scrollRef}
        tabIndex={0}
        aria-label="История сообщений"
        onScroll={onScroll}
      >
        <div className="message-stream" ref={contentRef}>
          {olderBusy && (
            <div className="older-messages-loading">Загружаем предыдущие сообщения…</div>
          )}
          {messages.length === 0 ? (
            <div className="message-history-empty">
              <MessageCircle />
              <strong>Начните разговор</strong>
              <p>Напишите первое сообщение в этом чате.</p>
            </div>
          ) : (
            messages.map((message, index) => {
              const previous = messages[index - 1];
              const showDate = !previous || !isSameDay(previous.created_at, message.created_at);
              const grouped = isGroupedMessage(previous, message);
              return (
                <div className="message-entry" key={message.id}>
                  {showDate && <DateSeparator date={message.created_at} />}
                  {message.kind === 'call' ? (
                    <SystemCallMessage message={message} onJoin={onJoinCall} />
                  ) : message.kind === 'system' ? (
                    <div className="system-message">
                      <span>{message.body}</span>
                      <time>{formatMessageTime(message.created_at)}</time>
                    </div>
                  ) : (
                    <MessageBubble
                      message={message}
                      own={message.sender_id === userId}
                      grouped={grouped}
                      showAuthor={groupChat && !grouped && message.sender_id !== userId}
                    />
                  )}
                </div>
              );
            })
          )}
          <div className="message-bottom-anchor" ref={bottomAnchorRef} aria-hidden="true" />
        </div>
      </div>
      {newMessageCount > 0 && (
        <button className="new-messages-indicator" onClick={() => scrollToBottom(true)}>
          <ArrowDown /> Новые сообщения
          {newMessageCount > 1 && <span>{newMessageCount}</span>}
        </button>
      )}
    </div>
  );
}

function MessageBubble({
  message,
  own,
  grouped,
  showAuthor,
}: {
  message: MessageItem;
  own: boolean;
  grouped: boolean;
  showAuthor: boolean;
}) {
  return (
    <article className={`message-bubble-row ${own ? 'own' : 'remote'} ${grouped ? 'grouped' : ''}`}>
      {!grouped && (
        <ChatAvatar
          name={message.display_name || message.username || 'Участник'}
          group={false}
          avatarUrl={message.avatar_url}
          compact
        />
      )}
      <div className="message-bubble">
        {showAuthor && <strong>{message.display_name || message.username || 'Участник'}</strong>}
        <p>{message.body}</p>
        <time>{formatMessageTime(message.created_at)}</time>
      </div>
    </article>
  );
}

function SystemCallMessage({
  message,
  onJoin,
}: {
  message: MessageItem;
  onJoin(roomId: string): void;
}) {
  return (
    <article className="system-call-message">
      <span className="system-call-icon">
        <Phone />
      </span>
      <div>
        <strong>{message.body}</strong>
        <time>{formatMessageTime(message.created_at)}</time>
      </div>
      {message.metadata?.roomId && (
        <button onClick={() => onJoin(message.metadata!.roomId!)}>Присоединиться</button>
      )}
    </article>
  );
}

function DateSeparator({ date }: { date: string }) {
  return (
    <div className="message-date-separator">
      <span>{formatMessageDate(date)}</span>
    </div>
  );
}

function MessageComposer({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend(body: string): Promise<boolean>;
}) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const send = async () => {
    const body = value.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      if (await onSend(body)) setValue('');
    } finally {
      setSending(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    void send();
  };
  return (
    <div className="modern-message-composer">
      <button
        className="composer-add-button"
        title="Вложения появятся позже"
        aria-label="Добавить вложение"
        disabled
      >
        <Plus />
      </button>
      <textarea
        value={value}
        rows={1}
        maxLength={4000}
        disabled={disabled}
        placeholder="Написать сообщение…"
        aria-label="Сообщение"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <button
        className="send-message-button"
        title="Отправить"
        aria-label="Отправить сообщение"
        disabled={disabled || sending || !value.trim()}
        onClick={() => void send()}
      >
        <Send />
      </button>
      <small>Enter — отправить · Shift+Enter — новая строка</small>
    </div>
  );
}

function ChatEmptyState() {
  return (
    <div className="active-chat-empty">
      <span>
        <MessageCircle />
      </span>
      <strong>Выберите чат</strong>
      <p>Откройте диалог или начните новый.</p>
    </div>
  );
}

function ChatListSkeleton() {
  return (
    <div className="chat-list-skeleton" aria-label="Загрузка чатов" aria-busy="true">
      {[0, 1, 2, 3].map((item) => (
        <div key={item}>
          <i />
          <span>
            <i />
            <i />
          </span>
        </div>
      ))}
    </div>
  );
}

function MessageSkeleton() {
  return (
    <div className="message-skeleton" aria-label="Загрузка сообщений" aria-busy="true">
      {[45, 62, 38, 55, 70].map((width, index) => (
        <i
          className={index % 2 ? 'own' : ''}
          style={{ '--bubble-width': `${width}%` } as CSSProperties}
          key={`${width}-${index}`}
        />
      ))}
    </div>
  );
}

function ChatAvatar({
  name,
  group,
  avatarUrl,
  compact = false,
}: {
  name: string;
  group: boolean;
  avatarUrl?: string | null;
  compact?: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [avatarUrl]);
  const showImage = Boolean(avatarUrl && !group && !imageFailed);
  return (
    <span
      className={`chat-avatar ${compact ? 'compact' : ''} ${showImage ? 'has-image' : ''}`}
      aria-hidden="true"
    >
      {showImage ? (
        <img
          src={avatarUrl ?? ''}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      ) : group ? (
        <Users />
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

function chatName(chat: ChatItem, userId: string) {
  if (chat.title) return chat.title;
  return (
    chat.members
      .filter((member) => member.id !== userId)
      .map((member) => member.displayName)
      .join(', ') || 'Чат FreeTalk'
  );
}

function retentionLabel(hours: ChatItem['retentionHours']) {
  if (hours === null) return 'без ограничения';
  if (hours === 24) return '24 часа';
  if (hours === 168) return '7 дней';
  return '30 дней';
}

function isGroupedMessage(previous: MessageItem | undefined, current: MessageItem) {
  if (!previous || previous.kind !== 'text' || current.kind !== 'text') return false;
  if (previous.sender_id !== current.sender_id) return false;
  return (
    new Date(current.created_at).getTime() - new Date(previous.created_at).getTime() < 5 * 60_000
  );
}

function isSameDay(first: string, second: string) {
  const a = new Date(first);
  const b = new Date(second);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatMessageTime(value: string) {
  return new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatMessageDate(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(date.toISOString(), today.toISOString())) return 'Сегодня';
  if (isSameDay(date.toISOString(), yesterday.toISOString())) return 'Вчера';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function formatConversationTime(value: string) {
  const date = new Date(value);
  return isSameDay(date.toISOString(), new Date().toISOString())
    ? formatMessageTime(value)
    : date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

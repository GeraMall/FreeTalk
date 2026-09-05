import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ArrowDown,
  ArrowLeft,
  Ban,
  Clock3,
  Crown,
  ImagePlus,
  Link2,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  PanelRightClose,
  PanelRightOpen,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Send,
  Save,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { isNearBottom } from '../lib/chat-scroll';
import { accountClient } from '../lib/api-client';
import { loadChatImage } from '../lib/chat-image-cache';
import { parseRoomDeepLink } from '../lib/deep-link';
import { prepareChatImageUpload, prepareGroupAvatar } from '../lib/profile';
import { collectAccountMediaUrls, warmAccountMediaCache } from '../lib/account-media-cache';
import type { PresenceStatus } from '@freetalk/protocol';
import { useCachedMediaUrl } from '../lib/use-cached-media';
import { avatarImageStyle } from '../lib/avatar-image-style';
import { CreateGroupDialog } from './CreateGroupDialog';
import { CachedMediaImage } from './CachedMedia';
import { ChatActionConfirmDialog } from './ChatActionConfirmDialog';
import { PresenceBadge } from './PresenceBadge';
import {
  UserProfileDialog,
  type UserProfileData,
  type UserProfileTarget,
} from './UserProfileDialog';

const CHAT_SIDEBAR_WIDTH_KEY = 'freetalkChatSidebarWidth';
const CHAT_SIDEBAR_MIN_WIDTH = 190;
const MOBILE_CHAT_HISTORY_KEY = 'freetalkMobileChatId';

function defaultChatSidebarWidth() {
  if (typeof window === 'undefined') return 330;
  if (window.innerWidth <= 1280) return 300;
  return Math.min(330, Math.max(280, window.innerWidth * 0.23));
}

function storedChatSidebarWidth() {
  if (typeof window === 'undefined') return undefined;
  const raw = window.localStorage.getItem(CHAT_SIDEBAR_WIDTH_KEY);
  if (raw === null) return undefined;
  const stored = Number(raw);
  if (!Number.isFinite(stored)) return undefined;
  return Math.min(defaultChatSidebarWidth(), Math.max(CHAT_SIDEBAR_MIN_WIDTH, stored));
}

export interface ChatMember {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  presence?: PresenceStatus;
  role?: 'owner' | 'admin' | 'member';
}

type ChatProfile = UserProfileData;

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
  avatarUrl?: string | null;
  avatarPositionX?: number;
  avatarPositionY?: number;
  avatarScale?: number;
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
  metadata?: {
    roomId?: string;
    width?: number;
    height?: number;
    ended?: boolean;
    startedAt?: string;
    endedAt?: string | null;
    participants?: Array<{
      userId?: string | null;
      displayName: string;
      avatarUrl?: string | null;
    }>;
  };
}

interface FriendOption {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  presence?: PresenceStatus;
}

interface ChatsPageProps {
  externalSidebar?: boolean;
  mobile?: boolean;
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
  slowModeUntil?: number;
  onOpenChat(chatId: string): Promise<void>;
  onCloseChat?(): void;
  onRetryMessages(): void;
  onLoadOlder?(): Promise<void>;
  onSendMessage(body: string): Promise<boolean>;
  onSendImage?(dataUrl: string, caption: string, thumbnailDataUrl: string): Promise<boolean>;
  onCreateGroup(title: string, memberIds: string[]): Promise<boolean>;
  onJoinInvite(token: string): Promise<boolean>;
  onStartCall(): Promise<void>;
  onCreateInvite(): Promise<void>;
  onUpdateRetention(retentionHours: 24 | 168 | 720 | null): Promise<void>;
  onClearHistory(): Promise<void>;
  onBlockUser?(userId: string): Promise<void>;
  onDeleteDirectChat?(): Promise<void>;
  onLeaveGroup?(): Promise<void>;
  onUpdateGroupAvatar?(
    chatId: string,
    dataUrl: string | undefined,
    positionX: number,
    positionY: number,
    scale: number,
  ): Promise<boolean>;
  onAddMember(username: string): Promise<boolean>;
  onJoinCall(roomId: string): void;
}

export function ChatsPage({
  externalSidebar = false,
  mobile = false,
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
  slowModeUntil = 0,
  onOpenChat,
  onCloseChat = () => {},
  onRetryMessages,
  onLoadOlder = async () => {},
  onSendMessage,
  onSendImage = async () => false,
  onCreateGroup,
  onJoinInvite,
  onStartCall,
  onCreateInvite,
  onUpdateRetention,
  onClearHistory,
  onBlockUser = async () => {},
  onDeleteDirectChat = async () => {},
  onLeaveGroup = async () => {},
  onUpdateGroupAvatar = async () => false,
  onAddMember,
  onJoinCall,
}: ChatsPageProps) {
  const [search, setSearch] = useState('');
  const [showGroup, setShowGroup] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showMember, setShowMember] = useState(false);
  const [inviteToken, setInviteToken] = useState('');
  const [memberUsername, setMemberUsername] = useState('');
  const [actionBusy, setActionBusy] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    'leave-group' | 'delete-direct' | 'block-direct'
  >();
  const [confirmActionError, setConfirmActionError] = useState('');
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [showChatSettings, setShowChatSettings] = useState(false);
  const [showGroupAvatarEditor, setShowGroupAvatarEditor] = useState(false);
  const [profileVisible, setProfileVisible] = useState(!mobile);
  const [profile, setProfile] = useState<ChatProfile>();
  const [profileLoading, setProfileLoading] = useState(false);
  const [fullProfileOpen, setFullProfileOpen] = useState(false);
  const [slowModeClock, setSlowModeClock] = useState(() => Date.now());
  const [dismissedSlowModeUntil, setDismissedSlowModeUntil] = useState(0);
  const [chatSidebarWidth, setChatSidebarWidth] = useState<number | undefined>(
    storedChatSidebarWidth,
  );
  const conversationSidebarRef = useRef<HTMLElement>(null);
  const resizeStateRef = useRef<
    | {
        pointerId: number;
        startX: number;
        startWidth: number;
        maxWidth: number;
      }
    | undefined
  >(undefined);
  const chatSidebarWidthRef = useRef(chatSidebarWidth);

  useEffect(() => {
    setSlowModeClock(Date.now());
    if (slowModeUntil <= Date.now()) return;
    const timer = window.setInterval(() => setSlowModeClock(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [slowModeUntil]);

  const slowModeRemainingSeconds = Math.max(0, Math.ceil((slowModeUntil - slowModeClock) / 1_000));

  const updateChatSidebarWidth = (width: number) => {
    const nextWidth = Math.min(defaultChatSidebarWidth(), Math.max(CHAT_SIDEBAR_MIN_WIDTH, width));
    chatSidebarWidthRef.current = nextWidth;
    setChatSidebarWidth(nextWidth);
  };

  const startChatSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button > 0 || window.innerWidth <= 700) return;
    const maxWidth = defaultChatSidebarWidth();
    const measuredWidth = conversationSidebarRef.current?.getBoundingClientRect().width ?? 0;
    const startWidth = chatSidebarWidthRef.current ?? (measuredWidth || maxWidth);
    resizeStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: Math.min(maxWidth, Math.max(CHAT_SIDEBAR_MIN_WIDTH, startWidth)),
      maxWidth,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const resizeChatSidebar = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = resizeStateRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    updateChatSidebarWidth(resize.startWidth + event.clientX - resize.startX);
  };

  const finishChatSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = resizeStateRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    resizeStateRef.current = undefined;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const width = chatSidebarWidthRef.current;
    if (width !== undefined) window.localStorage.setItem(CHAT_SIDEBAR_WIDTH_KEY, String(width));
  };

  const resizeChatSidebarWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const current =
      chatSidebarWidthRef.current ??
      conversationSidebarRef.current?.getBoundingClientRect().width ??
      defaultChatSidebarWidth();
    updateChatSidebarWidth(current + (event.key === 'ArrowLeft' ? -12 : 12));
    window.localStorage.setItem(
      CHAT_SIDEBAR_WIDTH_KEY,
      String(chatSidebarWidthRef.current ?? current),
    );
  };

  const activeChat = chats.find((chat) => chat.id === activeChatId);
  const closeMobileChat = useCallback(() => {
    if (window.history.state?.[MOBILE_CHAT_HISTORY_KEY] === activeChatId) {
      window.history.back();
    } else {
      onCloseChat();
    }
  }, [activeChatId, onCloseChat]);
  useEffect(() => {
    if (!mobile || !activeChatId) return;
    if (window.history.state?.[MOBILE_CHAT_HISTORY_KEY] !== activeChatId) {
      window.history.pushState(
        { ...window.history.state, [MOBILE_CHAT_HISTORY_KEY]: activeChatId },
        '',
      );
    }
    const handleBack = () => {
      if (window.history.state?.[MOBILE_CHAT_HISTORY_KEY] !== activeChatId) onCloseChat();
    };
    window.addEventListener('popstate', handleBack);
    return () => window.removeEventListener('popstate', handleBack);
  }, [activeChatId, mobile, onCloseChat]);
  const retentionHours = activeChat?.retentionHours === undefined ? 720 : activeChat.retentionHours;
  const profileTarget =
    activeChat?.type === 'direct'
      ? activeChat.members.find((member) => member.id !== userId)
      : undefined;
  const profileTargetId = profileTarget?.id;
  useEffect(() => {
    setConfirmClear(false);
    setShowChatMenu(false);
    setShowChatSettings(false);
    setShowGroupAvatarEditor(false);
    setConfirmAction(undefined);
    setConfirmActionError('');
    setFullProfileOpen(false);
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
      .then(async (result) => {
        await warmAccountMediaCache(userId, collectAccountMediaUrls(result.profile), 4_000);
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
  }, [profileRevision, profileTargetId, userId]);
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
    <div
      className={`messenger-layout page-enter ${profileVisible ? '' : 'profile-hidden'}${externalSidebar ? ' external-sidebar' : ''}${mobile ? ' mobile-messenger' : ''}${mobile && activeChat ? ' has-active-chat' : ''}`}
      style={
        chatSidebarWidth
          ? ({ '--conversation-sidebar-width': `${chatSidebarWidth}px` } as CSSProperties)
          : undefined
      }
    >
      {!externalSidebar ? (
        <aside
          ref={conversationSidebarRef}
          className="conversation-sidebar"
          aria-label="Список чатов"
        >
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
              onClick={() => setShowGroup(true)}
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
      ) : null}

      {!externalSidebar ? (
        <div
          className="conversation-sidebar-resizer"
          role="separator"
          aria-label="Изменить ширину списка чатов"
          aria-orientation="vertical"
          aria-valuemin={CHAT_SIDEBAR_MIN_WIDTH}
          aria-valuemax={Math.round(defaultChatSidebarWidth())}
          aria-valuenow={Math.round(chatSidebarWidth ?? defaultChatSidebarWidth())}
          tabIndex={0}
          onPointerDown={startChatSidebarResize}
          onPointerMove={resizeChatSidebar}
          onPointerUp={finishChatSidebarResize}
          onPointerCancel={finishChatSidebarResize}
          onKeyDown={resizeChatSidebarWithKeyboard}
        />
      ) : null}

      <section className="active-conversation" aria-label="Активный чат">
        {activeChat ? (
          <>
            <ChatHeader
              chat={activeChat}
              onBack={mobile ? closeMobileChat : undefined}
              userId={userId}
              showMember={showMember}
              memberUsername={memberUsername}
              actionBusy={actionBusy}
              profileVisible={profileVisible}
              showMenu={showChatMenu}
              showAvatarEditor={showGroupAvatarEditor}
              onOpenProfile={() => setFullProfileOpen(true)}
              onMemberUsername={setMemberUsername}
              onToggleMember={() => setShowMember((visible) => !visible)}
              onAddMember={() => void addMember()}
              onStartCall={() => void runAction('call', onStartCall)}
              onCreateInvite={() => void runAction('create-invite', onCreateInvite)}
              onToggleProfile={() => setProfileVisible((visible) => !visible)}
              onToggleMenu={() => setShowChatMenu((visible) => !visible)}
              onToggleAvatarEditor={() => setShowGroupAvatarEditor((visible) => !visible)}
              onCloseAvatarEditor={() => setShowGroupAvatarEditor(false)}
              onSaveAvatar={(dataUrl, positionX, positionY, scale) =>
                runAction('group-avatar', () =>
                  onUpdateGroupAvatar(activeChat.id, dataUrl, positionX, positionY, scale),
                )
              }
            />
            {showChatMenu && (
              <div className="chat-actions-popover" role="menu">
                <button onClick={() => setShowChatSettings((visible) => !visible)}>
                  <Clock3 /> Настройки чата
                </button>
                {activeChat.type === 'direct' && profileTarget ? (
                  <>
                    <button
                      className="destructive"
                      onClick={() => {
                        setConfirmActionError('');
                        setConfirmAction('block-direct');
                      }}
                    >
                      <Ban /> Заблокировать
                    </button>
                    <button
                      className="destructive"
                      onClick={() => {
                        setConfirmActionError('');
                        setConfirmAction('delete-direct');
                      }}
                    >
                      <Trash2 /> Удалить чат у обоих
                    </button>
                  </>
                ) : null}
                {activeChat.type === 'group' && activeChat.currentUserRole === 'owner' && (
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
                {activeChat.type === 'group' ? (
                  <button
                    className="destructive"
                    onClick={() => {
                      setConfirmActionError('');
                      setConfirmAction('leave-group');
                    }}
                  >
                    <X /> Покинуть группу
                  </button>
                ) : null}
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
              onJoinInvite={onJoinInvite}
            />
            <MessageComposer
              disabled={messagesLoading || slowModeRemainingSeconds > 0}
              onSend={onSendMessage}
              onSendImage={onSendImage}
            />
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
          onInvite={() => setShowMember(true)}
          onFullProfile={() => setFullProfileOpen(true)}
        />
      )}
      {activeChat && confirmAction ? (
        <ChatActionConfirmDialog
          title={
            confirmAction === 'leave-group'
              ? `Покинуть «${chatName(activeChat, userId)}»?`
              : confirmAction === 'delete-direct'
                ? 'Удалить личный чат у обоих?'
                : `Заблокировать ${profileTarget?.displayName ?? 'пользователя'}?`
          }
          description={
            confirmAction === 'leave-group'
              ? 'Группа исчезнет из списка. Вернуться можно будет только по новому приглашению участника.'
              : confirmAction === 'delete-direct'
                ? 'Вся переписка будет безвозвратно удалена у вас и у собеседника.'
                : 'Пользователь не сможет писать вам. Он будет удалён из друзей, а личный чат исчезнет из списка.'
          }
          confirmLabel={
            confirmAction === 'leave-group'
              ? 'Покинуть группу'
              : confirmAction === 'delete-direct'
                ? 'Удалить у обоих'
                : 'Заблокировать'
          }
          busy={Boolean(actionBusy)}
          error={confirmActionError}
          onCancel={() => !actionBusy && setConfirmAction(undefined)}
          onConfirm={() => {
            if (actionBusy) return;
            const action = confirmAction;
            const operation =
              action === 'leave-group'
                ? onLeaveGroup
                : action === 'delete-direct'
                  ? onDeleteDirectChat
                  : () =>
                      profileTarget ? onBlockUser(profileTarget.id) : Promise.resolve(undefined);
            setConfirmActionError('');
            void runAction(action, operation)
              .then((completed) => {
                if (!completed) return;
                setConfirmAction(undefined);
                setShowChatMenu(false);
              })
              .catch((caught) =>
                setConfirmActionError(
                  caught instanceof Error ? caught.message : 'Не удалось выполнить действие',
                ),
              );
          }}
        />
      ) : null}
      {slowModeRemainingSeconds > 0 && dismissedSlowModeUntil !== slowModeUntil ? (
        <ChatSlowModeDialog
          remainingSeconds={slowModeRemainingSeconds}
          onClose={() => setDismissedSlowModeUntil(slowModeUntil)}
        />
      ) : null}
      <CreateGroupDialog
        open={showGroup}
        friends={friends}
        onClose={() => setShowGroup(false)}
        onCreate={onCreateGroup}
      />
      <UserProfileDialog
        viewerId={userId}
        target={
          fullProfileOpen && profileTarget
            ? ({
                id: profileTarget.id,
                displayName: profileTarget.displayName,
                username: profileTarget.username,
                avatarUrl: profileTarget.avatarUrl,
                presence: profileTarget.presence,
              } satisfies UserProfileTarget)
            : undefined
        }
        initialProfile={profile}
        actions={{
          onMessage: () => setFullProfileOpen(false),
          onCall: async () => {
            setFullProfileOpen(false);
            await onStartCall();
          },
          onOpenChat: async (chatId) => {
            setFullProfileOpen(false);
            await onOpenChat(chatId);
          },
          onBlock: () => {
            setFullProfileOpen(false);
            setConfirmAction('block-direct');
          },
        }}
        onClose={() => setFullProfileOpen(false)}
      />
    </div>
  );
}

function ChatSlowModeDialog({
  remainingSeconds,
  onClose,
}: {
  remainingSeconds: number;
  onClose(): void;
}) {
  return createPortal(
    <div className="chat-slow-mode-backdrop" onMouseDown={onClose}>
      <section
        className="chat-slow-mode-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="chat-slow-mode-title"
        aria-describedby="chat-slow-mode-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" aria-label="Закрыть предупреждение" onClick={onClose}>
          <X />
        </button>
        <h2 id="chat-slow-mode-title">ВОУ, ВОУ, ПОЛЕГЧЕ!</h2>
        <p id="chat-slow-mode-description">Вы отправляете сообщения слишком быстро!</p>
        <button type="button" className="chat-slow-mode-rest" onClick={onClose}>
          Вход в зону отдыха
          <span>{remainingSeconds} с</span>
        </button>
      </section>
    </div>,
    document.body,
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
  const preview =
    chat.lastMessageKind === 'image'
      ? chat.lastMessage || 'Фотография'
      : chat.lastMessage
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
      <ChatAvatar
        name={name}
        group={chat.type === 'group'}
        avatarUrl={chat.type === 'group' ? chat.avatarUrl : other?.avatarUrl}
        presence={chat.type === 'direct' ? other?.presence : undefined}
        positionX={chat.avatarPositionX}
        positionY={chat.avatarPositionY}
        scale={chat.avatarScale}
      />
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
  onBack,
  userId,
  showMember,
  memberUsername,
  actionBusy,
  profileVisible,
  showMenu,
  showAvatarEditor,
  onOpenProfile,
  onMemberUsername,
  onToggleMember,
  onAddMember,
  onStartCall,
  onCreateInvite,
  onToggleProfile,
  onToggleMenu,
  onToggleAvatarEditor,
  onCloseAvatarEditor,
  onSaveAvatar,
}: {
  chat: ChatItem;
  onBack?(): void;
  userId: string;
  showMember: boolean;
  memberUsername: string;
  actionBusy: string;
  profileVisible: boolean;
  showMenu: boolean;
  showAvatarEditor: boolean;
  onOpenProfile(): void;
  onMemberUsername(value: string): void;
  onToggleMember(): void;
  onAddMember(): void;
  onStartCall(): void;
  onCreateInvite(): void;
  onToggleProfile(): void;
  onToggleMenu(): void;
  onToggleAvatarEditor(): void;
  onCloseAvatarEditor(): void;
  onSaveAvatar(
    dataUrl: string | undefined,
    positionX: number,
    positionY: number,
    scale: number,
  ): Promise<boolean>;
}) {
  const name = chatName(chat, userId);
  const other = chat.members.find((member) => member.id !== userId);
  const canEditAvatar =
    chat.type === 'group' && ['owner', 'admin'].includes(chat.currentUserRole ?? '');
  return (
    <header className="active-chat-header">
      {onBack ? (
        <button
          type="button"
          className="mobile-chat-back"
          aria-label="Назад к чатам"
          onClick={onBack}
        >
          <ArrowLeft />
        </button>
      ) : null}
      {chat.type === 'group' ? (
        <button
          className="group-avatar-trigger"
          title={canEditAvatar ? 'Изменить аватар группы' : 'Аватар группы'}
          aria-label={canEditAvatar ? 'Изменить аватар группы' : 'Аватар группы'}
          aria-expanded={canEditAvatar ? showAvatarEditor : undefined}
          disabled={!canEditAvatar}
          onClick={onToggleAvatarEditor}
        >
          <ChatAvatar
            name={name}
            group
            avatarUrl={chat.avatarUrl}
            positionX={chat.avatarPositionX}
            positionY={chat.avatarPositionY}
            scale={chat.avatarScale}
          />
        </button>
      ) : (
        <button
          type="button"
          className="direct-profile-trigger"
          aria-label={`Открыть полный профиль ${name}`}
          onClick={onOpenProfile}
        >
          <ChatAvatar
            name={name}
            group={false}
            avatarUrl={other?.avatarUrl}
            presence={other?.presence}
          />
        </button>
      )}
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
      {showAvatarEditor && canEditAvatar && (
        <GroupAvatarEditor
          key={`${chat.id}-${chat.avatarUrl ?? 'empty'}`}
          chat={chat}
          busy={actionBusy === 'group-avatar'}
          onClose={onCloseAvatarEditor}
          onSave={onSaveAvatar}
        />
      )}
    </header>
  );
}

function GroupAvatarEditor({
  chat,
  busy,
  onClose,
  onSave,
}: {
  chat: ChatItem;
  busy: boolean;
  onClose(): void;
  onSave(
    dataUrl: string | undefined,
    positionX: number,
    positionY: number,
    scale: number,
  ): Promise<boolean>;
}) {
  const [dataUrl, setDataUrl] = useState<string>();
  const [position, setPosition] = useState({
    x: chat.avatarPositionX ?? 50,
    y: chat.avatarPositionY ?? 50,
  });
  const [scale, setScale] = useState(chat.avatarScale ?? 100);
  const [error, setError] = useState('');
  const [closing, setClosing] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const dragRef = useRef<
    { pointerId: number; x: number; y: number; positionX: number; positionY: number } | undefined
  >(undefined);
  const previewUrl = dataUrl ?? chat.avatarUrl ?? undefined;
  const cachedPreviewUrl = useCachedMediaUrl(previewUrl);

  const closeSmoothly = useCallback(() => {
    if (closing) return;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(onClose, 190);
  }, [closing, onClose]);

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!editorRef.current?.contains(event.target as Node)) closeSmoothly();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
  }, [closeSmoothly]);

  useEffect(
    () => () => {
      if (closeTimerRef.current !== undefined) window.clearTimeout(closeTimerRef.current);
    },
    [],
  );

  const chooseFile = async (file?: File) => {
    if (!file) return;
    setError('');
    try {
      setDataUrl(await prepareGroupAvatar(file));
      setPosition({ x: 50, y: 50 });
      setScale(110);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось обработать изображение');
    }
  };

  const movePreview = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
    setPosition({
      x: clamp(drag.positionX + ((event.clientX - drag.x) / rect.width) * 100),
      y: clamp(drag.positionY + ((event.clientY - drag.y) / rect.height) * 100),
    });
  };

  const finishPreviewDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = undefined;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  return (
    <div
      ref={editorRef}
      className={`group-avatar-editor${closing ? ' closing' : ''}`}
      role="dialog"
      aria-label="Аватар группы"
    >
      <div className="group-avatar-editor-heading">
        <div>
          <strong>Аватар группы</strong>
          <small>Перетащите фото внутри круга</small>
        </div>
        <button
          type="button"
          aria-label="Закрыть"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={closeSmoothly}
        >
          <X />
        </button>
      </div>
      <div
        className={`group-avatar-crop ${previewUrl ? 'has-image' : ''}`}
        onPointerDown={(event) => {
          if (!previewUrl) return;
          if (scale <= 100) setScale(110);
          dragRef.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            positionX: position.x,
            positionY: position.y,
          };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={movePreview}
        onPointerUp={finishPreviewDrag}
        onPointerCancel={finishPreviewDrag}
      >
        {cachedPreviewUrl ? (
          <img
            src={cachedPreviewUrl}
            alt="Предпросмотр аватара группы"
            draggable={false}
            style={avatarImageStyle(position.x, position.y, scale)}
          />
        ) : (
          <Users />
        )}
        <button
          className="group-avatar-pencil"
          type="button"
          aria-label="Выбрать изображение"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            fileRef.current?.click();
          }}
        >
          <Pencil />
        </button>
      </div>
      <input
        ref={fileRef}
        className="sr-only"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => void chooseFile(event.target.files?.[0])}
      />
      {error && (
        <p className="group-avatar-error" role="alert">
          {error}
        </p>
      )}
      {previewUrl && (
        <label className="group-avatar-scale">
          <span>Размер</span>
          <input
            type="range"
            min="100"
            max="250"
            step="5"
            value={scale}
            aria-label="Размер аватара"
            onChange={(event) => setScale(Number(event.target.value))}
          />
          <output>{scale}%</output>
        </label>
      )}
      <div className="group-avatar-editor-actions">
        <span>
          {position.x}% · {position.y}%
        </span>
        <button
          type="button"
          disabled={busy || !previewUrl}
          onClick={() =>
            void onSave(dataUrl, position.x, position.y, scale).then((saved) => {
              if (saved) closeSmoothly();
            })
          }
        >
          <Save /> {busy ? 'Сохранение…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}

function ProfilePanel({
  profile,
  loading,
  fallback,
  groupTitle,
  members,
  onInvite,
  onFullProfile,
}: {
  profile?: ChatProfile;
  loading: boolean;
  fallback?: ChatMember;
  groupTitle?: string;
  members: ChatMember[];
  onInvite(): void;
  onFullProfile(): void;
}) {
  const avatarUrl = profile?.avatarUrl ?? fallback?.avatarUrl;
  const cachedAvatarUrl = useCachedMediaUrl(avatarUrl);
  const cachedCoverUrl = useCachedMediaUrl(profile?.coverUrl);
  if (groupTitle)
    return (
      <aside className="chat-profile-panel group-members-panel" aria-label="Участники группы">
        <section className="group-members-heading">
          <p>Участники — {members.length}</p>
          <h2>{groupTitle}</h2>
        </section>
        <div className="group-members-list">
          {[...members]
            .sort((first, second) =>
              first.role === 'owner' ? -1 : second.role === 'owner' ? 1 : 0,
            )
            .map((member) => (
              <div className="group-member-row" key={member.id}>
                <ChatAvatar
                  name={member.displayName}
                  group={false}
                  avatarUrl={member.avatarUrl}
                  presence={member.presence}
                  compact
                />
                <span>
                  <strong>{member.displayName}</strong>
                  <small>{presenceLabel(member.presence)}</small>
                </span>
                {member.role === 'owner' && <Crown aria-label="Владелец группы" />}
              </div>
            ))}
        </div>
        <button className="group-members-invite" onClick={onInvite}>
          <UserPlus /> Пригласить в группу
        </button>
      </aside>
    );
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
        style={cachedCoverUrl ? { backgroundImage: `url(${cachedCoverUrl})` } : undefined}
      />
      <button
        type="button"
        className="chat-profile-avatar"
        aria-label={`Открыть полный профиль ${name}`}
        onClick={onFullProfile}
      >
        {cachedAvatarUrl ? <img src={cachedAvatarUrl} alt="" /> : name.slice(0, 1).toUpperCase()}
      </button>
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
              {friend.avatarUrl ? (
                <CachedMediaImage src={friend.avatarUrl} alt="" />
              ) : (
                friend.displayName[0]
              )}
            </span>
          ))}
        </div>
        <p>{profile?.mutualFriendsCount ?? 0} общих друзей</p>
      </section>
      {profile?.registeredAt && (
        <footer>
          В FreeTalk с{' '}
          {new Date(profile.registeredAt).toLocaleDateString('ru-RU', {
            month: 'long',
            year: 'numeric',
          })}
        </footer>
      )}
      <button type="button" className="chat-profile-full-button" onClick={onFullProfile}>
        Полный профиль
      </button>
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
  onJoinInvite = async () => false,
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
  onJoinInvite?(token: string): Promise<boolean>;
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
                      accountId={userId}
                      own={message.sender_id === userId}
                      grouped={grouped}
                      showAuthor={groupChat && !grouped && message.sender_id !== userId}
                      onJoinCall={onJoinCall}
                      onJoinInvite={onJoinInvite}
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
  accountId,
  own,
  grouped,
  showAuthor,
  onJoinCall,
  onJoinInvite,
}: {
  message: MessageItem;
  accountId: string;
  own: boolean;
  grouped: boolean;
  showAuthor: boolean;
  onJoinCall(roomId: string): void;
  onJoinInvite(token: string): Promise<boolean>;
}) {
  const inviteToken = extractChatInviteToken(message.body);
  const roomInviteId = parseRoomDeepLink(message.body.trim());
  const isInvite = Boolean(inviteToken || roomInviteId);
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
      <div
        className={`message-bubble${message.kind === 'image' ? ' image-message-bubble' : ''}${isInvite ? ' invite-message-bubble' : ''}`}
      >
        {showAuthor && <strong>{message.display_name || message.username || 'Участник'}</strong>}
        {message.kind === 'image' ? (
          <ChatImageMessage message={message} accountId={accountId} />
        ) : inviteToken ? (
          <InviteMessageCard token={inviteToken} onJoin={onJoinInvite} />
        ) : roomInviteId ? (
          <RoomInviteMessageCard roomId={roomInviteId} onJoin={onJoinCall} />
        ) : (
          <p>{message.body}</p>
        )}
        <time>{formatMessageTime(message.created_at)}</time>
      </div>
    </article>
  );
}

interface RoomInvitePreview {
  roomId: string;
  active: boolean;
  startedAt: string | null;
  participantCount: number;
}

function RoomInviteMessageCard({
  roomId,
  onJoin,
}: {
  roomId: string;
  onJoin(roomId: string): void;
}) {
  const [preview, setPreview] = useState<RoomInvitePreview>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const result = await accountClient.request<{ room: RoomInvitePreview }>(
          `/v1/room-invites/${roomId}/preview`,
        );
        if (!active) return;
        setPreview(result.room);
        setFailed(false);
        if (result.room.active) timer = setTimeout(load, 5_000);
      } catch {
        if (active) setFailed(true);
      }
    };
    setPreview(undefined);
    setFailed(false);
    void load();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [roomId]);

  if (failed)
    return (
      <div className="chat-invite-card unavailable">
        <span className="chat-invite-avatar">
          <Phone />
        </span>
        <span>
          <strong>Не удалось проверить ссылку</strong>
          <small>Проверьте подключение и откройте чат снова</small>
        </span>
      </div>
    );

  if (preview && !preview.active)
    return (
      <div className="chat-invite-card unavailable expired">
        <span className="chat-invite-avatar">
          <Phone />
        </span>
        <span>
          <strong>Ссылка истекла</strong>
          <small>Этот звонок уже завершён</small>
        </span>
      </div>
    );

  return (
    <div className={`chat-invite-card${preview ? '' : ' loading'}`}>
      <span className="chat-invite-avatar">
        <Phone />
      </span>
      <span className="chat-invite-copy">
        <small>Приглашение в звонок</small>
        <strong>{preview ? 'Голосовая комната' : 'Проверяем ссылку…'}</strong>
        <span>
          {preview
            ? `${preview.participantCount} ${participantWord(preview.participantCount)}`
            : 'Получаем информацию'}
        </span>
      </span>
      {preview && (
        <button type="button" onClick={() => onJoin(roomId)}>
          Присоединиться
        </button>
      )}
    </div>
  );
}

function participantWord(count: number) {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'участников';
  if (last === 1) return 'участник';
  if (last >= 2 && last <= 4) return 'участника';
  return 'участников';
}

interface InvitePreview {
  id: string;
  title: string;
  memberCount: number;
  avatarUrl: string | null;
  avatarPositionX: number;
  avatarPositionY: number;
  avatarScale: number;
  isMember: boolean;
}

function InviteMessageCard({
  token,
  onJoin,
}: {
  token: string;
  onJoin(token: string): Promise<boolean>;
}) {
  const [preview, setPreview] = useState<InvitePreview>();
  const [failed, setFailed] = useState(false);
  const [joining, setJoining] = useState(false);
  useEffect(() => {
    let active = true;
    setPreview(undefined);
    setFailed(false);
    void accountClient
      .request<{ chat: InvitePreview }>(`/v1/chat-invites/${token}/preview`)
      .then(({ chat }) => {
        if (active) setPreview(chat);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [token]);

  if (failed)
    return (
      <div className="chat-invite-card unavailable">
        <span className="chat-invite-avatar">
          <Users />
        </span>
        <span>
          <strong>Приглашение недоступно</strong>
          <small>Ссылка устарела или была отозвана</small>
        </span>
      </div>
    );

  return (
    <div className={`chat-invite-card${preview ? '' : ' loading'}`}>
      <span className="chat-invite-avatar">
        {preview?.avatarUrl ? (
          <CachedMediaImage
            src={preview.avatarUrl}
            alt=""
            style={avatarImageStyle(
              preview.avatarPositionX,
              preview.avatarPositionY,
              preview.avatarScale,
            )}
          />
        ) : (
          <Users />
        )}
      </span>
      <span className="chat-invite-copy">
        <small>Приглашение в группу</small>
        <strong>{preview?.title || 'Загрузка группы…'}</strong>
        <span>{preview ? `${preview.memberCount} участников` : 'Получаем информацию'}</span>
      </span>
      {preview && (
        <button
          type="button"
          disabled={joining}
          onClick={() => {
            setJoining(true);
            void onJoin(token).finally(() => setJoining(false));
          }}
        >
          {joining ? 'Открываем…' : preview.isMember ? 'Открыть' : 'Вступить'}
        </button>
      )}
    </div>
  );
}

function ChatImageMessage({ message, accountId }: { message: MessageItem; accountId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(() => typeof IntersectionObserver === 'undefined');
  const [thumbnailSource, setThumbnailSource] = useState('');
  const [viewerSource, setViewerSource] = useState('');
  const [failed, setFailed] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerClosing, setViewerClosing] = useState(false);
  useEffect(() => {
    if (shouldLoad || typeof IntersectionObserver === 'undefined') return;
    const element = containerRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: '800px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [shouldLoad]);

  useEffect(() => {
    if (!shouldLoad) return;
    let active = true;
    let objectUrl = '';
    setThumbnailSource('');
    setFailed(false);
    void loadChatImage({
      accountId,
      messageId: message.id,
      variant: 'thumbnail',
      expiresAt: message.expires_at,
      fetcher: () => accountClient.chatImageBlob(message.id, 'thumbnail'),
    })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setThumbnailSource(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [accountId, message.expires_at, message.id, shouldLoad]);

  useEffect(() => {
    if (!viewerOpen) return;
    let active = true;
    let objectUrl = '';
    void loadChatImage({
      accountId,
      messageId: message.id,
      variant: 'full',
      expiresAt: message.expires_at,
      fetcher: () => accountClient.chatImageBlob(message.id, 'full'),
    })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setViewerSource(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      setViewerSource('');
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [accountId, message.expires_at, message.id, viewerOpen]);

  useEffect(() => {
    if (!viewerOpen) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setViewerClosing(true);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [viewerOpen]);

  useEffect(() => {
    if (!viewerClosing) return;
    const timer = window.setTimeout(() => setViewerOpen(false), 220);
    return () => window.clearTimeout(timer);
  }, [viewerClosing]);

  const alt = `Фотография от ${message.display_name || message.username || 'участника'}`;

  return (
    <>
      <div className="chat-image-message" ref={containerRef}>
        {thumbnailSource ? (
          <button
            type="button"
            className="chat-image-open"
            aria-label="Открыть фотографию на весь экран"
            onClick={() => {
              setViewerClosing(false);
              setViewerOpen(true);
            }}
          >
            <img
              src={thumbnailSource}
              alt={alt}
              style={
                message.metadata?.width && message.metadata?.height
                  ? { aspectRatio: `${message.metadata.width} / ${message.metadata.height}` }
                  : undefined
              }
            />
          </button>
        ) : failed ? (
          <span className="chat-image-error">Не удалось загрузить фотографию</span>
        ) : (
          <span
            className="chat-image-loading"
            role="status"
            aria-label="Загружаем фотографию"
            style={
              message.metadata?.width && message.metadata?.height
                ? { aspectRatio: `${message.metadata.width} / ${message.metadata.height}` }
                : undefined
            }
          />
        )}
        {message.body && <p>{message.body}</p>}
      </div>
      {viewerOpen &&
        createPortal(
          <div
            className={`chat-image-viewer-backdrop${viewerClosing ? ' closing' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={alt}
            onPointerDown={(event) => {
              if (event.currentTarget === event.target) setViewerClosing(true);
            }}
            onAnimationEnd={(event) => {
              if (viewerClosing && event.currentTarget === event.target) setViewerOpen(false);
            }}
          >
            <div className="chat-image-viewer">
              <button
                type="button"
                className="chat-image-viewer-close"
                aria-label="Закрыть фотографию"
                onClick={() => setViewerClosing(true)}
              >
                <X />
              </button>
              <img src={viewerSource || thumbnailSource} alt={alt} />
              <div className="chat-image-viewer-caption">
                <strong>{message.display_name || message.username || 'Участник'}</strong>
                {message.body && <span>{message.body}</span>}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function SystemCallMessage({
  message,
  onJoin,
}: {
  message: MessageItem;
  onJoin(roomId: string): void;
}) {
  const ended = message.metadata?.ended === true;
  const participants = message.metadata?.participants ?? [];
  const startedAt = message.metadata?.startedAt;
  const endedAt = message.metadata?.endedAt;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (ended || !startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [ended, startedAt]);
  const duration = startedAt
    ? formatCallDuration(
        Math.max(
          0,
          Math.floor(((endedAt ? Date.parse(endedAt) : now) - Date.parse(startedAt)) / 1_000),
        ),
      )
    : null;
  return (
    <article className={`system-call-message${ended ? ' ended' : ''}`}>
      <span className="system-call-icon">
        <Phone />
      </span>
      <div className="system-call-content">
        <strong>{message.body}</strong>
        {participants.length > 0 || duration ? (
          <div className="system-call-summary">
            {participants.length > 0 ? (
              <span
                className="system-call-participants"
                aria-label={`Участники: ${participants.map(({ displayName }) => displayName).join(', ')}`}
              >
                {participants.slice(0, 4).map((participant, index) => (
                  <span
                    className="system-call-participant"
                    key={participant.userId ?? `${participant.displayName}-${index}`}
                    title={participant.displayName}
                  >
                    {participant.avatarUrl ? (
                      <CachedMediaImage src={participant.avatarUrl} alt="" />
                    ) : (
                      participant.displayName.trim().charAt(0).toLocaleUpperCase() || '?'
                    )}
                  </span>
                ))}
                {participants.length > 4 ? (
                  <span className="system-call-participant extra">+{participants.length - 4}</span>
                ) : null}
              </span>
            ) : null}
            {duration ? (
              <span className="system-call-duration" aria-label={`Время разговора ${duration}`}>
                <Clock3 />
                {duration}
              </span>
            ) : null}
          </div>
        ) : (
          <time>{formatMessageTime(message.created_at)}</time>
        )}
      </div>
      {ended ? (
        <span className="system-call-ended">Звонок завершён</span>
      ) : message.metadata?.roomId ? (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onJoin(message.metadata!.roomId!);
          }}
        >
          Присоединиться
        </button>
      ) : null}
    </article>
  );
}

function formatCallDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
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
  onSendImage,
}: {
  disabled: boolean;
  onSend(body: string): Promise<boolean>;
  onSendImage(dataUrl: string, caption: string, thumbnailDataUrl: string): Promise<boolean>;
}) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [processingImage, setProcessingImage] = useState(false);
  const [imageDataUrl, setImageDataUrl] = useState('');
  const [thumbnailDataUrl, setThumbnailDataUrl] = useState('');
  const [imageError, setImageError] = useState('');
  const imageInputRef = useRef<HTMLInputElement>(null);
  const prepareSelectedImage = (file: File) => {
    if (processingImage) return;
    setProcessingImage(true);
    setImageError('');
    void prepareChatImageUpload(file)
      .then((prepared) => {
        setImageDataUrl(prepared.imageDataUrl);
        setThumbnailDataUrl(prepared.thumbnailDataUrl);
      })
      .catch((caught) =>
        setImageError(
          caught instanceof Error ? caught.message : 'Не удалось обработать фотографию',
        ),
      )
      .finally(() => setProcessingImage(false));
  };
  const send = async () => {
    const body = value.trim();
    if ((!body && !imageDataUrl) || sending || processingImage) return;
    setSending(true);
    try {
      const sent = imageDataUrl
        ? await onSendImage(imageDataUrl, body, thumbnailDataUrl)
        : await onSend(body);
      if (sent) {
        setValue('');
        setImageDataUrl('');
        setThumbnailDataUrl('');
        setImageError('');
      }
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
      {imageDataUrl && (
        <div className="composer-image-preview">
          <img src={imageDataUrl} alt="Предпросмотр отправляемой фотографии" />
          <span>Фотография готова к отправке</span>
          <button
            type="button"
            aria-label="Убрать фотографию"
            onClick={() => {
              setImageDataUrl('');
              setThumbnailDataUrl('');
            }}
          >
            <X />
          </button>
        </div>
      )}
      {imageError && <p className="composer-image-error">{imageError}</p>}
      <input
        ref={imageInputRef}
        className="composer-image-input"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          prepareSelectedImage(file);
        }}
      />
      <button
        type="button"
        className="composer-add-button"
        title="Отправить фотографию"
        aria-label="Добавить фотографию"
        disabled={disabled || sending || processingImage}
        onClick={() => imageInputRef.current?.click()}
      >
        <ImagePlus />
      </button>
      <textarea
        value={value}
        rows={1}
        maxLength={imageDataUrl ? 1000 : 4000}
        disabled={disabled}
        placeholder="Написать сообщение…"
        aria-label="Сообщение"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={(event) => {
          const image = Array.from(event.clipboardData.items)
            .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
            ?.getAsFile();
          if (!image) return;
          event.preventDefault();
          prepareSelectedImage(image);
        }}
      />
      <button
        className="send-message-button"
        title="Отправить"
        aria-label="Отправить сообщение"
        disabled={disabled || sending || processingImage || (!value.trim() && !imageDataUrl)}
        onClick={() => void send()}
      >
        <Send />
      </button>
    </div>
  );
}

function extractChatInviteToken(body: string) {
  return /^freetalk:\/\/chat\/([A-Za-z0-9_-]{32,256})\/?$/i.exec(body.trim())?.[1];
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
  presence,
  positionX = 50,
  positionY = 50,
  scale = 100,
}: {
  name: string;
  group: boolean;
  avatarUrl?: string | null;
  compact?: boolean;
  presence?: PresenceStatus;
  positionX?: number;
  positionY?: number;
  scale?: number;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const cachedAvatarUrl = useCachedMediaUrl(avatarUrl);
  useEffect(() => setImageFailed(false), [avatarUrl]);
  const showImage = Boolean(cachedAvatarUrl && !imageFailed);
  return (
    <span
      className={`chat-avatar ${compact ? 'compact' : ''} ${showImage ? 'has-image' : ''}`}
      aria-hidden="true"
    >
      {showImage ? (
        <img
          src={cachedAvatarUrl ?? ''}
          alt=""
          referrerPolicy="no-referrer"
          style={avatarImageStyle(positionX, positionY, scale)}
          onError={() => setImageFailed(true)}
        />
      ) : group ? (
        <Users />
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
      {!group && presence ? <PresenceBadge status={presence} /> : null}
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

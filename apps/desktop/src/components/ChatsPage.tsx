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
  type ReactNode,
} from 'react';
import {
  ArrowDown,
  ArrowLeft,
  Ban,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  Crown,
  Forward,
  ImagePlus,
  Link2,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  PinOff,
  Phone,
  Plus,
  RefreshCw,
  Reply,
  Search,
  Send,
  Save,
  Smile,
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
import { chatReactionEmojiSchema, type PresenceStatus } from '@freetalk/protocol';
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
const RECENT_MESSAGE_REACTIONS_KEY = 'freetalkRecentMessageReactions';
const OLD_MESSAGES_NOTICE_THRESHOLD = 260;

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

function storedRecentMessageReactions() {
  if (typeof window === 'undefined') return QUICK_MESSAGE_REACTIONS.slice(0, 3);
  try {
    const stored = JSON.parse(window.localStorage.getItem(RECENT_MESSAGE_REACTIONS_KEY) ?? '[]');
    if (!Array.isArray(stored)) return QUICK_MESSAGE_REACTIONS.slice(0, 3);
    const valid = stored.filter(
      (emoji): emoji is string => chatReactionEmojiSchema.safeParse(emoji).success,
    );
    return [...valid, ...QUICK_MESSAGE_REACTIONS]
      .filter((emoji, index, all) => all.indexOf(emoji) === index)
      .slice(0, 3);
  } catch {
    return QUICK_MESSAGE_REACTIONS.slice(0, 3);
  }
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
  edited_at?: string | null;
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
    replyTo?: MessageReference | null;
    forwardedFrom?: MessageAuthorReference | null;
    gif?: GifMessageData;
    deleted?: boolean;
  };
  reply_to?: MessageReference | null;
  forwarded_from?: MessageAuthorReference | null;
  reactions?: MessageReaction[];
  pinned_at?: string | null;
  pinned_by?: string | null;
  deleted_at?: string | null;
}

export interface MessageReference {
  id: string;
  kind: string;
  body: string;
  sender_id?: string | null;
  display_name?: string | null;
  username?: string | null;
  deleted?: boolean;
}

export interface MessageAuthorReference {
  display_name?: string;
  displayName?: string;
  username?: string | null;
}

export interface MessageReaction {
  emoji: string;
  count: number;
  userIds?: string[];
  reactedByMe?: boolean;
}

export interface GifMessageData {
  url: string;
  previewUrl?: string;
  width?: number;
  height?: number;
  alt: string;
  attribution: {
    provider: 'Wikimedia Commons';
    title: string;
    pageUrl: string;
    author?: string;
    license?: string;
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
  pinnedMessage?: MessageItem;
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
  onSendMessage(body: string, replyToMessageId?: string): Promise<boolean>;
  onSendImage?(
    dataUrl: string,
    caption: string,
    thumbnailDataUrl: string,
    replyToMessageId?: string,
  ): Promise<boolean>;
  onSendGif?(gif: GifMessageData, replyToMessageId?: string): Promise<boolean>;
  onReactMessage?(messageId: string, emoji: string | null): Promise<boolean>;
  onPinMessage?(messageId: string, pinned: boolean): Promise<boolean>;
  onEditMessage?(messageId: string, body: string): Promise<boolean>;
  onDeleteMessage?(messageId: string): Promise<boolean>;
  onForwardMessage?(messageId: string, targetChatId: string): Promise<boolean>;
  onRevealMessage?(messageId: string): Promise<boolean>;
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
    title: string,
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
  pinnedMessage,
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
  onSendGif = async () => false,
  onReactMessage = async () => false,
  onPinMessage = async () => false,
  onEditMessage = async () => false,
  onDeleteMessage = async () => false,
  onForwardMessage = async () => false,
  onRevealMessage = async () => false,
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
  const [replyTarget, setReplyTarget] = useState<MessageItem>();
  const [messageSearch, setMessageSearch] = useState('');
  const [messageSearchIndex, setMessageSearchIndex] = useState(0);
  const [profileVisible, setProfileVisible] = useState(!mobile);
  const [profile, setProfile] = useState<ChatProfile>();
  const [profileLoading, setProfileLoading] = useState(false);
  const [fullProfileOpen, setFullProfileOpen] = useState(false);
  const [groupProfileTarget, setGroupProfileTarget] = useState<ChatMember>();
  const [slowModeClock, setSlowModeClock] = useState(() => Date.now());
  const [dismissedSlowModeUntil, setDismissedSlowModeUntil] = useState(0);
  const [chatSidebarWidth, setChatSidebarWidth] = useState<number | undefined>(
    storedChatSidebarWidth,
  );
  const conversationSidebarRef = useRef<HTMLElement>(null);
  const chatMenuRef = useRef<HTMLDivElement>(null);
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
  const messageSearchMatches = useMemo(() => {
    const query = messageSearch.trim().toLocaleLowerCase('ru-RU');
    if (!query) return [];
    return messages.filter((message) => message.body.toLocaleLowerCase('ru-RU').includes(query));
  }, [messageSearch, messages]);
  const activeMessageSearchIndex = Math.min(
    messageSearchIndex,
    Math.max(0, messageSearchMatches.length - 1),
  );
  const focusedMessageId = messageSearchMatches[activeMessageSearchIndex]?.id;
  const cycleMessageSearch = (direction: 1 | -1) => {
    if (!messageSearchMatches.length) return;
    setMessageSearchIndex((current) => {
      const safeCurrent = Math.min(current, messageSearchMatches.length - 1);
      return (safeCurrent + direction + messageSearchMatches.length) % messageSearchMatches.length;
    });
  };
  const closeMobileChat = useCallback(() => {
    if (window.history.state?.[MOBILE_CHAT_HISTORY_KEY] === activeChatId) {
      window.history.back();
    } else {
      onCloseChat();
    }
  }, [activeChatId, onCloseChat]);
  useEffect(() => {
    setMessageSearch('');
    setMessageSearchIndex(0);
  }, [activeChatId]);
  useEffect(() => {
    setMessageSearchIndex(Math.max(0, messageSearchMatches.length - 1));
  }, [messageSearch, messageSearchMatches.length]);
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
  const retentionHours =
    activeChat?.type === 'direct'
      ? null
      : activeChat?.retentionHours === undefined
        ? 720
        : activeChat.retentionHours;
  const profileTarget =
    activeChat?.type === 'direct'
      ? activeChat.members.find((member) => member.id !== userId)
      : undefined;
  const fullProfileTarget = groupProfileTarget ?? profileTarget;
  const profileTargetId = profileTarget?.id;
  useEffect(() => {
    setConfirmClear(false);
    setShowChatMenu(false);
    setShowChatSettings(false);
    setShowGroupAvatarEditor(false);
    setReplyTarget(undefined);
    setGroupProfileTarget(undefined);
    setConfirmAction(undefined);
    setConfirmActionError('');
    setFullProfileOpen(false);
  }, [activeChatId]);
  useEffect(() => {
    if (!showChatMenu) return;
    const closeOnPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (chatMenuRef.current?.contains(target) || target.closest('[data-chat-menu-trigger]'))
        return;
      setShowChatMenu(false);
      setShowChatSettings(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setShowChatMenu(false);
      setShowChatSettings(false);
    };
    document.addEventListener('pointerdown', closeOnPointerDown);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [showChatMenu]);
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
      className={`messenger-layout page-enter ${profileVisible ? '' : 'profile-hidden'}${externalSidebar ? ' external-sidebar' : ''}${mobile ? ' mobile-messenger' : ''}${mobile && activeChat ? ' has-active-chat' : ''}${activeChat ? ` chat-${activeChat.type}` : ''}`}
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

      {activeChat ? (
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
          messageSearch={messageSearch}
          messageSearchCount={messageSearchMatches.length}
          messageSearchIndex={activeMessageSearchIndex}
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
          onMessageSearch={(value) => setMessageSearch(value)}
          onMessageSearchNext={(direction) => cycleMessageSearch(direction)}
          onSaveAvatar={(title, dataUrl, positionX, positionY, scale) =>
            runAction('group-avatar', () =>
              onUpdateGroupAvatar(activeChat.id, title, dataUrl, positionX, positionY, scale),
            )
          }
        />
      ) : null}

      <section className="active-conversation" aria-label="Активный чат">
        {activeChat ? (
          <>
            {showChatMenu && (
              <div ref={chatMenuRef} className="chat-actions-popover" role="menu">
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
                    {activeChat.type === 'group' && activeChat.currentUserRole === 'owner' ? (
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
              pinnedMessage={pinnedMessage}
              loading={messagesLoading}
              error={messagesError}
              sentMessageVersion={sentMessageVersion}
              hasMore={hasMoreMessages}
              onRetry={onRetryMessages}
              onLoadOlder={onLoadOlder}
              onJoinCall={onJoinCall}
              onJoinInvite={onJoinInvite}
              chats={chats}
              canModerateMessages={
                activeChat.type === 'group' &&
                ['owner', 'admin'].includes(activeChat.currentUserRole ?? '')
              }
              canPinMessages={
                activeChat.type === 'direct' ||
                ['owner', 'admin'].includes(activeChat.currentUserRole ?? '')
              }
              onReply={setReplyTarget}
              onReact={onReactMessage}
              onPin={onPinMessage}
              onEdit={onEditMessage}
              onDelete={onDeleteMessage}
              onForward={onForwardMessage}
              onReveal={onRevealMessage}
              searchQuery={messageSearch}
              focusedMessageId={focusedMessageId}
            />
            <MessageComposer
              key={activeChat.id}
              disabled={messagesLoading || slowModeRemainingSeconds > 0}
              onSend={onSendMessage}
              onSendImage={onSendImage}
              onSendGif={onSendGif}
              replyTarget={replyTarget}
              onCancelReply={() => setReplyTarget(undefined)}
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
          onMemberProfile={(member) => {
            setGroupProfileTarget(member);
            setFullProfileOpen(true);
          }}
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
          fullProfileOpen && fullProfileTarget
            ? ({
                id: fullProfileTarget.id,
                displayName: fullProfileTarget.displayName,
                username: fullProfileTarget.username,
                avatarUrl: fullProfileTarget.avatarUrl,
                presence: fullProfileTarget.presence,
              } satisfies UserProfileTarget)
            : undefined
        }
        initialProfile={groupProfileTarget ? undefined : profile}
        actions={{
          onMessage: () => {
            setFullProfileOpen(false);
            setGroupProfileTarget(undefined);
          },
          onCall: groupProfileTarget
            ? undefined
            : async () => {
                setFullProfileOpen(false);
                await onStartCall();
              },
          onOpenChat: async (chatId) => {
            setFullProfileOpen(false);
            setGroupProfileTarget(undefined);
            await onOpenChat(chatId);
          },
          onBlock: groupProfileTarget
            ? undefined
            : () => {
                setFullProfileOpen(false);
                setConfirmAction('block-direct');
              },
        }}
        onClose={() => {
          setFullProfileOpen(false);
          setGroupProfileTarget(undefined);
        }}
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
  messageSearch,
  messageSearchCount,
  messageSearchIndex,
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
  onMessageSearch,
  onMessageSearchNext,
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
  messageSearch: string;
  messageSearchCount: number;
  messageSearchIndex: number;
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
  onMessageSearch(value: string): void;
  onMessageSearchNext(direction: 1 | -1): void;
  onSaveAvatar(
    title: string,
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
            ? memberCountLabel(chat.members.length)
            : other
              ? `@${other.username}`
              : 'Личный чат'}
        </small>
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
          data-chat-menu-trigger
          title="Действия с чатом"
          aria-label="Действия с чатом"
          aria-expanded={showMenu}
          onClick={onToggleMenu}
        >
          <MoreHorizontal />
        </button>
        <button
          title={profileVisible ? 'Скрыть профиль' : 'Показать профиль'}
          aria-label={profileVisible ? 'Скрыть профиль' : 'Показать профиль'}
          aria-pressed={profileVisible}
          onClick={onToggleProfile}
        >
          {profileVisible ? <PanelRightClose /> : <PanelRightOpen />}
        </button>
        <label className="active-chat-search">
          <Search />
          <input
            value={messageSearch}
            aria-label={`Искать в ${name}`}
            placeholder={`Искать в «${name}»`}
            onChange={(event) => onMessageSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              onMessageSearchNext(event.shiftKey ? -1 : 1);
            }}
          />
          {messageSearch ? (
            <>
              <span>
                {messageSearchCount ? `${messageSearchIndex + 1}/${messageSearchCount}` : '0'}
              </span>
              <button
                type="button"
                title="Очистить поиск"
                aria-label="Очистить поиск по сообщениям"
                onClick={() => onMessageSearch('')}
              >
                <X />
              </button>
            </>
          ) : null}
        </label>
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
    title: string,
    dataUrl: string | undefined,
    positionX: number,
    positionY: number,
    scale: number,
  ): Promise<boolean>;
}) {
  const [dataUrl, setDataUrl] = useState<string>();
  const [title, setTitle] = useState(chat.title?.trim() ?? '');
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

  return createPortal(
    <div className={`group-editor-backdrop${closing ? ' closing' : ''}`}>
      <div
        ref={editorRef}
        className={`group-avatar-editor${closing ? ' closing' : ''}`}
        role="dialog"
        aria-label="Редактировать группу"
        aria-modal="true"
      >
        <div className="group-avatar-editor-heading">
          <div>
            <strong>Редактировать группу</strong>
            <small>Настройте название и фотографию</small>
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
        <label className="group-title-field">
          <span>Название группы</span>
          <input
            value={title}
            maxLength={80}
            placeholder="Название группы"
            aria-label="Название группы"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
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
          <button type="button" className="secondary" disabled={busy} onClick={closeSmoothly}>
            Отмена
          </button>
          <button
            type="button"
            disabled={busy || !title.trim()}
            onClick={() =>
              void onSave(title.trim(), dataUrl, position.x, position.y, scale).then((saved) => {
                if (saved) closeSmoothly();
              })
            }
          >
            <Save /> {busy ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
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
  onMemberProfile,
}: {
  profile?: ChatProfile;
  loading: boolean;
  fallback?: ChatMember;
  groupTitle?: string;
  members: ChatMember[];
  onInvite(): void;
  onFullProfile(): void;
  onMemberProfile(member: ChatMember): void;
}) {
  const avatarUrl = profile?.avatarUrl ?? fallback?.avatarUrl;
  const cachedAvatarUrl = useCachedMediaUrl(avatarUrl);
  const cachedCoverUrl = useCachedMediaUrl(profile?.coverUrl);
  if (groupTitle)
    return (
      <aside className="chat-profile-panel group-members-panel" aria-label="Участники группы">
        <section className="group-members-heading">
          <p>Участники — {members.length}</p>
        </section>
        <div className="group-members-list">
          {[...members]
            .sort((first, second) =>
              first.role === 'owner' ? -1 : second.role === 'owner' ? 1 : 0,
            )
            .map((member) => (
              <div className="group-member-row" key={member.id}>
                <button
                  type="button"
                  className="group-member-profile"
                  aria-label={`Открыть профиль ${member.displayName}`}
                  onClick={() => onMemberProfile(member)}
                >
                  <ChatAvatar
                    name={member.displayName}
                    group={false}
                    avatarUrl={member.avatarUrl}
                    presence={member.presence}
                    compact
                  />
                </button>
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
        <div className="chat-profile-island">
          <div className="profile-panel-skeleton" />
        </div>
      </aside>
    );
  const name = profile?.displayName ?? fallback?.displayName ?? groupTitle ?? 'Профиль';
  return (
    <aside className="chat-profile-panel" aria-label="Профиль собеседника">
      <div className="chat-profile-island">
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
      </div>
    </aside>
  );
}

function presenceLabel(status: PresenceStatus = 'offline') {
  if (status === 'online') return 'В сети';
  if (status === 'away') return 'Нет на месте';
  if (status === 'dnd') return 'Не беспокоить';
  return 'Не в сети';
}

function memberCountLabel(count: number) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  const noun =
    mod100 >= 11 && mod100 <= 14
      ? 'участников'
      : mod10 === 1
        ? 'участник'
        : mod10 >= 2 && mod10 <= 4
          ? 'участника'
          : 'участников';
  return `${count} ${noun}`;
}

const QUICK_MESSAGE_REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🔥'];
const MESSAGE_REACTION_PALETTE = [
  '❤️',
  '🧡',
  '💛',
  '💚',
  '💙',
  '💜',
  '🖤',
  '🤍',
  '👍',
  '👎',
  '👏',
  '🙌',
  '🤝',
  '🙏',
  '💪',
  '👌',
  '😂',
  '🤣',
  '😊',
  '😍',
  '🥰',
  '😘',
  '😎',
  '🤩',
  '😮',
  '😱',
  '🤯',
  '😢',
  '😭',
  '😡',
  '🤔',
  '🫡',
  '🔥',
  '✨',
  '🎉',
  '💯',
  '✅',
  '❌',
  '⚡',
  '💥',
  '🚀',
  '👀',
  '💀',
  '🤡',
  '🎯',
  '🏆',
  '⚽',
  '🎮',
];

interface MessageContextState {
  message: MessageItem;
  x: number;
  y: number;
  expanded: boolean;
  pickerOnly?: boolean;
}

export function MessageList({
  chatId,
  userId,
  groupChat,
  messages,
  pinnedMessage: loadedPinnedMessage,
  loading,
  error,
  sentMessageVersion,
  hasMore = false,
  onRetry,
  onLoadOlder = async () => {},
  onJoinCall,
  onJoinInvite = async () => false,
  chats = [],
  canModerateMessages = false,
  canPinMessages = true,
  onReply = () => {},
  onReact = async () => false,
  onPin = async () => false,
  onEdit = async () => false,
  onDelete = async () => false,
  onForward = async () => false,
  onReveal = async () => false,
  searchQuery = '',
  focusedMessageId,
}: {
  chatId: string;
  userId: string;
  groupChat: boolean;
  messages: MessageItem[];
  pinnedMessage?: MessageItem;
  loading: boolean;
  error: string;
  sentMessageVersion: number;
  hasMore?: boolean;
  onRetry(): void;
  onLoadOlder?(): Promise<void>;
  onJoinCall(roomId: string): void;
  onJoinInvite?(token: string): Promise<boolean>;
  chats?: ChatItem[];
  canModerateMessages?: boolean;
  canPinMessages?: boolean;
  onReply?(message: MessageItem): void;
  onReact?(messageId: string, emoji: string | null): Promise<boolean>;
  onPin?(messageId: string, pinned: boolean): Promise<boolean>;
  onEdit?(messageId: string, body: string): Promise<boolean>;
  onDelete?(messageId: string): Promise<boolean>;
  onForward?(messageId: string, targetChatId: string): Promise<boolean>;
  onReveal?(messageId: string): Promise<boolean>;
  searchQuery?: string;
  focusedMessageId?: string;
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
  const [viewingOlderMessages, setViewingOlderMessages] = useState(false);
  const [recentReactions, setRecentReactions] = useState(storedRecentMessageReactions);
  const [olderBusy, setOlderBusy] = useState(false);
  const [contextMenu, setContextMenu] = useState<MessageContextState>();
  const [forwardingMessage, setForwardingMessage] = useState<MessageItem>();
  const [deletingMessage, setDeletingMessage] = useState<MessageItem>();
  const [editingMessage, setEditingMessage] = useState<MessageItem>();
  const [editingPending, setEditingPending] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const menuRef = useRef<HTMLDivElement>(null);
  const pinnedMessage =
    loadedPinnedMessage ?? [...messages].reverse().find((message) => message.pinned_at);

  useEffect(() => {
    setContextMenu(undefined);
    setForwardingMessage(undefined);
    setDeletingMessage(undefined);
    setEditingMessage(undefined);
    setSelectedIds(new Set());
  }, [chatId]);

  useEffect(() => {
    if (!focusedMessageId) return;
    const target = Array.from(
      contentRef.current?.querySelectorAll<HTMLElement>('[data-message-id]') ?? [],
    ).find((entry) => entry.dataset.messageId === focusedMessageId);
    target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }, [focusedMessageId]);

  useEffect(() => {
    setContextMenu((current) => {
      if (!current) return current;
      const latest = messages.find((message) => message.id === current.message.id);
      return latest ? { ...current, message: latest } : undefined;
    });
    setSelectedIds((current) => {
      if (!current.size) return current;
      const available = new Set(messages.map((message) => message.id));
      const next = new Set([...current].filter((messageId) => available.has(messageId)));
      return next.size === current.size ? current : next;
    });
  }, [messages]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setContextMenu(undefined);
    };
    const closeOnKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(undefined);
    };
    const closeOnViewportChange = () => setContextMenu(undefined);
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', closeOnKey);
    window.addEventListener('resize', closeOnViewportChange);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', closeOnKey);
      window.removeEventListener('resize', closeOnViewportChange);
    };
  }, [contextMenu]);

  const contextMenuMessageId = contextMenu?.message.id;
  useEffect(() => {
    if (!contextMenuMessageId) return;
    const frame = window.requestAnimationFrame(() =>
      menuRef.current?.querySelector<HTMLElement>('button:not(:disabled), input')?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [contextMenuMessageId]);

  const openMessageContext = (
    message: MessageItem,
    x: number,
    y: number,
    options: { expanded?: boolean; pickerOnly?: boolean } = {},
  ) => {
    const width = 286;
    const height = message.kind === 'system' || message.kind === 'call' ? 260 : 380;
    setContextMenu({
      message,
      x: Math.max(10, Math.min(x, window.innerWidth - width - 10)),
      y: Math.max(10, Math.min(y, window.innerHeight - height - 10)),
      expanded: options.expanded ?? false,
      pickerOnly: options.pickerOnly,
    });
  };

  const toggleSelected = (messageId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  };

  const rememberReaction = (emoji: string) => {
    setRecentReactions((current) => {
      const next = [emoji, ...current.filter((candidate) => candidate !== emoji)].slice(0, 3);
      try {
        window.localStorage.setItem(RECENT_MESSAGE_REACTIONS_KEY, JSON.stringify(next));
      } catch {
        // Keep the in-memory history when storage is unavailable.
      }
      return next;
    });
  };

  const copyMessages = async (items: MessageItem[]) => {
    const text = items
      .filter((message) => !message.metadata?.deleted && !message.deleted_at)
      .map((message) => message.body)
      .filter(Boolean)
      .join('\n');
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch {
      // Older WKWebView builds may expose Clipboard API but reject custom-scheme pages.
    }
    const fallback = document.createElement('textarea');
    fallback.value = text;
    fallback.style.position = 'fixed';
    fallback.style.opacity = '0';
    document.body.append(fallback);
    fallback.select();
    document.execCommand('copy');
    fallback.remove();
  };

  const revealMessage = async (messageId: string) => {
    if (scrollToReferencedMessage(messageId)) return;
    if (!(await onReveal(messageId))) return;
    window.requestAnimationFrame(() => scrollToReferencedMessage(messageId));
  };

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
    setViewingOlderMessages(false);
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
    if (contextMenu) setContextMenu(undefined);
    const nearBottom = isNearBottom(container, OLD_MESSAGES_NOTICE_THRESHOLD);
    nearBottomRef.current = nearBottom;
    setViewingOlderMessages(!nearBottom && messages.length > 0);
    if (nearBottom && newMessageCount) setNewMessageCount(0);
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
      {pinnedMessage ? (
        <div className="message-pinned-banner">
          <button
            type="button"
            className="message-pinned-jump"
            onClick={() => void revealMessage(pinnedMessage.id)}
          >
            <Pin />
            <span>
              <strong>Закреплённое сообщение</strong>
              <small>{pinnedMessage.body || mediaKindLabel(pinnedMessage.kind)}</small>
            </span>
          </button>
          {canPinMessages ? (
            <button
              type="button"
              className="message-pinned-remove"
              aria-label="Открепить сообщение"
              onClick={() => void onPin(pinnedMessage.id, false)}
            >
              <X />
            </button>
          ) : null}
        </div>
      ) : null}
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
              const searchMatch = Boolean(
                searchQuery.trim() &&
                message.body
                  .toLocaleLowerCase('ru-RU')
                  .includes(searchQuery.trim().toLocaleLowerCase('ru-RU')),
              );
              return (
                <div
                  className={`message-entry${selectedIds.has(message.id) ? ' selected' : ''}${searchMatch ? ' search-match' : ''}${message.id === focusedMessageId ? ' search-current' : ''}`}
                  data-message-id={message.id}
                  key={message.id}
                >
                  {showDate && <DateSeparator date={message.created_at} />}
                  {message.kind === 'call' || message.kind === 'system' ? (
                    <MessageEventRow
                      message={message}
                      selected={selectedIds.has(message.id)}
                      onContextMenu={openMessageContext}
                      onReply={() => onReply(message)}
                      onForward={() => setForwardingMessage(message)}
                      onToggleSelected={() => toggleSelected(message.id)}
                    >
                      {message.kind === 'call' ? (
                        <SystemCallMessage message={message} onJoin={onJoinCall} />
                      ) : (
                        <div className="system-message">
                          <span>{message.body}</span>
                          <time>{formatMessageTime(message.created_at)}</time>
                        </div>
                      )}
                    </MessageEventRow>
                  ) : (
                    <MessageBubble
                      message={message}
                      accountId={userId}
                      own={message.sender_id === userId}
                      grouped={grouped}
                      showAuthor={groupChat && !grouped && message.sender_id !== userId}
                      selected={selectedIds.has(message.id)}
                      onJoinCall={onJoinCall}
                      onJoinInvite={onJoinInvite}
                      onContextMenu={openMessageContext}
                      quickReactions={recentReactions}
                      onToggleReaction={(emoji) => {
                        if (emoji) rememberReaction(emoji);
                        void onReact(message.id, emoji);
                      }}
                      onEdit={() => setEditingMessage(message)}
                      onForward={() => setForwardingMessage(message)}
                      onToggleSelected={() => toggleSelected(message.id)}
                      onRevealMessage={(messageId) => void revealMessage(messageId)}
                    />
                  )}
                </div>
              );
            })
          )}
          <div className="message-bottom-anchor" ref={bottomAnchorRef} aria-hidden="true" />
        </div>
      </div>
      {viewingOlderMessages ? (
        <div className="message-history-position" role="status">
          <span>Вы просматриваете старые сообщения</span>
          <button type="button" onClick={() => scrollToBottom(true)}>
            Вернуться к последним сообщениям
            {newMessageCount > 0 ? <b>{newMessageCount}</b> : null}
            <ArrowDown />
          </button>
        </div>
      ) : null}
      {contextMenu
        ? createPortal(
            <MessageContextMenu
              menuRef={menuRef}
              state={contextMenu}
              accountId={userId}
              own={contextMenu.message.sender_id === userId}
              canDelete={contextMenu.message.sender_id === userId || canModerateMessages}
              canPin={canPinMessages}
              onExpand={() =>
                setContextMenu((current) =>
                  current ? { ...current, expanded: !current.expanded } : current,
                )
              }
              onReact={(emoji) => {
                const active = contextMenu.message.reactions?.find(
                  (reaction) => reaction.emoji === emoji && reactionMine(reaction, userId),
                );
                if (!active) rememberReaction(emoji);
                void onReact(contextMenu.message.id, active ? null : emoji);
                setContextMenu(undefined);
              }}
              onReply={() => {
                onReply(contextMenu.message);
                setContextMenu(undefined);
              }}
              onEdit={() => {
                setEditingMessage(contextMenu.message);
                setContextMenu(undefined);
              }}
              onPin={() => {
                void onPin(contextMenu.message.id, !contextMenu.message.pinned_at);
                setContextMenu(undefined);
              }}
              onCopy={() => {
                void copyMessages([contextMenu.message]);
                setContextMenu(undefined);
              }}
              onForward={() => {
                setForwardingMessage(contextMenu.message);
                setContextMenu(undefined);
              }}
              onDelete={() => {
                setDeletingMessage(contextMenu.message);
                setContextMenu(undefined);
              }}
              onSelect={() => {
                toggleSelected(contextMenu.message.id);
                setContextMenu(undefined);
              }}
            />,
            document.body,
          )
        : null}
      {selectedIds.size > 0 ? (
        <div className="message-selection-bar" role="toolbar" aria-label="Выбранные сообщения">
          <strong>{selectedIds.size}</strong>
          <span>выбрано</span>
          <button
            type="button"
            title="Копировать"
            aria-label="Копировать выбранные сообщения"
            onClick={() =>
              void copyMessages(messages.filter((message) => selectedIds.has(message.id)))
            }
          >
            <Copy />
          </button>
          {selectedIds.size === 1 ? (
            <button
              type="button"
              title="Переслать"
              aria-label="Переслать выбранное сообщение"
              onClick={() =>
                setForwardingMessage(messages.find((message) => selectedIds.has(message.id)))
              }
            >
              <Forward />
            </button>
          ) : null}
          <button
            type="button"
            title="Снять выделение"
            aria-label="Снять выделение"
            onClick={() => setSelectedIds(new Set())}
          >
            <X />
          </button>
        </div>
      ) : null}
      {forwardingMessage ? (
        <ForwardMessageDialog
          message={forwardingMessage}
          chats={chats}
          userId={userId}
          currentChatId={chatId}
          busy={actionPending}
          onClose={() => !actionPending && setForwardingMessage(undefined)}
          onForward={(targetChatId) => {
            setActionPending(true);
            void onForward(forwardingMessage.id, targetChatId)
              .then((sent) => {
                if (sent) {
                  setForwardingMessage(undefined);
                  setSelectedIds(new Set());
                }
              })
              .finally(() => setActionPending(false));
          }}
        />
      ) : null}
      {editingMessage ? (
        <EditMessageDialog
          message={editingMessage}
          busy={editingPending}
          onClose={() => !editingPending && setEditingMessage(undefined)}
          onSave={(body) => {
            setEditingPending(true);
            void onEdit(editingMessage.id, body)
              .then((saved) => saved && setEditingMessage(undefined))
              .finally(() => setEditingPending(false));
          }}
        />
      ) : null}
      {deletingMessage ? (
        <ChatActionConfirmDialog
          title="Удалить сообщение?"
          description="Сообщение исчезнет у всех участников этого чата."
          confirmLabel="Удалить"
          busy={actionPending}
          error=""
          onCancel={() => !actionPending && setDeletingMessage(undefined)}
          onConfirm={() => {
            setActionPending(true);
            void onDelete(deletingMessage.id)
              .then((deleted) => {
                if (deleted) {
                  setDeletingMessage(undefined);
                  setSelectedIds((current) => {
                    const next = new Set(current);
                    next.delete(deletingMessage.id);
                    return next;
                  });
                }
              })
              .finally(() => setActionPending(false));
          }}
        />
      ) : null}
    </div>
  );
}

function MessageBubble({
  message,
  accountId,
  own,
  grouped,
  showAuthor,
  selected,
  onJoinCall,
  onJoinInvite,
  onContextMenu,
  quickReactions,
  onToggleReaction,
  onEdit,
  onForward,
  onToggleSelected,
  onRevealMessage,
}: {
  message: MessageItem;
  accountId: string;
  own: boolean;
  grouped: boolean;
  showAuthor: boolean;
  selected: boolean;
  onJoinCall(roomId: string): void;
  onJoinInvite(token: string): Promise<boolean>;
  onContextMenu(
    message: MessageItem,
    x: number,
    y: number,
    options?: { expanded?: boolean; pickerOnly?: boolean },
  ): void;
  quickReactions: string[];
  onToggleReaction(emoji: string | null): void;
  onEdit(): void;
  onForward(): void;
  onToggleSelected(): void;
  onRevealMessage(messageId: string): void;
}) {
  const longPressTimerRef = useRef<number | undefined>(undefined);
  const longPressStartRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const longPressTriggeredRef = useRef(false);
  const inviteToken = extractChatInviteToken(message.body);
  const roomInviteId = parseRoomDeepLink(message.body.trim());
  const isInvite = Boolean(inviteToken || roomInviteId);
  const replyTo = message.reply_to ?? message.metadata?.replyTo;
  const forwardedFrom = message.forwarded_from ?? message.metadata?.forwardedFrom;
  const forwardedName = forwardedFrom?.display_name ?? forwardedFrom?.displayName;
  const gif = message.metadata?.gif;
  const deleted = Boolean(message.deleted_at || message.metadata?.deleted);
  const canEdit = own && message.kind === 'text' && !gif && !deleted;
  const openContext = (x: number, y: number) => {
    if (deleted) return;
    onContextMenu(message, x, y);
  };
  const cancelLongPress = () => {
    if (longPressTimerRef.current !== undefined) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = undefined;
    longPressStartRef.current = undefined;
  };
  useEffect(() => cancelLongPress, []);
  return (
    <article
      className={`message-bubble-row ${own ? 'own' : 'remote'} ${grouped ? 'grouped' : ''}${selected ? ' selected' : ''}`}
      tabIndex={deleted ? undefined : 0}
      aria-selected={selected || undefined}
      onPointerDown={(event) => {
        if (deleted || event.pointerType === 'mouse' || event.button !== 0) return;
        cancelLongPress();
        longPressTriggeredRef.current = false;
        longPressStartRef.current = { x: event.clientX, y: event.clientY };
        longPressTimerRef.current = window.setTimeout(() => {
          longPressTimerRef.current = undefined;
          longPressTriggeredRef.current = true;
          openContext(event.clientX, event.clientY);
        }, 480);
      }}
      onPointerMove={(event) => {
        const start = longPressStartRef.current;
        if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 9) return;
        cancelLongPress();
      }}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onClickCapture={(event) => {
        if (!longPressTriggeredRef.current) return;
        longPressTriggeredRef.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        openContext(event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        openContext(rect.left + Math.min(rect.width, 150), rect.top + 24);
      }}
    >
      {!grouped && (
        <ChatAvatar
          name={message.display_name || message.username || 'Участник'}
          group={false}
          avatarUrl={message.avatar_url}
          compact
        />
      )}
      <div className="message-bubble-stack">
        {!deleted ? (
          <div className="message-hover-actions" role="toolbar" aria-label="Быстрые действия">
            {quickReactions.map((emoji) => (
              <button
                type="button"
                className="message-hover-reaction"
                aria-label={`Поставить реакцию ${emoji}`}
                onClick={() => {
                  const active = message.reactions?.some(
                    (reaction) => reaction.emoji === emoji && reactionMine(reaction, accountId),
                  );
                  onToggleReaction(active ? null : emoji);
                }}
                key={emoji}
              >
                {emoji}
              </button>
            ))}
            <button
              type="button"
              aria-label="Выбрать другую реакцию"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                onContextMenu(message, rect.right - 286, rect.bottom + 6, {
                  expanded: true,
                  pickerOnly: true,
                });
              }}
            >
              <Smile />
            </button>
            {canEdit ? (
              <button type="button" aria-label="Изменить сообщение" onClick={onEdit}>
                <Pencil />
              </button>
            ) : null}
            <button type="button" aria-label="Переслать сообщение" onClick={onForward}>
              <Forward />
            </button>
            <button
              type="button"
              aria-label="Другие действия"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                onContextMenu(message, rect.right - 286, rect.bottom + 6);
              }}
            >
              <MoreHorizontal />
            </button>
          </div>
        ) : null}
        <div
          className={`message-bubble${message.kind === 'image' ? ' image-message-bubble' : ''}${gif ? ' gif-message-bubble' : ''}${isInvite ? ' invite-message-bubble' : ''}${deleted ? ' deleted' : ''}`}
        >
          {showAuthor && !deleted ? (
            <strong className="message-author">
              {message.display_name || message.username || 'Участник'}
            </strong>
          ) : null}
          {forwardedName && !deleted ? (
            <span className="message-forwarded-label">
              <Forward /> Переслано от {forwardedName}
            </span>
          ) : null}
          {replyTo && !deleted ? (
            <button
              type="button"
              className="message-reply-quote"
              onClick={() => onRevealMessage(replyTo.id)}
            >
              <strong>{replyTo.display_name || replyTo.username || 'Сообщение'}</strong>
              <span>
                {replyTo.deleted
                  ? 'Сообщение удалено'
                  : replyTo.body || mediaKindLabel(replyTo.kind)}
              </span>
            </button>
          ) : null}
          {deleted ? (
            <p className="deleted-message-copy">Сообщение удалено</p>
          ) : gif ? (
            <GifMessage gif={gif} />
          ) : message.kind === 'image' ? (
            <ChatImageMessage message={message} accountId={accountId} />
          ) : inviteToken ? (
            <InviteMessageCard token={inviteToken} onJoin={onJoinInvite} />
          ) : roomInviteId ? (
            <RoomInviteMessageCard roomId={roomInviteId} onJoin={onJoinCall} />
          ) : (
            <p>{message.body}</p>
          )}
          <span className="message-meta">
            {message.edited_at ? <small>изменено</small> : null}
            {message.pinned_at ? <Pin aria-label="Закреплено" /> : null}
            <time>{formatMessageTime(message.created_at)}</time>
          </span>
        </div>
        {!deleted && message.reactions?.length ? (
          <div className="message-reactions" aria-label="Реакции на сообщение">
            {message.reactions.map((reaction) => (
              <button
                type="button"
                className={reactionMine(reaction, accountId) ? 'mine' : ''}
                aria-label={`${reaction.emoji}: ${reaction.count}`}
                aria-pressed={reactionMine(reaction, accountId)}
                onClick={() =>
                  onToggleReaction(reactionMine(reaction, accountId) ? null : reaction.emoji)
                }
                key={reaction.emoji}
              >
                <span>{reaction.emoji}</span>
                <b>{reaction.count}</b>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {selected ? (
        <button
          type="button"
          className="message-selection-check"
          aria-label="Снять выделение сообщения"
          onClick={onToggleSelected}
        >
          <CheckCircle2 />
        </button>
      ) : null}
    </article>
  );
}

function mediaKindLabel(kind: string) {
  if (kind === 'image') return 'Фотография';
  if (kind === 'call') return 'Звонок';
  return 'Сообщение';
}

function reactionMine(reaction: MessageReaction, userId: string) {
  return reaction.reactedByMe === true || reaction.userIds?.includes(userId) === true;
}

function scrollToReferencedMessage(messageId: string) {
  const target = [...document.querySelectorAll<HTMLElement>('[data-message-id]')].find(
    (entry) => entry.dataset.messageId === messageId,
  );
  if (!target) return false;
  if (typeof target.scrollIntoView === 'function')
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.remove('message-target-highlight');
  window.requestAnimationFrame(() => target.classList.add('message-target-highlight'));
  window.setTimeout(() => target.classList.remove('message-target-highlight'), 1_150);
  return true;
}

function GifMessage({ gif }: { gif: GifMessageData }) {
  const cachedUrl = useCachedMediaUrl(gif.url);
  return (
    <figure
      className="chat-gif-message"
      style={{ aspectRatio: gif.width && gif.height ? `${gif.width} / ${gif.height}` : undefined }}
    >
      {cachedUrl ? <img src={cachedUrl} alt={gif.alt || 'GIF'} draggable={false} /> : <span />}
      <figcaption>
        <span>GIF</span>
        <a
          href={gif.attribution.pageUrl}
          target="_blank"
          rel="noreferrer"
          title={gif.attribution.license || 'Источник GIF'}
        >
          {gif.attribution.provider}
        </a>
      </figcaption>
    </figure>
  );
}

function MessageContextMenu({
  menuRef,
  state,
  accountId,
  own,
  canDelete,
  canPin,
  onExpand,
  onReact,
  onReply,
  onEdit,
  onPin,
  onCopy,
  onForward,
  onDelete,
  onSelect,
}: {
  menuRef: { current: HTMLDivElement | null };
  state: MessageContextState;
  accountId: string;
  own: boolean;
  canDelete: boolean;
  canPin: boolean;
  onExpand(): void;
  onReact(emoji: string): void;
  onReply(): void;
  onEdit(): void;
  onPin(): void;
  onCopy(): void;
  onForward(): void;
  onDelete(): void;
  onSelect(): void;
}) {
  const [customReaction, setCustomReaction] = useState('');
  const reactionsAllowed = state.message.kind !== 'system' && state.message.kind !== 'call';
  const customReactionValid = chatReactionEmojiSchema.safeParse(customReaction.trim()).success;
  const reactionIsActive = (emoji: string) =>
    state.message.reactions?.some(
      (reaction) => reaction.emoji === emoji && reactionMine(reaction, accountId),
    ) === true;
  const submitCustomReaction = () => {
    const emoji = customReaction.trim();
    if (customReactionValid) onReact(emoji);
  };
  return (
    <div
      ref={menuRef}
      className={`message-context-menu${state.expanded ? ' expanded' : ''}`}
      style={{ left: state.x, top: state.y }}
      role="menu"
      aria-label="Действия с сообщением"
      onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input'),
        ];
        if (!controls.length) return;
        event.preventDefault();
        const currentIndex = controls.indexOf(document.activeElement as HTMLElement);
        const nextIndex =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? controls.length - 1
              : event.key === 'ArrowUp'
                ? (currentIndex - 1 + controls.length) % controls.length
                : (currentIndex + 1) % controls.length;
        controls[nextIndex]?.focus();
      }}
    >
      {reactionsAllowed && !state.pickerOnly ? (
        <div className="message-quick-reactions" aria-label="Быстрые реакции">
          {QUICK_MESSAGE_REACTIONS.map((emoji) => (
            <button
              type="button"
              aria-label={`Поставить реакцию ${emoji}`}
              aria-pressed={reactionIsActive(emoji)}
              onClick={() => onReact(emoji)}
              key={emoji}
            >
              {emoji}
            </button>
          ))}
          <button
            type="button"
            className="reaction-expand-button"
            aria-label="Все реакции"
            aria-expanded={state.expanded}
            onClick={onExpand}
          >
            <ChevronDown />
          </button>
        </div>
      ) : null}
      {reactionsAllowed && (state.expanded || state.pickerOnly) ? (
        <div className="message-reaction-picker" aria-label="Выбор реакции">
          <div className="message-reaction-palette">
            {MESSAGE_REACTION_PALETTE.map((emoji) => (
              <button
                type="button"
                aria-label={`Поставить реакцию ${emoji}`}
                aria-pressed={reactionIsActive(emoji)}
                onClick={() => onReact(emoji)}
                key={emoji}
              >
                {emoji}
              </button>
            ))}
          </div>
          <label className="message-custom-reaction">
            <span className="sr-only">Любой эмодзи</span>
            <input
              value={customReaction}
              maxLength={16}
              placeholder="Вставьте любой эмодзи"
              aria-label="Любой эмодзи"
              onChange={(event) => setCustomReaction(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                submitCustomReaction();
              }}
            />
            <button
              type="button"
              disabled={!customReactionValid}
              aria-label="Поставить введённую реакцию"
              onClick={submitCustomReaction}
            >
              <Send />
            </button>
          </label>
        </div>
      ) : null}
      {!state.pickerOnly ? (
        <div className="message-context-actions">
          <button type="button" role="menuitem" onClick={onReply}>
            <Reply /> Ответить
          </button>
          {own && state.message.kind === 'text' && !state.message.metadata?.gif ? (
            <button type="button" role="menuitem" onClick={onEdit}>
              <Pencil /> Изменить
            </button>
          ) : null}
          {canPin ? (
            <button type="button" role="menuitem" onClick={onPin}>
              {state.message.pinned_at ? <PinOff /> : <Pin />}
              {state.message.pinned_at ? 'Открепить' : 'Закрепить'}
            </button>
          ) : null}
          <button type="button" role="menuitem" onClick={onCopy}>
            <Copy /> Копировать текст
          </button>
          <button type="button" role="menuitem" onClick={onForward}>
            <Forward /> Переслать
          </button>
          {canDelete ? (
            <button type="button" role="menuitem" className="destructive" onClick={onDelete}>
              <Trash2 /> Удалить{own ? '' : ' как администратор'}
            </button>
          ) : null}
          <button type="button" role="menuitem" onClick={onSelect}>
            <CheckCircle2 /> Выделить
          </button>
        </div>
      ) : null}
    </div>
  );
}

function EditMessageDialog({
  message,
  busy,
  onClose,
  onSave,
}: {
  message: MessageItem;
  busy: boolean;
  onClose(): void;
  onSave(body: string): void;
}) {
  const [body, setBody] = useState(message.body);
  const trimmed = body.trim();
  const canSave = Boolean(trimmed) && trimmed !== message.body && !busy;
  return createPortal(
    <div className="forward-message-backdrop" onPointerDown={onClose}>
      <section
        className="edit-message-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Изменить сообщение"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header>
          <strong>Изменить сообщение</strong>
          <button type="button" aria-label="Закрыть" disabled={busy} onClick={onClose}>
            <X />
          </button>
        </header>
        <textarea
          autoFocus
          value={body}
          maxLength={4000}
          aria-label="Текст сообщения"
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
            if (event.key !== 'Enter' || event.shiftKey) return;
            event.preventDefault();
            if (canSave) onSave(trimmed);
          }}
        />
        <footer>
          <small>Enter — сохранить, Shift + Enter — новая строка</small>
          <button type="button" disabled={!canSave} onClick={() => onSave(trimmed)}>
            <Save /> {busy ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function ForwardMessageDialog({
  message,
  chats,
  userId,
  currentChatId,
  busy,
  onClose,
  onForward,
}: {
  message: MessageItem;
  chats: ChatItem[];
  userId: string;
  currentChatId: string;
  busy: boolean;
  onClose(): void;
  onForward(chatId: string): void;
}) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase('ru-RU');
  const targets = chats.filter(
    (chat) =>
      chat.id !== currentChatId &&
      (!query || chatName(chat, userId).toLocaleLowerCase('ru-RU').includes(query)),
  );
  return createPortal(
    <div className="forward-message-backdrop" onPointerDown={onClose}>
      <section
        className="forward-message-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Переслать сообщение"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong>Переслать сообщение</strong>
            <small>{message.body || mediaKindLabel(message.kind)}</small>
          </div>
          <button type="button" aria-label="Закрыть" disabled={busy} onClick={onClose}>
            <X />
          </button>
        </header>
        <label>
          <Search />
          <input
            value={search}
            autoFocus
            placeholder="Найти чат"
            aria-label="Найти чат для пересылки"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="forward-chat-list">
          {targets.length ? (
            targets.map((chat) => (
              <button
                type="button"
                disabled={busy}
                onClick={() => onForward(chat.id)}
                key={chat.id}
              >
                <ChatAvatar
                  name={chatName(chat, userId)}
                  group={chat.type === 'group'}
                  avatarUrl={
                    chat.type === 'group'
                      ? chat.avatarUrl
                      : chat.members.find((member) => member.id !== userId)?.avatarUrl
                  }
                  compact
                />
                <span>
                  <strong>{chatName(chat, userId)}</strong>
                  <small>{chat.type === 'group' ? 'Группа' : 'Личный чат'}</small>
                </span>
                <Forward />
              </button>
            ))
          ) : (
            <p>Подходящих чатов нет</p>
          )}
        </div>
      </section>
    </div>,
    document.body,
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

function MessageEventRow({
  message,
  selected,
  children,
  onContextMenu,
  onReply,
  onForward,
  onToggleSelected,
}: {
  message: MessageItem;
  selected: boolean;
  children: ReactNode;
  onContextMenu(message: MessageItem, x: number, y: number): void;
  onReply(): void;
  onForward(): void;
  onToggleSelected(): void;
}) {
  const longPressTimerRef = useRef<number | undefined>(undefined);
  const longPressStartRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const longPressTriggeredRef = useRef(false);
  const openContext = (x: number, y: number) => onContextMenu(message, x, y);
  const cancelLongPress = () => {
    if (longPressTimerRef.current !== undefined) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = undefined;
    longPressStartRef.current = undefined;
  };
  useEffect(() => cancelLongPress, []);
  return (
    <article
      className={`message-event-row${selected ? ' selected' : ''}`}
      tabIndex={0}
      aria-selected={selected || undefined}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse' || event.button !== 0) return;
        cancelLongPress();
        longPressTriggeredRef.current = false;
        longPressStartRef.current = { x: event.clientX, y: event.clientY };
        longPressTimerRef.current = window.setTimeout(() => {
          longPressTimerRef.current = undefined;
          longPressTriggeredRef.current = true;
          openContext(event.clientX, event.clientY);
        }, 480);
      }}
      onPointerMove={(event) => {
        const start = longPressStartRef.current;
        if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 9) return;
        cancelLongPress();
      }}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onClickCapture={(event) => {
        if (!longPressTriggeredRef.current) return;
        longPressTriggeredRef.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        openContext(event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        openContext(rect.left + Math.min(rect.width, 150), rect.top + 24);
      }}
    >
      <div
        className="message-hover-actions event-message-actions"
        role="toolbar"
        aria-label="Быстрые действия"
      >
        <button type="button" aria-label="Ответить на сообщение" onClick={onReply}>
          <Reply />
        </button>
        <button type="button" aria-label="Переслать сообщение" onClick={onForward}>
          <Forward />
        </button>
        <button
          type="button"
          aria-label="Другие действия"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            openContext(rect.right - 286, rect.bottom + 6);
          }}
        >
          <MoreHorizontal />
        </button>
      </div>
      {children}
      {selected ? (
        <button
          type="button"
          className="message-selection-check"
          aria-label="Снять выделение сообщения"
          onClick={onToggleSelected}
        >
          <CheckCircle2 />
        </button>
      ) : null}
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
    <div className={`system-call-message${ended ? ' ended' : ''}`}>
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
    </div>
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
  onSendGif,
  replyTarget,
  onCancelReply,
}: {
  disabled: boolean;
  onSend(body: string, replyToMessageId?: string): Promise<boolean>;
  onSendImage(
    dataUrl: string,
    caption: string,
    thumbnailDataUrl: string,
    replyToMessageId?: string,
  ): Promise<boolean>;
  onSendGif(gif: GifMessageData, replyToMessageId?: string): Promise<boolean>;
  replyTarget?: MessageItem;
  onCancelReply(): void;
}) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [processingImage, setProcessingImage] = useState(false);
  const [imageDataUrl, setImageDataUrl] = useState('');
  const [thumbnailDataUrl, setThumbnailDataUrl] = useState('');
  const [imageError, setImageError] = useState('');
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [composerMenu, setComposerMenu] = useState<{
    x: number;
    y: number;
    section?: 'suggestions' | 'languages';
  }>();
  const [spellCheckEnabled, setSpellCheckEnabled] = useState(true);
  const [showSendButton, setShowSendButton] = useState(true);
  const [composerLanguage, setComposerLanguage] = useState<'ru' | 'en' | 'auto'>('ru');
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!composerMenu) return;
    const close = (event: globalThis.PointerEvent) => {
      if (!composerMenuRef.current?.contains(event.target as Node)) setComposerMenu(undefined);
    };
    const closeOnKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setComposerMenu(undefined);
    };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', closeOnKey);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', closeOnKey);
    };
  }, [composerMenu]);
  const pasteClipboardText = async () => {
    try {
      const pasted = await navigator.clipboard.readText();
      if (!pasted) return;
      const textarea = textareaRef.current;
      const start = textarea?.selectionStart ?? value.length;
      const end = textarea?.selectionEnd ?? start;
      const next = `${value.slice(0, start)}${pasted}${value.slice(end)}`.slice(
        0,
        imageDataUrl ? 1000 : 4000,
      );
      setValue(next);
      window.requestAnimationFrame(() => {
        const cursor = Math.min(start + pasted.length, next.length);
        textarea?.focus();
        textarea?.setSelectionRange(cursor, cursor);
      });
    } catch {
      textareaRef.current?.focus();
    } finally {
      setComposerMenu(undefined);
    }
  };
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
        ? replyTarget
          ? await onSendImage(imageDataUrl, body, thumbnailDataUrl, replyTarget.id)
          : await onSendImage(imageDataUrl, body, thumbnailDataUrl)
        : replyTarget
          ? await onSend(body, replyTarget.id)
          : await onSend(body);
      if (sent) {
        setValue('');
        setImageDataUrl('');
        setThumbnailDataUrl('');
        setImageError('');
        onCancelReply();
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
    <div className={`modern-message-composer${showSendButton ? '' : ' send-button-hidden'}`}>
      {replyTarget ? (
        <div className="composer-reply-preview">
          <Reply />
          <span>
            <strong>
              Ответ для {replyTarget.display_name || replyTarget.username || 'пользователя'}
            </strong>
            <small>{replyTarget.body || mediaKindLabel(replyTarget.kind)}</small>
          </span>
          <button type="button" aria-label="Отменить ответ" onClick={onCancelReply}>
            <X />
          </button>
        </div>
      ) : null}
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
      <button
        type="button"
        className={`composer-gif-button${showGifPicker ? ' active' : ''}`}
        title="Найти GIF"
        aria-label="Открыть поиск GIF"
        aria-expanded={showGifPicker}
        disabled={disabled || sending || processingImage}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => setShowGifPicker((visible) => !visible)}
      >
        GIF
      </button>
      <textarea
        ref={textareaRef}
        value={value}
        rows={1}
        maxLength={imageDataUrl ? 1000 : 4000}
        disabled={disabled}
        spellCheck={spellCheckEnabled}
        lang={composerLanguage === 'auto' ? undefined : composerLanguage}
        placeholder="Написать сообщение…"
        aria-label="Сообщение"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => {
          event.preventDefault();
          setComposerMenu({
            x: Math.max(10, Math.min(event.clientX, window.innerWidth - 258)),
            y: Math.max(10, Math.min(event.clientY, window.innerHeight - 286)),
          });
        }}
        onPaste={(event) => {
          const image = Array.from(event.clipboardData.items)
            .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
            ?.getAsFile();
          if (!image) return;
          event.preventDefault();
          prepareSelectedImage(image);
        }}
      />
      {showSendButton ? (
        <button
          className="send-message-button"
          title="Отправить"
          aria-label="Отправить сообщение"
          disabled={disabled || sending || processingImage || (!value.trim() && !imageDataUrl)}
          onClick={() => void send()}
        >
          <Send />
        </button>
      ) : null}
      {showGifPicker ? (
        <GifPicker
          busy={sending || disabled}
          onClose={() => setShowGifPicker(false)}
          onSelect={(gif) => {
            if (sending || disabled) return;
            setSending(true);
            void (replyTarget ? onSendGif(gif, replyTarget.id) : onSendGif(gif))
              .then((sent) => {
                if (sent) {
                  setShowGifPicker(false);
                  onCancelReply();
                }
              })
              .finally(() => setSending(false));
          }}
        />
      ) : null}
      {composerMenu
        ? createPortal(
            <ComposerContextMenu
              menuRef={composerMenuRef}
              x={composerMenu.x}
              y={composerMenu.y}
              section={composerMenu.section}
              spellCheckEnabled={spellCheckEnabled}
              showSendButton={showSendButton}
              language={composerLanguage}
              onSection={(section) =>
                setComposerMenu((current) =>
                  current
                    ? { ...current, section: current.section === section ? undefined : section }
                    : current,
                )
              }
              onToggleSpellCheck={() => setSpellCheckEnabled((enabled) => !enabled)}
              onToggleSendButton={() => setShowSendButton((visible) => !visible)}
              onLanguage={(language) => {
                setComposerLanguage(language);
                setComposerMenu(undefined);
              }}
              onPaste={() => void pasteClipboardText()}
            />,
            document.body,
          )
        : null}
    </div>
  );
}

function ComposerContextMenu({
  menuRef,
  x,
  y,
  section,
  spellCheckEnabled,
  showSendButton,
  language,
  onSection,
  onToggleSpellCheck,
  onToggleSendButton,
  onLanguage,
  onPaste,
}: {
  menuRef: { current: HTMLDivElement | null };
  x: number;
  y: number;
  section?: 'suggestions' | 'languages';
  spellCheckEnabled: boolean;
  showSendButton: boolean;
  language: 'ru' | 'en' | 'auto';
  onSection(section: 'suggestions' | 'languages'): void;
  onToggleSpellCheck(): void;
  onToggleSendButton(): void;
  onLanguage(language: 'ru' | 'en' | 'auto'): void;
  onPaste(): void;
}) {
  return (
    <div
      ref={menuRef}
      className="composer-context-menu"
      style={{ left: x, top: y }}
      role="menu"
      aria-label="Действия с полем сообщения"
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type="button" role="menuitem" onClick={() => onSection('suggestions')}>
        <span>Предложения</span>
        <ChevronRight />
      </button>
      {section === 'suggestions' ? (
        <p className="composer-context-note">Подсказки появятся для слов с ошибками</p>
      ) : null}
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={showSendButton}
        onClick={onToggleSendButton}
      >
        <span>Кнопка отправки сообщений</span>
        <i>{showSendButton ? <Check /> : null}</i>
      </button>
      <hr />
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={spellCheckEnabled}
        onClick={onToggleSpellCheck}
      >
        <span>Проверка правописания</span>
        <i>{spellCheckEnabled ? <Check /> : null}</i>
      </button>
      <button type="button" role="menuitem" onClick={() => onSection('languages')}>
        <span>Языки</span>
        <ChevronRight />
      </button>
      {section === 'languages' ? (
        <div className="composer-language-options" role="group" aria-label="Язык проверки">
          {(
            [
              ['ru', 'Русский'],
              ['en', 'English'],
              ['auto', 'Автоматически'],
            ] as const
          ).map(([value, label]) => (
            <button type="button" onClick={() => onLanguage(value)} key={value}>
              <span>{label}</span>
              {language === value ? <Check /> : null}
            </button>
          ))}
        </div>
      ) : null}
      <hr />
      <button type="button" role="menuitem" onClick={onPaste}>
        <span>Вставить</span>
        <kbd>Ctrl+V</kbd>
      </button>
    </div>
  );
}

interface CommonsGifPage {
  pageid: number;
  title: string;
  imageinfo?: Array<{
    url: string;
    thumburl?: string;
    mime?: string;
    width?: number;
    height?: number;
    extmetadata?: Record<string, { value?: string }>;
  }>;
}

function GifPicker({
  busy,
  onClose,
  onSelect,
}: {
  busy: boolean;
  onClose(): void;
  onSelect(gif: GifMessageData): void;
}) {
  const [query, setQuery] = useState('animated sticker');
  const [results, setResults] = useState<GifMessageData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOnPointer = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest?.('.composer-gif-button')) return;
      if (!pickerRef.current?.contains(event.target as Node)) onClose();
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', closeOnPointer, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    const search = query.trim() || 'animated sticker';
    const timer = window.setTimeout(() => {
      const parameters = new URLSearchParams({
        action: 'query',
        generator: 'search',
        gsrsearch: `filemime:image/gif ${search}`,
        gsrnamespace: '6',
        gsrlimit: '24',
        prop: 'imageinfo',
        iiprop: 'url|mime|size|extmetadata',
        iiurlwidth: '360',
        format: 'json',
        origin: '*',
      });
      setLoading(true);
      setError('');
      void fetch(`https://commons.wikimedia.org/w/api.php?${parameters}`, {
        signal: controller.signal,
        credentials: 'omit',
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(`GIF search failed (${response.status})`);
          return (await response.json()) as { query?: { pages?: Record<string, CommonsGifPage> } };
        })
        .then((payload) => {
          const pages = Object.values(payload.query?.pages ?? {});
          setResults(
            pages.flatMap((page) => {
              const image = page.imageinfo?.[0];
              if (!image?.url || image.mime !== 'image/gif') return [];
              const title = page.title
                .replace(/^File:/i, '')
                .replace(/\.gif$/i, '')
                .trim()
                .slice(0, 200);
              const width = validGifDimension(image.width);
              const height = validGifDimension(image.height);
              return [
                {
                  url: image.url,
                  previewUrl: image.thumburl ?? image.url,
                  width,
                  height,
                  alt: title || 'GIF',
                  attribution: {
                    provider: 'Wikimedia Commons',
                    title: title || 'GIF',
                    pageUrl: `https://commons.wikimedia.org/?curid=${page.pageid}`,
                    author: plainMetadataText(image.extmetadata?.Artist?.value, 200),
                    license: plainMetadataText(image.extmetadata?.LicenseShortName?.value, 100),
                  },
                },
              ];
            }),
          );
        })
        .catch((caught) => {
          if ((caught as Error).name !== 'AbortError') {
            setResults([]);
            setError('Не удалось загрузить GIF. Проверьте соединение.');
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 320);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return createPortal(
    <div
      ref={pickerRef}
      className="gif-picker"
      role="dialog"
      aria-modal="true"
      aria-label="Поиск GIF"
    >
      <header>
        <div>
          <strong>GIF</strong>
          <small>Wikimedia Commons</small>
        </div>
        <button type="button" aria-label="Закрыть GIF" onClick={onClose}>
          <X />
        </button>
      </header>
      <label className="gif-search-field">
        <Search />
        <input
          value={query}
          autoFocus
          placeholder="Поиск GIF"
          aria-label="Поиск GIF"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="gif-results" aria-live="polite">
        {loading ? (
          Array.from({ length: 8 }, (_, index) => <i key={index} />)
        ) : error ? (
          <p>{error}</p>
        ) : results.length ? (
          results.map((gif) => (
            <button
              type="button"
              disabled={busy}
              title={gif.alt}
              aria-label={`Отправить GIF: ${gif.alt}`}
              onClick={() => onSelect(gif)}
              key={gif.attribution.pageUrl}
            >
              <img
                src={gif.previewUrl ?? gif.url}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
              />
              <span>{gif.alt}</span>
            </button>
          ))
        ) : (
          <p>По этому запросу GIF не найдены</p>
        )}
      </div>
      <footer>
        <span>GIF из открытой медиатеки</span>
        <b>Wikimedia Commons</b>
      </footer>
    </div>,
    document.body,
  );
}

function plainMetadataText(value?: string, limit = 200) {
  if (!value) return undefined;
  const container = document.createElement('span');
  container.innerHTML = value;
  return (container.textContent ?? '').trim().slice(0, limit) || undefined;
}

function validGifDimension(value?: number) {
  return Number.isInteger(value) && value! >= 1 && value! <= 4_096 ? value : undefined;
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
      className={`chat-avatar${group ? ' group' : ''}${compact ? ' compact' : ''}${showImage ? ' has-image' : ''}`}
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
  if (hours === null) return 'бессрочно';
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

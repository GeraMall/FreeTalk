import { appLanguage, formatChatCallLabel, t } from '../lib/app-language';
import { CHAT_MESSAGE_MAX_LENGTH, SERVICE_CHAT_ID } from '@freetalk/config';
import { ServiceBotAvatar, SERVICE_BOT_AVATAR_URL } from './ServiceBotAvatar';
import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  Archive,
  ArchiveRestore,
  Bookmark,
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
  Download,
  FileText,
  Forward,
  ImagePlus,
  Link2,
  BellOff,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  PinOff,
  Phone,
  PhoneCall,
  Video,
  Plus,
  RefreshCw,
  Reply,
  Search,
  Send,
  Save,
  Smile,
  Sticker,
  Trash2,
  UserPlus,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { isNearBottom } from '../lib/chat-scroll';
import { accountClient } from '../lib/api-client';
import {
  loadChatImage,
  loadChatImageDisplay,
  peekChatImageDisplay,
  rememberChatImageDimensions,
} from '../lib/chat-image-cache';
import { parseRoomDeepLink } from '../lib/deep-link';
import { prepareChatImageUpload, prepareGroupAvatar } from '../lib/profile';
import { collectAccountMediaUrls, warmAccountMediaCache } from '../lib/account-media-cache';
import { chatReactionEmojiSchema, type PresenceStatus } from '@freetalk/protocol';
import { useCachedMediaUrl } from '../lib/use-cached-media';
import { avatarImageStyle } from '../lib/avatar-image-style';
import { collapseDuplicateCallMessages, extractMessageLinks } from '../lib/chat-call-messages';
import {
  EMPTY_CONVERSATION_CALL_TIMEOUT_MS,
  isAbandonedConversationCall,
} from '../lib/conversation-call-lifecycle';
import { CreateGroupDialog } from './CreateGroupDialog';
import { GroupInviteFriendsDialog } from './GroupInviteFriendsDialog';
import { MessageLinkPreviewCard } from './MessageLinkPreview';
import { supportsRichLinkPreview } from '../lib/message-link-preview';
import { CachedMediaImage } from './CachedMedia';
import { ChatActionConfirmDialog } from './ChatActionConfirmDialog';
import { PresenceBadge } from './PresenceBadge';
import { GifPicker, GifImage } from './GifPicker';
import { gifKey, useGifLibrary, toggleGifFavorite } from '../lib/gif-library';
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
const MAX_CHAT_FILE_BYTES = 30 * 1024 * 1024;
const CHAT_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function storedChatIds(userId: string, kind: 'archived' | 'muted') {
  if (typeof window === 'undefined') return new Set<string>();
  try {
    const value = JSON.parse(window.localStorage.getItem(`trlka:${kind}-chats:${userId}`) ?? '[]');
    return new Set<string>(
      Array.isArray(value) ? value.filter((id) => typeof id === 'string') : [],
    );
  } catch {
    return new Set<string>();
  }
}

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

import { ChatCallWaiting } from './ChatCallWaiting';

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
  isSaved?: boolean;
  archived?: boolean;
  muted?: boolean;
  pinned?: boolean;
  title: string | null;
  members: ChatMember[];
  lastMessage?: string | null;
  lastMessageAt?: string | null;
  lastMessageKind?: string | null;
  retentionHours?: 24 | 168 | 720 | null;
  currentUserRole?: 'owner' | 'admin' | 'member';
  unreadCount?: number;
  hasActiveGroupCall?: boolean;
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
    filename?: string;
    mime?: string;
    size?: number;
    ended?: boolean;
    missed?: boolean;
    invitationId?: string;
    startedAt?: string;
    endedAt?: string | null;
    aloneSince?: string | null;
    established?: boolean;
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
  assetId?: string;
  favoriteId?: string;
  providerId?: string;
  url: string;
  previewUrl?: string;
  width?: number;
  height?: number;
  alt: string;
  attribution: {
    provider: 'Wikimedia Commons' | 'KLIPY' | 'TRLKA';
    title: string;
    pageUrl: string;
    author?: string;
    license?: string;
  };
}

interface FriendOption {
  id: string;
  username: string;
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
  onOpenSavedChat?(): Promise<void>;
  onArchiveChat?(chatId: string, archived: boolean): Promise<void>;
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
  onSendFile?(file: globalThis.File, caption: string, replyToMessageId?: string): Promise<boolean>;
  onSendGif?(gif: GifMessageData | File, replyToMessageId?: string): Promise<boolean>;
  onReactMessage?(messageId: string, emoji: string, remove?: boolean): Promise<boolean>;
  onPinMessage?(messageId: string, pinned: boolean): Promise<boolean>;
  onEditMessage?(messageId: string, body: string): Promise<boolean>;
  onDeleteMessage?(messageId: string): Promise<boolean>;
  onForwardMessage?(messageId: string, targetChatId: string): Promise<boolean>;
  onRevealMessage?(messageId: string): Promise<boolean>;
  onCreateGroup(title: string, memberIds: string[]): Promise<boolean>;
  onJoinInvite(token: string): Promise<boolean>;
  onStartCall(camera?: boolean): Promise<void>;
  onCreateInvite(): Promise<void>;
  onUpdateRetention(retentionHours: 24 | 168 | 720 | null): Promise<void>;
  onClearHistory(chatId?: string): Promise<void>;
  onBlockUser?(userId: string): Promise<void>;
  onDeleteDirectChat?(): Promise<void>;
  onDeleteChat?(chatId: string): Promise<void>;
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
  onJoinCall(roomId: string, source?: 'room-invite'): void;
  joinedChatId?: string;
  callToolbarTarget?: HTMLElement | null;
  onRevealCallChat?(): void;
  joinedRoomId?: string;
}

export function ChatsPage({
  joinedChatId,
  callToolbarTarget,
  onRevealCallChat,
  joinedRoomId,
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
  onOpenSavedChat,
  onArchiveChat,
  onCloseChat = () => {},
  onRetryMessages,
  onLoadOlder = async () => {},
  onSendMessage,
  onSendImage = async () => false,
  onSendFile = async () => false,
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
  onDeleteChat = async () => {},
  onLeaveGroup = async () => {},
  onUpdateGroupAvatar = async () => false,
  onAddMember,
  onJoinCall,
}: ChatsPageProps) {
  const [search, setSearch] = useState('');
  const [showGroup, setShowGroup] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showMember, setShowMember] = useState(false);
  const [showPinned, setShowPinned] = useState(true);
  const [inviteToken, setInviteToken] = useState('');
  const [actionBusy, setActionBusy] = useState('');
  const actionBusyRef = useRef(false);
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
  const [profileVisible, setProfileVisible] = useState(
    () => !mobile && !window.matchMedia?.('(max-width: 1100px)').matches,
  );

  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 1100px)');
    const collapse = () => {
      if (media?.matches) setProfileVisible(false);
    };
    media?.addEventListener?.('change', collapse);
    return () => media?.removeEventListener?.('change', collapse);
  }, []);
  const [profile, setProfile] = useState<ChatProfile>();
  const [profileLoading, setProfileLoading] = useState(false);
  const [fullProfileOpen, setFullProfileOpen] = useState(false);
  const [groupProfileTarget, setGroupProfileTarget] = useState<ChatMember>();
  const [showArchived, setShowArchived] = useState(false);
  const [deleteSheetChat, setDeleteSheetChat] = useState<ChatItem>();
  const [deleteSheetBusy, setDeleteSheetBusy] = useState<'delete' | 'block' | 'clear'>();
  const [deleteSheetError, setDeleteSheetError] = useState('');
  const [archivedChatIds, setArchivedChatIds] = useState(() => storedChatIds(userId, 'archived'));
  const [mutedChatIds, setMutedChatIds] = useState(() => storedChatIds(userId, 'muted'));
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
  const activeCallToolbar = activeChat && activeChat.id === joinedChatId ? callToolbarTarget : null;
  const [callProfileChatId, setCallProfileChatId] = useState<string>();
  const showProfile =
    !activeChat?.isSaved &&
    (activeCallToolbar ? callProfileChatId === activeChatId : profileVisible);
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
    setShowMember(false);
    setShowPinned(true);
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
    return chats
      .filter(
        (chat) =>
          !chat.isSaved &&
          (chat.id === SERVICE_CHAT_ID
            ? !showArchived
            : (chat.archived ?? archivedChatIds.has(chat.id)) === showArchived) &&
          (!query || chatName(chat, userId).toLocaleLowerCase('ru-RU').includes(query)),
      )
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
  }, [archivedChatIds, chats, search, showArchived, userId]);
  const archivedCount = chats.filter(
    (chat) => !chat.isSaved && (chat.archived ?? archivedChatIds.has(chat.id)),
  ).length;

  const updateStoredChatIds = (
    kind: 'archived' | 'muted',
    current: Set<string>,
    chatId: string,
  ) => {
    const next = new Set(current);
    if (next.has(chatId)) next.delete(chatId);
    else next.add(chatId);
    window.localStorage.setItem(`trlka:${kind}-chats:${userId}`, JSON.stringify([...next]));
    if (kind === 'muted' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.controller?.postMessage({
        type: 'trlka-muted-chats',
        chatIds: [...next],
      });
    }
    return next;
  };

  const runAction = async (key: string, action: () => Promise<boolean | void>) => {
    if (actionBusyRef.current) return false;
    actionBusyRef.current = true;
    setActionBusy(key);
    try {
      return (await action()) !== false;
    } finally {
      actionBusyRef.current = false;
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

  const addMembers = async (usernames: string[]) => {
    for (const username of usernames) {
      if (!(await onAddMember(username))) return false;
    }
    return true;
  };

  return (
    <div
      className={`messenger-layout page-enter ${showProfile ? '' : 'profile-hidden'}${activeCallToolbar && showProfile ? ' call-chat-profile-visible' : ''}${externalSidebar ? ' external-sidebar' : ''}${mobile ? ' mobile-messenger' : ''}${mobile && activeChat ? ' has-active-chat' : ''}${activeChat ? ` chat-${activeChat.type}` : ''}`}
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
          aria-label={t('Список чатов')}
        >
          <header className="conversation-sidebar-header">
            <div>
              <p className="messenger-eyebrow">{t('СООБЩЕНИЯ')}</p>
              <h1>{t('Чаты')}</h1>
              <p>{t('Срок хранения задаётся для каждого чата')}</p>
            </div>
            <div className="conversation-collection-actions">
              <button
                type="button"
                className="new-chat-button"
                aria-label={t('Архив')}
                data-tooltip={t('Архив')}
                aria-pressed={showArchived}
                onClick={() => setShowArchived((visible) => !visible)}
              >
                <Archive />
              </button>
              <button
                type="button"
                className="new-chat-button"
                aria-label={t('Избранное')}
                data-tooltip={t('Избранное')}
                aria-pressed={Boolean(activeChat?.isSaved)}
                onClick={() => {
                  setShowArchived(false);
                  void onOpenSavedChat?.();
                }}
              >
                <Bookmark />
              </button>
              <button
                className="new-chat-button"
                data-tooltip={t('Новый групповой чат')}
                aria-label={t('Новый групповой чат')}
                aria-expanded={showGroup}
                onClick={() => setShowGroup(true)}
              >
                <Plus />
              </button>
            </div>
          </header>

          <div className="conversation-top-actions">
            <label className="conversation-search">
              <Search aria-hidden="true" />
              <span className="sr-only">{t('Поиск по чатам')}</span>
              <input
                value={search}
                placeholder={t('Поиск по чатам')}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search && (
                <button aria-label={t('Очистить поиск')} onClick={() => setSearch('')}>
                  <X />
                </button>
              )}
            </label>

            <button
              className="join-chat-button"
              data-tooltip={t('Войти по приглашению')}
              aria-label={t('Войти по приглашению')}
              aria-expanded={showInvite}
              onClick={() => setShowInvite((visible) => !visible)}
            >
              <Link2 />
              <span>{t('Войти по приглашению')}</span>
            </button>
          </div>

          {showInvite && (
            <div className="compact-chat-form chat-popover-card">
              <div>
                <strong>{t('Приглашение в чат')}</strong>
                <button aria-label={t('Закрыть')} onClick={() => setShowInvite(false)}>
                  <X />
                </button>
              </div>
              <input
                value={inviteToken}
                placeholder={t('Вставьте ссылку или токен')}
                onChange={(event) => setInviteToken(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void joinInvite()}
              />
              <button
                disabled={!inviteToken.trim() || actionBusy === 'invite'}
                onClick={() => void joinInvite()}
              >
                {t('Войти')}
              </button>
            </div>
          )}

          {archivedCount > 0 && (
            <button
              type="button"
              className={`archived-chats-toggle${showArchived ? ' active' : ''}`}
              onClick={() => setShowArchived((visible) => !visible)}
            >
              <Archive />
              <span>{showArchived ? t('Вернуться к чатам') : t('Архив')}</span>
              <b>{archivedCount}</b>
              <ChevronRight />
            </button>
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
                  mobile={mobile}
                  archived={chat.archived ?? archivedChatIds.has(chat.id)}
                  muted={mutedChatIds.has(chat.id)}
                  onClick={() => void onOpenChat(chat.id)}
                  onArchive={() =>
                    onArchiveChat
                      ? void onArchiveChat(chat.id, !chat.archived)
                      : setArchivedChatIds((current) =>
                          updateStoredChatIds('archived', current, chat.id),
                        )
                  }
                  onMute={() =>
                    setMutedChatIds((current) => updateStoredChatIds('muted', current, chat.id))
                  }
                  onDelete={() => {
                    setDeleteSheetError('');
                    setDeleteSheetChat(chat);
                  }}
                />
              ))
            ) : chats.length > 0 ? (
              <div className="conversation-list-empty">
                <Search />
                <strong>{t('Чаты не найдены')}</strong>
                <small>{t('Попробуйте другой запрос')}</small>
              </div>
            ) : (
              <div className="conversation-list-empty">
                <MessageCircle />
                <strong>{t('Чатов пока нет')}</strong>
                <small>{t('Начните личный чат из раздела «Друзья»')}</small>
                <button onClick={() => setShowGroup(true)}>{t('Новый групповой чат')}</button>
              </div>
            )}
          </div>
        </aside>
      ) : null}

      {!externalSidebar ? (
        <div
          className="conversation-sidebar-resizer"
          role="separator"
          aria-label={t('Изменить ширину списка чатов')}
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
          actionBusy={actionBusy}
          profileVisible={showProfile}
          callToolbarTarget={activeCallToolbar}
          onRevealCallChat={onRevealCallChat}
          showMenu={showChatMenu}
          showAvatarEditor={showGroupAvatarEditor}
          messageSearch={messageSearch}
          messageSearchCount={messageSearchMatches.length}
          messageSearchIndex={activeMessageSearchIndex}
          onOpenProfile={() => setFullProfileOpen(true)}
          onToggleMember={() => setShowMember((visible) => !visible)}
          onStartCall={(camera) => void runAction('call', () => onStartCall(camera))}
          hasPinned={Boolean(pinnedMessage || messages.some((message) => message.pinned_at))}
          showPinned={showPinned}
          onTogglePinned={() => setShowPinned((visible) => !visible)}
          onCreateInvite={() => void runAction('create-invite', onCreateInvite)}
          onToggleProfile={() => {
            if (activeCallToolbar) {
              setCallProfileChatId((id) => (id === activeChat.id ? undefined : activeChat.id));
            } else {
              setProfileVisible((visible) => !visible);
            }
          }}
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

      <section className="active-conversation" aria-label={t('Активный чат')}>
        {activeChat && (
          <ChatCallWaiting
            chatId={activeChat.id}
            currentUserId={userId}
            joinedChatId={joinedChatId}
            joinedRoomId={joinedRoomId}
            revision={messages}
            onJoin={onJoinCall}
          />
        )}
        {activeChat ? (
          <>
            {showChatMenu && (
              <div ref={chatMenuRef} className="chat-actions-popover" role="menu">
                <button onClick={() => setShowChatSettings((visible) => !visible)}>
                  <Clock3 /> {t('Настройки чата')}
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
                      <Ban /> {t('Заблокировать')}
                    </button>
                    <button
                      className="destructive"
                      onClick={() => {
                        setConfirmActionError('');
                        setConfirmAction('delete-direct');
                      }}
                    >
                      <Trash2 /> {t('Удалить чат у обоих')}
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
                    <Trash2 />
                    {confirmClear ? t('Подтвердить очистку') : t('Очистить чат')}
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
                    <X /> {t('Покинуть группу')}
                  </button>
                ) : null}
                {showChatSettings && (
                  <div className="chat-menu-settings">
                    <span>
                      {t('История:')} {retentionLabel(retentionHours)}
                    </span>
                    {activeChat.type === 'group' && activeChat.currentUserRole === 'owner' ? (
                      <select
                        aria-label={t('Срок хранения сообщений')}
                        value={retentionHours === null ? 'forever' : String(retentionHours)}
                        onChange={(event) => {
                          const value = event.target.value;
                          const next = value === 'forever' ? null : Number(value);
                          if (next === null || next === 24 || next === 168 || next === 720)
                            void runAction('retention', () => onUpdateRetention(next));
                        }}
                      >
                        <option value="24">{t('24 часа')}</option>
                        <option value="168">{t('7 дней')}</option>
                        <option value="720">{t('30 дней')}</option>
                        <option value="forever">{t('Без ограничения')}</option>
                      </select>
                    ) : null}
                  </div>
                )}
              </div>
            )}
            <MessageList
              chatId={activeChat.id}
              joinedRoomId={joinedRoomId}
              userId={userId}
              groupChat={activeChat.type === 'group'}
              savedChat={activeChat.isSaved}
              messages={messages}
              pinnedMessage={pinnedMessage}
              showPinned={showPinned}
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
              onSendFile={onSendFile}
              onSendGif={onSendGif}
              replyTarget={replyTarget}
              onCancelReply={() => setReplyTarget(undefined)}
            />
          </>
        ) : (
          <ChatEmptyState />
        )}
      </section>
      {activeChat && showProfile && (
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
              ? t('Покинуть «{p0}»?', { p0: chatName(activeChat, userId) })
              : confirmAction === 'delete-direct'
                ? t('Удалить личный чат у обоих?')
                : t('Заблокировать {p0}?', { p0: profileTarget?.displayName ?? 'пользователя' })
          }
          description={
            confirmAction === 'leave-group'
              ? t(
                  'Группа исчезнет из списка. Вернуться можно будет только по новому приглашению участника.',
                )
              : confirmAction === 'delete-direct'
                ? t('Вся переписка будет безвозвратно удалена у вас и у собеседника.')
                : t(
                    'Пользователь не сможет писать вам. Он будет удалён из друзей, а личный чат исчезнет из списка.',
                  )
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
      {mobile && deleteSheetChat ? (
        <MobileChatDeleteSheet
          chat={deleteSheetChat}
          userId={userId}
          busy={deleteSheetBusy}
          error={deleteSheetError}
          onCancel={() => {
            if (deleteSheetBusy) return;
            setDeleteSheetChat(undefined);
            setDeleteSheetError('');
          }}
          onDelete={(block) => {
            if (deleteSheetBusy) return;
            const chat = deleteSheetChat;
            const other = chat.members.find((member) => member.id !== userId);
            setDeleteSheetBusy(block ? 'block' : 'delete');
            setDeleteSheetError('');
            void onDeleteChat(chat.id)
              .then(() => (block && other ? onBlockUser(other.id) : undefined))
              .then(() => setDeleteSheetChat(undefined))
              .catch((caught) =>
                setDeleteSheetError(
                  caught instanceof Error ? caught.message : 'Не удалось удалить чат',
                ),
              )
              .finally(() => setDeleteSheetBusy(undefined));
          }}
          onClear={() => {
            if (deleteSheetBusy) return;
            const chat = deleteSheetChat;
            setDeleteSheetBusy('clear');
            setDeleteSheetError('');
            void onClearHistory(chat.id)
              .then(() => setDeleteSheetChat(undefined))
              .catch((caught) =>
                setDeleteSheetError(
                  caught instanceof Error ? caught.message : 'Не удалось очистить историю',
                ),
              )
              .finally(() => setDeleteSheetBusy(undefined));
          }}
        />
      ) : null}
      <CreateGroupDialog
        open={showGroup}
        friends={friends}
        onClose={() => setShowGroup(false)}
        onCreate={onCreateGroup}
      />
      <GroupInviteFriendsDialog
        open={showMember && Boolean(activeChat)}
        createGroup={activeChat?.type === 'direct'}
        groupTitle={activeChat ? chatName(activeChat, userId) : ''}
        friends={friends}
        memberIds={activeChat?.members.map((member) => member.id) ?? []}
        onClose={() => setShowMember(false)}
        onInvite={(usernames) => {
          if (!activeChat || activeChat.type === 'group') return addMembers(usernames);
          const invited = friends.filter((friend) => usernames.includes(friend.username));
          if (!invited.length) return Promise.resolve(false);
          const members = activeChat.members.filter((member) => member.id !== userId);
          const title = [...members, ...invited]
            .map((member) => member.displayName)
            .join(', ')
            .slice(0, 80);
          return onCreateGroup(title, [
            ...new Set([...members, ...invited].map((member) => member.id)),
          ]);
        }}
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
        <button type="button" aria-label={t('Закрыть предупреждение')} onClick={onClose}>
          <X />
        </button>
        <h2 id="chat-slow-mode-title">{t('ВОУ, ВОУ, ПОЛЕГЧЕ!')}</h2>
        <p id="chat-slow-mode-description">{t('Вы отправляете сообщения слишком быстро!')}</p>
        <button type="button" className="chat-slow-mode-rest" onClick={onClose}>
          {t('Вход в зону отдыха')}
          <span>
            {remainingSeconds} {t('с')}
          </span>
        </button>
      </section>
    </div>,
    document.body,
  );
}

function MobileChatDeleteSheet({
  chat,
  userId,
  busy,
  error,
  onCancel,
  onDelete,
  onClear,
}: {
  chat: ChatItem;
  userId: string;
  busy?: 'delete' | 'block' | 'clear';
  error: string;
  onCancel(): void;
  onDelete(block: boolean): void;
  onClear(): void;
}) {
  const name = chatName(chat, userId);
  const other = chat.members.find((member) => member.id !== userId);
  const canClear = chat.type === 'group' && chat.currentUserRole === 'owner';

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [busy, onCancel]);

  return createPortal(
    <div
      className="mobile-chat-delete-backdrop"
      onPointerDown={(event) => event.target === event.currentTarget && !busy && onCancel()}
    >
      <div className="mobile-chat-delete-sheet" role="alertdialog" aria-modal="true">
        <section>
          <header>
            <ChatAvatar
              name={name}
              group={chat.type === 'group'}
              avatarUrl={chat.type === 'group' ? chat.avatarUrl : other?.avatarUrl}
              positionX={chat.avatarPositionX}
              positionY={chat.avatarPositionY}
              scale={chat.avatarScale}
            />
            <p>
              {chat.type === 'direct' ? (
                <>
                  {t('Удалить чат с')} <strong>{name}</strong>?
                </>
              ) : (
                <>
                  {t('Удалить «')}
                  <strong>{name}</strong>»?
                </>
              )}
            </p>
          </header>
          {error ? <small>{error}</small> : null}
          {chat.type === 'direct' ? (
            <button className="danger" disabled={Boolean(busy)} onClick={() => onDelete(true)}>
              {busy === 'block' ? t('Удаляем…') : t('Удалить и заблокировать')}
            </button>
          ) : null}
          <button
            className={chat.type === 'direct' ? 'primary' : 'danger'}
            disabled={Boolean(busy)}
            onClick={() => onDelete(false)}
          >
            {busy === 'delete'
              ? t('Удаляем…')
              : chat.type === 'group'
                ? t('Покинуть и удалить чат')
                : t('Удалить чат')}
          </button>
          {canClear ? (
            <button className="primary" disabled={Boolean(busy)} onClick={onClear}>
              {busy === 'clear' ? t('Очищаем…') : t('Очистить историю')}
            </button>
          ) : null}
        </section>
        <button className="cancel" disabled={Boolean(busy)} onClick={onCancel}>
          {t('Отмена')}
        </button>
      </div>
    </div>,
    document.body,
  );
}

function ChatListItem({
  chat,
  userId,
  active,
  mobile,
  archived,
  muted,
  onClick,
  onArchive,
  onMute,
  onDelete,
}: {
  chat: ChatItem;
  userId: string;
  active: boolean;
  mobile: boolean;
  archived: boolean;
  muted: boolean;
  onClick(): void;
  onArchive(): void;
  onMute(): void;
  onDelete(): void;
}) {
  const actionsWidth = 210;
  const revealThreshold = actionsWidth * 0.45;
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const offsetRef = useRef(0);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startOffset: number;
    horizontal: boolean;
  }>(undefined);
  const suppressClickRef = useRef(false);
  const name = chatName(chat, userId);
  const other = chat.members.find((member) => member.id !== userId);
  const preview =
    chat.lastMessageKind === 'image'
      ? chat.lastMessage || t('Фотография')
      : chat.lastMessageKind === 'file'
        ? chat.lastMessage || t('Файл')
        : chat.lastMessage
          ? chat.lastMessageKind === 'call'
            ? t('Начат голосовой звонок')
            : chat.lastMessage
          : chat.type === 'group'
            ? t('{p0} участников', { p0: chat.members.length })
            : t('Откройте беседу');
  const moveTo = (value: number) => {
    offsetRef.current = value;
    setOffset(value);
  };
  const finishSwipe = () => {
    const drag = dragRef.current;
    dragRef.current = undefined;
    setDragging(false);
    if (!drag?.horizontal) return;
    suppressClickRef.current = true;
    if (drag.startOffset < 0) {
      moveTo(offsetRef.current > drag.startOffset ? 0 : -actionsWidth);
      return;
    }
    moveTo(offsetRef.current <= -revealThreshold ? -actionsWidth : 0);
  };
  const startedOpen = dragging && (dragRef.current?.startOffset ?? 0) < 0;
  const closingToRight = startedOpen && offset > (dragRef.current?.startOffset ?? 0);
  const swipeProgress = closingToRight ? 0 : Math.max(0, Math.min(1, -offset / actionsWidth));
  const actionsRevealed = offset === -actionsWidth && !closingToRight;
  return (
    <div
      className={`swipe-chat-row${actionsRevealed ? ' actions-visible' : ''}${dragging ? ' is-dragging' : ''}`}
      onPointerDown={(event) => {
        if (!mobile || event.pointerType === 'mouse' || chat.id === SERVICE_CHAT_ID) return;
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          startOffset: offsetRef.current,
          horizontal: false,
        };
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const deltaX = event.clientX - drag.startX;
        const deltaY = event.clientY - drag.startY;
        if (!drag.horizontal) {
          if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 7) return;
          if (Math.abs(deltaY) >= Math.abs(deltaX)) {
            dragRef.current = undefined;
            return;
          }
          drag.horizontal = true;
          setDragging(true);
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }
        event.preventDefault();
        moveTo(Math.max(-actionsWidth, Math.min(0, drag.startOffset + deltaX)));
      }}
      onPointerUp={finishSwipe}
      onPointerCancel={finishSwipe}
    >
      {mobile && chat.id !== SERVICE_CHAT_ID && (
        <div
          className="conversation-swipe-actions"
          aria-hidden={!actionsRevealed}
          style={{
            opacity: swipeProgress,
            visibility: swipeProgress > 0 ? 'visible' : 'hidden',
            transform: `translate3d(${Math.round((1 - swipeProgress) * 18)}px, 0, 0)`,
          }}
        >
          <button
            type="button"
            className="mute"
            onClick={() => {
              onMute();
              moveTo(0);
            }}
          >
            <BellOff />
            <span>{muted ? t('Со звуком') : t('Без звука')}</span>
          </button>
          <button
            type="button"
            className="delete"
            onClick={() => {
              moveTo(0);
              onDelete();
            }}
          >
            <Trash2 />
            <span>{t('Удалить')}</span>
          </button>
          <button
            type="button"
            className="archive"
            onClick={() => {
              moveTo(0);
              onArchive();
            }}
          >
            {archived ? <ArchiveRestore /> : <Archive />}
            <span>{archived ? t('Вернуть') : t('Архив')}</span>
          </button>
        </div>
      )}
      <button
        className={`conversation-card ${active ? 'active' : ''}`}
        style={{ transform: `translate3d(${offset}px, 0, 0)` }}
        aria-label={`${name}. ${preview}`}
        aria-current={active ? 'true' : undefined}
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          if (offsetRef.current < 0) {
            moveTo(0);
            return;
          }
          onClick();
        }}
      >
        <ChatAvatar
          name={name}
          group={chat.type === 'group'}
          avatarUrl={chat.type === 'group' ? chat.avatarUrl : other?.avatarUrl}
          activeCall={chat.hasActiveGroupCall}
          presence={chat.type === 'direct' ? other?.presence : undefined}
          positionX={chat.avatarPositionX}
          positionY={chat.avatarPositionY}
          scale={chat.avatarScale}
        />
        <span className="conversation-card-copy">
          <strong>{name}</strong>
          <small>
            {chat.id === SERVICE_CHAT_ID
              ? t('Уведомления и помощь')
              : chat.type === 'direct' && other
                ? `${presenceLabel(other.presence)} · ${preview}`
                : preview}
          </small>
        </span>
        <span className="conversation-meta">
          {muted && (
            <BellOff className="conversation-muted-icon" aria-label={t('Уведомления отключены')} />
          )}
          {chat.lastMessageAt && <time>{formatConversationTime(chat.lastMessageAt)}</time>}
          {Boolean(chat.unreadCount) && !muted && <b>{Math.min(chat.unreadCount ?? 0, 99)}</b>}
        </span>
      </button>
    </div>
  );
}

function ChatHeader({
  chat,
  onBack,
  userId,
  showMember,
  actionBusy,
  profileVisible,
  callToolbarTarget,
  onRevealCallChat,
  showMenu,
  showAvatarEditor,
  messageSearch,
  messageSearchCount,
  messageSearchIndex,
  onOpenProfile,
  onToggleMember,
  onStartCall,
  hasPinned,
  showPinned,
  onTogglePinned,
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
  actionBusy: string;
  profileVisible: boolean;
  callToolbarTarget?: HTMLElement | null;
  onRevealCallChat?(): void;
  showMenu: boolean;
  showAvatarEditor: boolean;
  messageSearch: string;
  messageSearchCount: number;
  messageSearchIndex: number;
  onOpenProfile(): void;
  onToggleMember(): void;
  onStartCall(camera?: boolean): void;
  hasPinned: boolean;
  showPinned: boolean;
  onTogglePinned(): void;
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
  const pinnedAction = (
    <button
      className="chat-pinned-toggle"
      data-tooltip={hasPinned ? t('Закреплённые сообщения') : t('Нет закреплённых сообщений')}
      aria-label={t('Закреплённые сообщения')}
      aria-pressed={hasPinned && showPinned}
      disabled={!hasPinned}
      onClick={() => {
        if (callToolbarTarget) onRevealCallChat?.();
        onTogglePinned();
      }}
    >
      <Pin />
    </button>
  );
  const profileAction = (
    <button
      className="chat-profile-toggle"
      data-tooltip={profileVisible ? t('Скрыть профиль') : t('Показать профиль')}
      aria-label={profileVisible ? t('Скрыть профиль') : t('Показать профиль')}
      aria-pressed={profileVisible}
      disabled={Boolean(callToolbarTarget) && chat.type === 'direct'}
      onClick={() => {
        if (callToolbarTarget) onRevealCallChat?.();
        onToggleProfile();
      }}
    >
      {callToolbarTarget ? <Users /> : profileVisible ? <PanelRightClose /> : <PanelRightOpen />}
    </button>
  );
  const searchAction = (
    <label className="active-chat-search">
      <Search />
      <input
        value={messageSearch}
        onFocus={callToolbarTarget ? onRevealCallChat : undefined}
        aria-label={t('Искать в {p0}', { p0: name })}
        placeholder={t('Искать в «{p0}»', { p0: name })}
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
            data-tooltip={t('Очистить поиск')}
            aria-label={t('Очистить поиск по сообщениям')}
            onClick={() => onMessageSearch('')}
          >
            <X />
          </button>
        </>
      ) : null}
    </label>
  );
  return (
    <header className="active-chat-header">
      {onBack ? (
        <button
          type="button"
          className="mobile-chat-back"
          aria-label={t('Назад к чатам')}
          onClick={onBack}
        >
          <ArrowLeft />
        </button>
      ) : null}
      {chat.isSaved ? (
        <span className="chat-avatar saved-chat-avatar" aria-hidden="true">
          <Bookmark />
        </span>
      ) : chat.type === 'group' ? (
        <button
          className="group-avatar-trigger"
          data-tooltip={canEditAvatar ? t('Изменить аватар группы') : t('Аватар группы')}
          aria-label={canEditAvatar ? t('Изменить аватар группы') : t('Аватар группы')}
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
          aria-label={t('Открыть полный профиль {p0}', { p0: name })}
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
          {chat.isSaved
            ? t('Заметки, ссылки и файлы для себя')
            : chat.type === 'group'
              ? memberCountLabel(chat.members.length)
              : other
                ? `@${other.username}`
                : t('Личный чат')}
        </small>
      </div>
      <div className="active-chat-actions">
        {!chat.isSaved && (
          <>
            <button
              className="chat-voice-action"
              data-tooltip={t('Начать голосовой звонок')}
              aria-label={t('Начать голосовой звонок')}
              disabled={actionBusy === 'call'}
              onClick={() => onStartCall()}
            >
              <PhoneCall />
            </button>
            <button
              className="chat-video-action"
              data-tooltip={t('Начать видеозвонок')}
              aria-label={t('Начать видеозвонок')}
              disabled={actionBusy === 'call'}
              onClick={() => onStartCall(true)}
            >
              <Video />
            </button>
          </>
        )}
        {!callToolbarTarget && pinnedAction}
        {chat.type === 'group' && (
          <button
            data-tooltip={t('Скопировать приглашение')}
            aria-label={t('Скопировать приглашение')}
            disabled={actionBusy === 'create-invite'}
            onClick={onCreateInvite}
          >
            <Link2 />
          </button>
        )}
        {!chat.isSaved && (
          <button
            className="chat-invite-action"
            data-tooltip={t('Добавить участника')}
            aria-label={t('Добавить участника')}
            aria-expanded={showMember}
            onClick={onToggleMember}
          >
            <UserPlus />
          </button>
        )}
        <button
          data-chat-menu-trigger
          data-tooltip={t('Действия с чатом')}
          aria-label={t('Действия с чатом')}
          aria-expanded={showMenu}
          onClick={onToggleMenu}
        >
          <MoreHorizontal />
        </button>
        {!chat.isSaved && !callToolbarTarget && profileAction}
        {!callToolbarTarget && searchAction}
      </div>
      {callToolbarTarget &&
        createPortal(
          <>
            {pinnedAction}
            {profileAction}
            {searchAction}
          </>,
          callToolbarTarget,
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
        aria-label={t('Редактировать группу')}
        aria-modal="true"
      >
        <div className="group-avatar-editor-heading">
          <div>
            <strong>{t('Редактировать группу')}</strong>
            <small>{t('Настройте название и фотографию')}</small>
          </div>
          <button
            type="button"
            aria-label={t('Закрыть')}
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
              alt={t('Предпросмотр аватара группы')}
              draggable={false}
              style={avatarImageStyle(position.x, position.y, scale)}
            />
          ) : (
            <Users />
          )}
          <button
            className="group-avatar-pencil"
            type="button"
            aria-label={t('Выбрать изображение')}
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
          <span>{t('Название группы')}</span>
          <input
            value={title}
            maxLength={80}
            placeholder={t('Название группы')}
            aria-label={t('Название группы')}
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
            <span>{t('Размер')}</span>
            <input
              type="range"
              min="100"
              max="250"
              step="5"
              value={scale}
              aria-label={t('Размер аватара')}
              onChange={(event) => setScale(Number(event.target.value))}
            />
            <output>{scale}%</output>
          </label>
        )}
        <div className="group-avatar-editor-actions">
          <button type="button" className="secondary" disabled={busy} onClick={closeSmoothly}>
            {t('Отмена')}
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
            <Save />
            {busy ? t('Сохранение…') : t('Сохранить')}
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
      <aside className="chat-profile-panel group-members-panel" aria-label={t('Участники группы')}>
        <section className="group-members-heading">
          <p>{t('Участники — {count}', { count: members.length })}</p>
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
                  aria-label={t('Открыть профиль {p0}', { p0: member.displayName })}
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
                {member.role === 'owner' && <Crown aria-label={t('Владелец группы')} />}
              </div>
            ))}
        </div>
        <button className="group-members-invite" onClick={onInvite}>
          <UserPlus />
          {t('Пригласить в группу')}
        </button>
      </aside>
    );
  if (loading)
    return (
      <aside className="chat-profile-panel" aria-label={t('Профиль собеседника')} aria-busy="true">
        <div className="chat-profile-island">
          <div className="profile-panel-skeleton" />
        </div>
      </aside>
    );
  const name = profile?.displayName ?? fallback?.displayName ?? groupTitle ?? 'Профиль';
  const presence = profile?.presence ?? fallback?.presence ?? 'offline';
  return (
    <aside className="chat-profile-panel" aria-label={t('Профиль собеседника')}>
      <div className="chat-profile-island">
        <div
          className="chat-profile-cover"
          style={cachedCoverUrl ? { backgroundImage: `url(${cachedCoverUrl})` } : undefined}
        />
        <button
          type="button"
          className="chat-profile-avatar"
          aria-label={t('Открыть полный профиль {p0}. {p1}', {
            p0: name,
            p1: presenceLabel(presence),
          })}
          onClick={onFullProfile}
        >
          {cachedAvatarUrl ? <img src={cachedAvatarUrl} alt="" /> : name.slice(0, 1).toUpperCase()}
          <PresenceBadge status={presence} />
        </button>
        <section className="chat-profile-identity">
          <h2>{name}</h2>
          <p>@{profile?.username ?? fallback?.username ?? 'trlka'}</p>
        </section>
        <section className="chat-profile-block">
          <h3>{t('О СЕБЕ')}</h3>
          <p>{profile?.bio || 'Пользователь пока ничего о себе не рассказал.'}</p>
        </section>
        <section className="chat-profile-block mutual-friends-block">
          <h3>{t('ОБЩИЕ ДРУЗЬЯ')}</h3>
          <div className="mutual-friend-avatars">
            {(profile?.mutualFriends ?? []).map((friend) => (
              <span data-tooltip={friend.displayName} key={friend.id}>
                {friend.avatarUrl ? (
                  <CachedMediaImage src={friend.avatarUrl} alt="" />
                ) : (
                  friend.displayName[0]
                )}
              </span>
            ))}
          </div>
          <p>
            {profile?.mutualFriendsCount ?? 0} {t('общих друзей')}
          </p>
        </section>
        {profile?.registeredAt && <footer>{formatProfileMemberSince(profile.registeredAt)}</footer>}
        <button type="button" className="chat-profile-full-button" onClick={onFullProfile}>
          {t('Полный профиль')}
        </button>
      </div>
    </aside>
  );
}

function presenceLabel(status: PresenceStatus = 'offline') {
  if (status === 'online') return t('В сети');
  if (status === 'away') return t('Нет на месте');
  if (status === 'dnd') return t('Не беспокоить');
  return t('Не в сети');
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

function openChatLink(event: ReactMouseEvent<HTMLAnchorElement>) {
  if (event.defaultPrevented || !isTauri() || (event.type === 'auxclick' && event.button !== 1))
    return;
  event.preventDefault();
  void invoke('open_chat_link', { url: event.currentTarget.href }).catch(console.error);
}

function MessageRichText({ text }: { text: string }) {
  const links = extractMessageLinks(text);
  const previewUrl = links.find(supportsRichLinkPreview);
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const [index, link] of links.entries()) {
    const start = text.indexOf(link, offset);
    if (start < 0) continue;
    if (start > offset) parts.push(text.slice(offset, start));
    parts.push(
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        key={`${start}-${link}`}
        onClick={openChatLink}
        onAuxClick={openChatLink}
      >
        {link}
      </a>,
    );
    offset = start + link.length;
    if (index === links.length - 1 && offset < text.length) parts.push(text.slice(offset));
  }
  if (!links.length) parts.push(text);
  return (
    <>
      <p className="message-rich-text">{parts}</p>
      {previewUrl ? <MessageLinkPreviewCard url={previewUrl} /> : null}
    </>
  );
}

function isPhotoMessage(message: MessageItem) {
  return (
    message.kind === 'image' &&
    !message.metadata?.gif &&
    !message.deleted_at &&
    !message.metadata?.deleted
  );
}

async function clipboardPng(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image conversion is unavailable');
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (png) => (png ? resolve(png) : reject(new Error('PNG conversion failed'))),
        'image/png',
      ),
    );
  } finally {
    bitmap.close();
  }
}

export function MessageList({
  chatId,
  joinedRoomId,
  userId,
  groupChat,
  savedChat = false,
  messages,
  pinnedMessage: loadedPinnedMessage,
  showPinned = true,
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
  joinedRoomId?: string;
  userId: string;
  groupChat: boolean;
  savedChat?: boolean;
  messages: MessageItem[];
  pinnedMessage?: MessageItem;
  showPinned?: boolean;
  loading: boolean;
  error: string;
  sentMessageVersion: number;
  hasMore?: boolean;
  onRetry(): void;
  onLoadOlder?(): Promise<void>;
  onJoinCall(roomId: string, source?: 'room-invite'): void;
  onJoinInvite?(token: string): Promise<boolean>;
  chats?: ChatItem[];
  canModerateMessages?: boolean;
  canPinMessages?: boolean;
  onReply?(message: MessageItem): void;
  onReact?(messageId: string, emoji: string, remove?: boolean): Promise<boolean>;
  onPin?(messageId: string, pinned: boolean): Promise<boolean>;
  onEdit?(messageId: string, body: string): Promise<boolean>;
  onDelete?(messageId: string): Promise<boolean>;
  onForward?(messageId: string, targetChatId: string): Promise<boolean>;
  onReveal?(messageId: string): Promise<boolean>;
  searchQuery?: string;
  focusedMessageId?: string;
}) {
  const visibleMessages = useMemo(() => collapseDuplicateCallMessages(messages), [messages]);
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
  const [photoCopyStatus, setPhotoCopyStatus] = useState<{ ok: boolean }>();
  const [closingPhotoNotice, setClosingPhotoNotice] = useState<typeof photoCopyStatus>();
  useEffect(() => {
    if (!photoCopyStatus) return;
    const fade = window.setTimeout(() => setClosingPhotoNotice(photoCopyStatus), 3100);
    const dismiss = window.setTimeout(() => {
      setPhotoCopyStatus(undefined);
      setClosingPhotoNotice(undefined);
    }, 3500);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(dismiss);
    };
  }, [photoCopyStatus]);
  const [forwardingMessage, setForwardingMessage] = useState<MessageItem>();
  const [deletingMessage, setDeletingMessage] = useState<MessageItem>();
  const [editingMessage, setEditingMessage] = useState<MessageItem>();
  const [editingPending, setEditingPending] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [dragSelecting, setDragSelecting] = useState(false);
  const selectionMode = dragSelecting || selectedIds.size > 0;
  const menuRef = useRef<HTMLDivElement>(null);
  const dragSelectionRef = useRef<
    | {
        pointerId: number;
        startX: number;
        startY: number;
        startId: string;
        selecting: boolean;
        baseline: Set<string>;
        endId?: string;
        active: boolean;
      }
    | undefined
  >(undefined);
  const suppressSelectionClickRef = useRef(false);
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
    const cancelSelection = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSelectedIds(new Set());
      dragSelectionRef.current = undefined;
      setDragSelecting(false);
      scrollRef.current?.classList.remove('is-drag-selecting');
    };
    document.addEventListener('keydown', cancelSelection);
    return () => document.removeEventListener('keydown', cancelSelection);
  }, []);

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

  const copyPhoto = async (message: MessageItem) => {
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
        throw new Error('Image clipboard is unavailable');
      }
      // Start the clipboard write during the click, while the full image loads.
      const image = loadChatImage({
        accountId: userId,
        messageId: message.id,
        variant: 'full',
        expiresAt: message.expires_at,
        fetcher: () => accountClient.chatImageBlob(message.id, 'full'),
      }).then(clipboardPng);
      await Promise.all([
        navigator.clipboard.write([new ClipboardItem({ 'image/png': image })]),
        image,
      ]);
      setPhotoCopyStatus({ ok: true });
    } catch {
      setPhotoCopyStatus({ ok: false });
    }
  };

  const revealMessage = async (messageId: string) => {
    if (scrollToReferencedMessage(messageId)) return;
    if (!(await onReveal(messageId))) return;
    window.requestAnimationFrame(() => scrollToReferencedMessage(messageId));
  };

  const scrollToBottom = useCallback((smooth = false) => {
    const container = scrollRef.current;
    if (!container) return;
    const top = Math.max(0, container.scrollHeight - container.clientHeight);
    const alreadyAtBottom = Math.abs(container.scrollTop - top) < 1;
    if (!alreadyAtBottom && smooth && typeof container.scrollTo === 'function') {
      container.scrollTo({ top, behavior: 'smooth' });
    } else if (!alreadyAtBottom) {
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
        <strong>{t('Не удалось загрузить сообщения')}</strong>
        <p>{error}</p>
        <button onClick={onRetry}>{t('Повторить')}</button>
      </div>
    );

  return (
    <div className="message-scroll-shell">
      {photoCopyStatus && (
        <div
          className={`home-transient-notice photo-copy-notice ${photoCopyStatus.ok ? 'success' : 'error'}${closingPhotoNotice === photoCopyStatus ? ' closing' : ''}`}
          role={photoCopyStatus.ok ? 'status' : 'alert'}
        >
          {photoCopyStatus.ok ? t('Фото скопировано') : t('Не удалось скопировать фото')}
        </div>
      )}
      {showPinned && pinnedMessage ? (
        <div className="message-pinned-banner">
          <button
            type="button"
            className="message-pinned-jump"
            onClick={() => void revealMessage(pinnedMessage.id)}
          >
            <Pin />
            <span>
              <strong>{t('Закреплённое сообщение')}</strong>
              <small>{pinnedMessage.body || mediaKindLabel(pinnedMessage.kind)}</small>
            </span>
          </button>
          {canPinMessages ? (
            <button
              type="button"
              className="message-pinned-remove"
              aria-label={t('Открепить сообщение')}
              onClick={() => void onPin(pinnedMessage.id, false)}
            >
              <X />
            </button>
          ) : null}
        </div>
      ) : null}
      <div
        className="message-scroll-container"
        data-at-bottom={!viewingOlderMessages}
        ref={scrollRef}
        tabIndex={0}
        aria-label={t('История сообщений')}
        onScroll={onScroll}
        onDragStart={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if ((event.pointerType && event.pointerType !== 'mouse') || event.button !== 0) return;
          suppressSelectionClickRef.current = false;
          const target = event.target as HTMLElement;
          const check = target.closest('.message-selection-check');
          if (!check && target.closest('a,button,input,textarea,select,[contenteditable="true"]'))
            return;
          if (!selectionMode && target.closest('.message-bubble')) return;
          const entry = target.closest<HTMLElement>('[data-message-id]');
          const startId = entry?.dataset.messageId;
          if (!startId) return;
          dragSelectionRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startId,
            selecting: !selectedIds.has(startId),
            baseline: selectedIds,
            active: false,
          };
        }}
        onPointerMove={(event) => {
          const drag = dragSelectionRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          if (!drag.active) {
            if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
            drag.active = true;
            setDragSelecting(true);
            event.currentTarget.setPointerCapture?.(event.pointerId);
            event.currentTarget.classList.add('is-drag-selecting');
          }
          event.preventDefault();
          const bounds = event.currentTarget.getBoundingClientRect();
          const hit = document
            .elementFromPoint?.(
              Math.max(bounds.left + 1, Math.min(bounds.right - 1, event.clientX)),
              Math.max(bounds.top + 1, Math.min(bounds.bottom - 1, event.clientY)),
            )
            ?.closest<HTMLElement>('[data-message-id]');
          if (!hit || !event.currentTarget.contains(hit)) return;
          const hovered = hit.dataset.messageId;
          if (!hovered || hovered === drag.endId) return;
          const startIndex = visibleMessages.findIndex((message) => message.id === drag.startId);
          const endIndex = visibleMessages.findIndex((message) => message.id === hovered);
          if (startIndex < 0 || endIndex < 0) return;
          const [from, to] =
            startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
          drag.endId = hovered;
          const next = new Set(drag.baseline);
          for (const { id } of visibleMessages.slice(from, to + 1)) {
            if (drag.selecting) next.add(id);
            else next.delete(id);
          }
          setSelectedIds(next);
        }}
        onPointerUp={(event) => {
          const drag = dragSelectionRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          suppressSelectionClickRef.current = drag.active;
          dragSelectionRef.current = undefined;
          setDragSelecting(false);
          event.currentTarget.classList.remove('is-drag-selecting');
          if (event.currentTarget.hasPointerCapture?.(event.pointerId))
            event.currentTarget.releasePointerCapture?.(event.pointerId);
        }}
        onPointerCancel={(event) => {
          dragSelectionRef.current = undefined;
          setDragSelecting(false);
          event.currentTarget.classList.remove('is-drag-selecting');
        }}
        onLostPointerCapture={(event) => {
          if (dragSelectionRef.current?.pointerId !== event.pointerId) return;
          dragSelectionRef.current = undefined;
          setDragSelecting(false);
          event.currentTarget.classList.remove('is-drag-selecting');
        }}
        onClickCapture={(event) => {
          if (!suppressSelectionClickRef.current) return;
          suppressSelectionClickRef.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <div className={`message-stream${selectionMode ? ' selection-mode' : ''}`} ref={contentRef}>
          {olderBusy && (
            <div className="older-messages-loading">{t('Загружаем предыдущие сообщения…')}</div>
          )}
          {visibleMessages.length === 0 ? (
            <div className="message-history-empty">
              {savedChat ? <Bookmark /> : <MessageCircle />}
              <strong>{savedChat ? t('Избранное') : t('Начните разговор')}</strong>
              <p>
                {savedChat
                  ? t('Сохраняйте здесь мысли, ссылки и файлы. Их видите только вы.')
                  : t('Напишите первое сообщение в этом чате.')}
              </p>
            </div>
          ) : (
            visibleMessages.map((message, index) => {
              const previous = visibleMessages[index - 1];
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
                  <div className="message-selection-row">
                    {message.kind === 'call' || message.kind === 'system' ? (
                      <MessageEventRow
                        message={message}
                        selected={selectedIds.has(message.id)}
                        onContextMenu={openMessageContext}
                        onReply={() => onReply(message)}
                        onForward={() => setForwardingMessage(message)}
                      >
                        {message.kind === 'call' ? (
                          <SystemCallMessage
                            message={message}
                            joinedRoomId={joinedRoomId}
                            onJoin={onJoinCall}
                          />
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
                        onToggleReaction={(emoji, remove) => {
                          if (!remove) rememberReaction(emoji);
                          if (remove) void onReact(message.id, emoji, true);
                          else void onReact(message.id, emoji);
                        }}
                        onEdit={() => setEditingMessage(message)}
                        onForward={() => setForwardingMessage(message)}
                        onRevealMessage={(messageId) => void revealMessage(messageId)}
                      />
                    )}
                    {selectionMode && (
                      <button
                        type="button"
                        className="message-selection-check"
                        role="checkbox"
                        aria-label={t('Выделение сообщения')}
                        aria-checked={selectedIds.has(message.id)}
                        onClick={() => toggleSelected(message.id)}
                      >
                        <Check aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div className="message-bottom-anchor" ref={bottomAnchorRef} aria-hidden="true" />
        </div>
      </div>
      <MessageScrollRail scrollRef={scrollRef} contentRef={contentRef} />
      {viewingOlderMessages ? (
        <div className="message-history-position" role="status">
          <span>
            <span className="history-label-full">{t('Вы просматриваете старые сообщения')}</span>
            <span className="history-label-compact">{t('Старые сообщения')}</span>
          </span>
          <button
            type="button"
            aria-label={t('Вернуться к последним сообщениям')}
            onClick={() => scrollToBottom(true)}
          >
            <span className="history-button-full">{t('Вернуться к последним сообщениям')}</span>
            <span className="history-button-compact">{t('К последним')}</span>
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
                if (active) void onReact(contextMenu.message.id, emoji, true);
                else void onReact(contextMenu.message.id, emoji);
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
                if (isPhotoMessage(contextMenu.message)) void copyPhoto(contextMenu.message);
                else void copyMessages([contextMenu.message]);
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
        <div className="message-selection-bar" role="toolbar" aria-label={t('Выбранные сообщения')}>
          <strong>{selectedIds.size}</strong>
          <span>{t('выбрано')}</span>
          <button
            type="button"
            data-tooltip={t('Копировать')}
            aria-label={t('Копировать выбранные сообщения')}
            onClick={() =>
              void copyMessages(messages.filter((message) => selectedIds.has(message.id)))
            }
          >
            <Copy />
          </button>
          {selectedIds.size === 1 ? (
            <button
              type="button"
              data-tooltip={t('Переслать')}
              aria-label={t('Переслать выбранное сообщение')}
              onClick={() =>
                setForwardingMessage(messages.find((message) => selectedIds.has(message.id)))
              }
            >
              <Forward />
            </button>
          ) : null}
          <button
            type="button"
            data-tooltip={t('Снять выделение')}
            aria-label={t('Снять выделение')}
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
          title={t('Удалить сообщение?')}
          description={t('Сообщение исчезнет у всех участников этого чата.')}
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
function MessageScrollRail({
  scrollRef,
  contentRef,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef(0);
  useEffect(() => {
    const scroll = scrollRef.current;
    const rail = railRef.current;
    const thumb = thumbRef.current;
    if (!scroll || !rail || !thumb) return;
    const sync = () => {
      const range = scroll.scrollHeight - scroll.clientHeight;
      rail.hidden = range <= 0;
      if (rail.hidden) return;
      const height = rail.clientHeight;
      const thumbHeight = Math.min(
        height,
        Math.max(36, (scroll.clientHeight / scroll.scrollHeight) * height),
      );
      thumb.style.height = `${thumbHeight}px`;
      thumb.style.transform = `translateY(${(Math.max(0, scroll.scrollTop) / range) * (height - thumbHeight)}px)`;
    };
    sync();
    scroll.addEventListener('scroll', sync, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(sync);
    observer?.observe(scroll);
    if (contentRef.current) observer?.observe(contentRef.current);
    return () => {
      scroll.removeEventListener('scroll', sync);
      observer?.disconnect();
    };
  }, [contentRef, scrollRef]);
  const scrollToPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const scroll = scrollRef.current;
    const thumb = thumbRef.current;
    if (!scroll || !thumb) return;
    const rail = event.currentTarget.getBoundingClientRect();
    const travel = rail.height - thumb.offsetHeight;
    if (travel <= 0) return;
    const progress = Math.min(
      1,
      Math.max(0, (event.clientY - rail.top - dragOffset.current) / travel),
    );
    scroll.scrollTop = progress * (scroll.scrollHeight - scroll.clientHeight);
  };
  return (
    <div
      className="message-scroll-rail"
      ref={railRef}
      hidden
      aria-hidden="true"
      onPointerDown={(event) => {
        const thumb = thumbRef.current;
        if (event.button !== 0 || !thumb) return;
        event.preventDefault();
        dragOffset.current =
          event.target === thumb
            ? event.clientY - thumb.getBoundingClientRect().top
            : thumb.offsetHeight / 2;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.dataset.dragging = '';
        scrollToPointer(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) scrollToPointer(event);
      }}
      onLostPointerCapture={(event) => {
        delete event.currentTarget.dataset.dragging;
      }}
    >
      <div className="message-scroll-thumb" ref={thumbRef} />
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
  onRevealMessage,
}: {
  message: MessageItem;
  accountId: string;
  own: boolean;
  grouped: boolean;
  showAuthor: boolean;
  selected: boolean;
  onJoinCall(roomId: string, source?: 'room-invite'): void;
  onJoinInvite(token: string): Promise<boolean>;
  onContextMenu(
    message: MessageItem,
    x: number,
    y: number,
    options?: { expanded?: boolean; pickerOnly?: boolean },
  ): void;
  quickReactions: string[];
  onToggleReaction(emoji: string, remove?: boolean): void;
  onEdit(): void;
  onForward(): void;
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
  const isPhoto = isPhotoMessage(message);
  const messageMeta = (
    <span className="message-meta">
      {message.edited_at ? <small>{t('изменено')}</small> : null}
      {message.pinned_at ? <Pin aria-label={t('Закреплено')} /> : null}
      <time>{formatMessageTime(message.created_at)}</time>
    </span>
  );
  const isPlainText = message.kind === 'text' && !gif && !isInvite;
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
          <div className="message-hover-actions" role="toolbar" aria-label={t('Быстрые действия')}>
            {quickReactions.map((emoji) => (
              <button
                type="button"
                className="message-hover-reaction"
                aria-label={t('Поставить реакцию {p0}', { p0: emoji })}
                onClick={() => {
                  const active = message.reactions?.some(
                    (reaction) => reaction.emoji === emoji && reactionMine(reaction, accountId),
                  );
                  onToggleReaction(emoji, active);
                }}
                key={emoji}
              >
                {emoji}
              </button>
            ))}
            <button
              type="button"
              aria-label={t('Выбрать другую реакцию')}
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
              <button type="button" aria-label={t('Изменить сообщение')} onClick={onEdit}>
                <Pencil />
              </button>
            ) : null}
            <button type="button" aria-label={t('Переслать сообщение')} onClick={onForward}>
              <Forward />
            </button>
            <button
              type="button"
              aria-label={t('Другие действия')}
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
          className={`message-bubble${isPlainText ? ' text-message-bubble' : ''}${isPhoto ? ' image-message-bubble' : ''}${message.kind === 'file' ? ' file-message-bubble' : ''}${gif ? ' gif-message-bubble' : ''}${isInvite ? ' invite-message-bubble' : ''}${deleted ? ' deleted' : ''}`}
        >
          {showAuthor && !deleted ? (
            <strong className="message-author">
              {message.display_name || message.username || 'Участник'}
            </strong>
          ) : isPlainText && !grouped && !deleted ? (
            <strong className="message-author compact-message-author">
              {message.display_name || message.username || (own ? 'Вы' : 'Участник')}
            </strong>
          ) : null}
          {forwardedName && !deleted ? (
            <span className="message-forwarded-label">
              <Forward /> {t('Переслано от')} {forwardedName}
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
                  ? t('Сообщение удалено')
                  : replyTo.body || mediaKindLabel(replyTo.kind)}
              </span>
            </button>
          ) : null}
          {deleted ? (
            <p className="deleted-message-copy">{t('Сообщение удалено')}</p>
          ) : gif ? (
            <GifMessage gif={gif} messageId={message.id} accountId={accountId} />
          ) : message.kind === 'image' ? (
            <ChatImageMessage message={message} accountId={accountId} meta={messageMeta} />
          ) : message.kind === 'file' ? (
            <ChatFileMessage message={message} accountId={accountId} />
          ) : inviteToken ? (
            <InviteMessageCard token={inviteToken} onJoin={onJoinInvite} />
          ) : roomInviteId ? (
            <RoomInviteMessageCard
              roomId={roomInviteId}
              onJoin={(code) => onJoinCall(code, 'room-invite')}
            />
          ) : (
            <MessageRichText text={message.body} />
          )}
          {!isPhoto && messageMeta}
        </div>
        {!deleted && message.reactions?.length ? (
          <div className="message-reactions" aria-label={t('Реакции на сообщение')}>
            {message.reactions.map((reaction) => (
              <button
                type="button"
                className={reactionMine(reaction, accountId) ? 'mine' : ''}
                aria-label={`${reaction.emoji}: ${reaction.count}`}
                aria-pressed={reactionMine(reaction, accountId)}
                onClick={() => onToggleReaction(reaction.emoji, reactionMine(reaction, accountId))}
                key={reaction.emoji}
              >
                <span>{reaction.emoji}</span>
                <b>{reaction.count}</b>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function mediaKindLabel(kind: string) {
  if (kind === 'image') return 'Фотография';
  if (kind === 'file') return 'Файл';
  if (kind === 'call') return 'Звонок';
  return 'Сообщение';
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 1) return 'Файл';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toLocaleString('ru-RU', {
    maximumFractionDigits: 1,
  })} МБ`;
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

function GifMessage({
  gif,
  messageId,
  accountId,
}: {
  gif: GifMessageData;
  messageId: string;
  accountId?: string;
}) {
  const library = useGifLibrary(accountId);
  const favorite = library.gifs.some((item) => gifKey(item) === gifKey(gif));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(false);
  return (
    <figure
      className="chat-gif-message"
      style={{ aspectRatio: gif.width && gif.height ? `${gif.width} / ${gif.height}` : undefined }}
    >
      {failed ? (
        <span className="chat-gif-load-error">{t('GIF не удалось загрузить')}</span>
      ) : (
        <GifImage gif={gif} onError={() => setFailed(true)} />
      )}
      <figcaption>
        <span>GIF</span>
        {accountId ? (
          <button
            className={`gif-favorite-action${favorite ? ' saved' : ''}`}
            disabled={busy}
            aria-label={favorite ? t('Убрать GIF из избранного') : t('Добавить GIF в избранное')}
            onClick={(event) => {
              event.stopPropagation();
              setBusy(true);
              setError('');
              void toggleGifFavorite(accountId, gif, messageId)
                .catch(() => setError('Не удалось сохранить GIF'))
                .finally(() => setBusy(false));
            }}
          >
            <Save />
            {favorite ? t('Сохранено') : t('Сохранить')}
          </button>
        ) : null}
        {gif.attribution.provider !== 'TRLKA' ? (
          <a
            href={gif.attribution.pageUrl}
            onClick={openChatLink}
            onAuxClick={openChatLink}
            target="_blank"
            rel="noreferrer"
            data-tooltip={gif.attribution.license || 'Источник GIF'}
          >
            {gif.attribution.provider}
          </a>
        ) : null}
      </figcaption>
      {error ? (
        <span className="gif-save-error" role="alert">
          {error}
        </span>
      ) : null}
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
      aria-label={t('Действия с сообщением')}
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
        <div className="message-quick-reactions" aria-label={t('Быстрые реакции')}>
          {QUICK_MESSAGE_REACTIONS.map((emoji) => (
            <button
              type="button"
              aria-label={t('Поставить реакцию {p0}', { p0: emoji })}
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
            aria-label={t('Все реакции')}
            aria-expanded={state.expanded}
            onClick={onExpand}
          >
            <ChevronDown />
          </button>
        </div>
      ) : null}
      {reactionsAllowed && (state.expanded || state.pickerOnly) ? (
        <div className="message-reaction-picker" aria-label={t('Выбор реакции')}>
          <div className="message-reaction-palette">
            {MESSAGE_REACTION_PALETTE.map((emoji) => (
              <button
                type="button"
                aria-label={t('Поставить реакцию {p0}', { p0: emoji })}
                aria-pressed={reactionIsActive(emoji)}
                onClick={() => onReact(emoji)}
                key={emoji}
              >
                {emoji}
              </button>
            ))}
          </div>
          <div className="message-custom-reaction">
            <input
              value={customReaction}
              maxLength={16}
              placeholder={t('Вставьте любой эмодзи')}
              aria-label={t('Любой эмодзи')}
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
              aria-label={t('Поставить введённую реакцию')}
              onClick={submitCustomReaction}
            >
              <Send />
            </button>
          </div>
        </div>
      ) : null}
      {!state.pickerOnly ? (
        <div className="message-context-actions">
          <button type="button" role="menuitem" onClick={onReply}>
            <Reply />
            {t('Ответить')}
          </button>
          {own && state.message.kind === 'text' && !state.message.metadata?.gif ? (
            <button type="button" role="menuitem" onClick={onEdit}>
              <Pencil />
              {t('Изменить')}
            </button>
          ) : null}
          {canPin ? (
            <button type="button" role="menuitem" onClick={onPin}>
              {state.message.pinned_at ? <PinOff /> : <Pin />}
              {state.message.pinned_at ? t('Открепить') : t('Закрепить')}
            </button>
          ) : null}
          <button type="button" role="menuitem" onClick={onCopy}>
            <Copy /> {isPhotoMessage(state.message) ? t('Копировать фото') : t('Копировать текст')}
          </button>
          <button type="button" role="menuitem" onClick={onForward}>
            <Forward />
            {t('Переслать')}
          </button>
          {canDelete ? (
            <button type="button" role="menuitem" className="destructive" onClick={onDelete}>
              <Trash2 />
              {t('Удалить')}
              {own ? '' : t(' как администратор')}
            </button>
          ) : null}
          <button type="button" role="menuitem" onClick={onSelect}>
            <CheckCircle2 /> {t('Выделить')}
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
  const canSave =
    Boolean(trimmed) &&
    trimmed !== message.body &&
    trimmed.length <= CHAT_MESSAGE_MAX_LENGTH &&
    !busy;
  return createPortal(
    <div className="forward-message-backdrop" onPointerDown={onClose}>
      <section
        className="edit-message-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('Изменить сообщение')}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header>
          <strong>{t('Изменить сообщение')}</strong>
          <button type="button" aria-label={t('Закрыть')} disabled={busy} onClick={onClose}>
            <X />
          </button>
        </header>
        <textarea
          autoFocus
          value={body}
          aria-label={t('Текст сообщения')}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
            if (event.key !== 'Enter' || event.shiftKey) return;
            event.preventDefault();
            if (canSave) onSave(trimmed);
          }}
        />
        <footer>
          <small>
            {trimmed.length > CHAT_MESSAGE_MAX_LENGTH
              ? t('Лимит: {p0} символов', { p0: CHAT_MESSAGE_MAX_LENGTH })
              : t('Enter — сохранить, Shift + Enter — новая строка')}
          </small>
          <button type="button" disabled={!canSave} onClick={() => onSave(trimmed)}>
            <Save />
            {busy ? t('Сохраняем…') : t('Сохранить')}
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
        aria-label={t('Переслать сообщение')}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header>
          <span className="forward-title-icon" aria-hidden="true">
            <Forward />
          </span>
          <div>
            <strong>{t('Переслать сообщение')}</strong>
            <small>{message.body || mediaKindLabel(message.kind)}</small>
          </div>
          <button type="button" aria-label={t('Закрыть')} disabled={busy} onClick={onClose}>
            <X />
          </button>
        </header>
        <label>
          <Search />
          <input
            value={search}
            autoFocus
            placeholder={t('Найти чат')}
            aria-label={t('Найти чат для пересылки')}
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
                  <small>{chat.type === 'group' ? t('Группа') : t('Личный чат')}</small>
                </span>
                <Forward />
              </button>
            ))
          ) : (
            <p>{t('Подходящих чатов нет')}</p>
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
          <strong>{t('Не удалось проверить ссылку')}</strong>
          <small>{t('Проверьте подключение и откройте чат снова')}</small>
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
          <strong>{t('Ссылка истекла')}</strong>
          <small>{t('Этот звонок уже завершён')}</small>
        </span>
      </div>
    );

  return (
    <div className={`chat-invite-card${preview ? '' : ' loading'}`}>
      <span className="chat-invite-avatar">
        <Phone />
      </span>
      <span className="chat-invite-copy">
        <small>{t('Приглашение в звонок')}</small>
        <strong>{preview ? t('Голосовая комната') : t('Проверяем ссылку…')}</strong>
        <span>
          {preview
            ? `${preview.participantCount} ${participantWord(preview.participantCount)}`
            : t('Получаем информацию')}
        </span>
      </span>
      {preview && (
        <button type="button" onClick={() => onJoin(roomId)}>
          {t('Присоединиться')}
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
          <strong>{t('Приглашение недоступно')}</strong>
          <small>{t('Ссылка устарела или была отозвана')}</small>
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
        <small>{t('Приглашение в группу')}</small>
        <strong>{preview?.title || 'Загрузка группы…'}</strong>
        <span>
          {preview ? t('{p0} участников', { p0: preview.memberCount }) : t('Получаем информацию')}
        </span>
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
          {joining ? t('Открываем…') : preview.isMember ? t('Открыть') : t('Вступить')}
        </button>
      )}
    </div>
  );
}

const downloadedChatFiles = new Set<string>();
function ChatFileMessage({ message, accountId }: { message: MessageItem; accountId: string }) {
  const receiptKey = `${accountId}:${message.id}`;
  const [downloaded, setDownloaded] = useState(() => downloadedChatFiles.has(receiptKey));
  const [downloading, setDownloading] = useState(false);
  const downloadBusy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [progress, setProgress] = useState({
    received: 0,
    total: undefined as number | undefined,
    bytesPerSecond: 0,
  });
  const [failed, setFailed] = useState(false);
  const filename = message.metadata?.filename?.trim() || 'Файл';
  const size = Number(message.metadata?.size ?? 0);

  const download = async () => {
    if (downloadBusy.current) return;
    downloadBusy.current = true;
    setProgress({ received: 0, total: undefined, bytesPerSecond: 0 });
    setDownloading(true);
    setFailed(false);
    try {
      const blob = await accountClient.chatFileBlob(message.id, (next) => {
        if (mounted.current) setProgress({ ...next, total: next.total });
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.rel = 'noopener';
      document.body.append(link);
      link.click();
      link.remove();
      downloadedChatFiles.add(receiptKey);
      if (downloadedChatFiles.size > 1000)
        downloadedChatFiles.delete(downloadedChatFiles.values().next().value!);
      if (mounted.current) setDownloaded(true);
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      downloadBusy.current = false;
      if (mounted.current) setDownloading(false);
    }
  };

  const total = progress.total ?? size;
  const percent =
    total > 0 ? Math.min(100, Math.round((progress.received * 100) / total)) : undefined;
  return (
    <div className="chat-file-message">
      <button
        type="button"
        onClick={() => void download()}
        disabled={downloading}
        aria-label={t(downloaded ? 'Скачать повторно: {name}' : 'Скачать: {name}', {
          name: filename,
        })}
      >
        <span className="chat-file-icon">
          <FileText aria-hidden="true" />
        </span>
        <span className="chat-file-copy">
          <strong>{filename}</strong>
          <small>
            {failed
              ? t('Не удалось скачать — попробуйте ещё раз')
              : downloading
                ? `${formatFileSize(progress.received)} / ${formatFileSize(total)} · ${formatFileSize(progress.bytesPerSecond)}/${t('с')}`
                : formatFileSize(size)}
          </small>
        </span>
        {downloading ? (
          <span
            className="chat-file-progress"
            role="progressbar"
            aria-label={t('Скачивание файла')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            style={{ '--download-progress': `${percent ?? 18}%` } as CSSProperties}
          >
            <span>{percent !== undefined ? `${percent}%` : '…'}</span>
          </span>
        ) : downloaded && !failed ? (
          <Check className="chat-file-download completed" aria-label={t('Файл скачан')} />
        ) : (
          <Download className="chat-file-download" aria-hidden="true" />
        )}
      </button>
      {message.body && <p>{message.body}</p>}
    </div>
  );
}

function ChatImageMessage({
  message,
  accountId,
  meta,
}: {
  message: MessageItem;
  accountId: string;
  meta: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageIdentity = useMemo(
    () => ({
      accountId,
      messageId: message.id,
      variant: 'thumbnail' as const,
      expiresAt: message.expires_at,
    }),
    [accountId, message.id, message.expires_at],
  );
  const [thumbnail, setThumbnail] = useState(() => peekChatImageDisplay(imageIdentity));
  const [shouldLoad, setShouldLoad] = useState(
    () => Boolean(thumbnail) || typeof IntersectionObserver === 'undefined',
  );
  const thumbnailSource = thumbnail?.src ?? '';
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
    const cached = peekChatImageDisplay(imageIdentity);
    if (cached) {
      setThumbnail(cached);
      return;
    }
    let active = true;
    setFailed(false);
    void loadChatImageDisplay({
      ...imageIdentity,
      fetcher: () => accountClient.chatImageBlob(message.id, 'thumbnail'),
    })
      .then((display) => {
        if (!active) return;
        setThumbnail(display);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [imageIdentity, message.id, shouldLoad]);

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
  const width = Number(message.metadata?.width) || thumbnail?.width || 0;
  const height = Number(message.metadata?.height) || thumbnail?.height || 0;
  const hasDimensions =
    Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  const ratio = hasDimensions ? width / height : 1;

  return (
    <>
      <div
        className={`chat-image-message${hasDimensions ? ' has-image-size' : ''}`}
        ref={containerRef}
        style={
          hasDimensions
            ? {
                width: `min(${width}px, var(--chat-photo-max-width, min(430px, 60vw)), ${540 * ratio}px, ${62 * ratio}vh)`,
              }
            : undefined
        }
      >
        <div
          className="chat-image-frame"
          style={hasDimensions ? { aspectRatio: `${width} / ${height}` } : undefined}
        >
          {thumbnailSource ? (
            <button
              type="button"
              className="chat-image-open"
              aria-label={t('Открыть фотографию на весь экран')}
              onClick={() => {
                setViewerClosing(false);
                setViewerOpen(true);
              }}
            >
              <img
                src={thumbnailSource}
                alt={alt}
                width={hasDimensions ? width : undefined}
                height={hasDimensions ? height : undefined}
                onLoad={(event) => {
                  const image = event.currentTarget;
                  rememberChatImageDimensions(
                    imageIdentity,
                    image.naturalWidth,
                    image.naturalHeight,
                  );
                  if (!hasDimensions && image.naturalWidth && image.naturalHeight)
                    setThumbnail((current) =>
                      current
                        ? { ...current, width: image.naturalWidth, height: image.naturalHeight }
                        : current,
                    );
                }}
              />
            </button>
          ) : failed ? (
            <span className="chat-image-error">{t('Не удалось загрузить фотографию')}</span>
          ) : (
            <span
              className="chat-image-loading"
              role="status"
              aria-label={t('Загружаем фотографию')}
              style={
                message.metadata?.width && message.metadata?.height
                  ? { aspectRatio: `${message.metadata.width} / ${message.metadata.height}` }
                  : undefined
              }
            />
          )}
          {meta}
        </div>
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
                aria-label={t('Закрыть фотографию')}
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
}: {
  message: MessageItem;
  selected: boolean;
  children: ReactNode;
  onContextMenu(message: MessageItem, x: number, y: number): void;
  onReply(): void;
  onForward(): void;
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
        aria-label={t('Быстрые действия')}
      >
        <button type="button" aria-label={t('Ответить на сообщение')} onClick={onReply}>
          <Reply />
        </button>
        <button type="button" aria-label={t('Переслать сообщение')} onClick={onForward}>
          <Forward />
        </button>
        <button
          type="button"
          aria-label={t('Другие действия')}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            openContext(rect.right - 286, rect.bottom + 6);
          }}
        >
          <MoreHorizontal />
        </button>
      </div>
      {children}
    </article>
  );
}

function SystemCallMessage({
  message,
  joinedRoomId,
  onJoin,
}: {
  message: MessageItem;
  joinedRoomId?: string;
  onJoin(roomId: string): void;
}) {
  const serverEnded = message.metadata?.ended === true;
  const participants = message.metadata?.participants ?? [];
  const startedAt = message.metadata?.startedAt;
  const endedAt = message.metadata?.endedAt;
  const aloneSince = message.metadata?.aloneSince;
  const established = message.metadata?.established === true;
  const [now, setNow] = useState(() => Date.now());
  const abandoned =
    !serverEnded &&
    isAbandonedConversationCall(
      startedAt,
      participants.length,
      now,
      aloneSince ?? undefined,
      established,
    );
  useEffect(() => {
    if (serverEnded || abandoned || !startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [abandoned, serverEnded, startedAt]);
  const ended = serverEnded || abandoned;
  const joined = !ended && Boolean(joinedRoomId) && message.metadata?.roomId === joinedRoomId;
  const durationEnd = endedAt
    ? Date.parse(endedAt)
    : abandoned && startedAt
      ? Date.parse(aloneSince || startedAt) + EMPTY_CONVERSATION_CALL_TIMEOUT_MS
      : serverEnded
        ? undefined
        : now;
  const duration =
    startedAt && durationEnd !== undefined
      ? formatCallDuration(Math.max(0, Math.floor((durationEnd - Date.parse(startedAt)) / 1_000)))
      : null;
  return (
    <div className={`system-call-message${ended ? ' ended' : joined ? ' joined' : ''}`}>
      <span className="system-call-icon">
        <Phone />
      </span>
      <div className="system-call-content">
        <strong>{formatChatCallLabel(message.kind, message.body)}</strong>
        {participants.length > 0 || duration ? (
          <div className="system-call-summary">
            {participants.length > 0 ? (
              <span
                className="system-call-participants"
                aria-label={t('Участники: {p0}', {
                  p0: participants.map(({ displayName }) => displayName).join(', '),
                })}
              >
                {participants.slice(0, 4).map((participant, index) => (
                  <span
                    className="system-call-participant"
                    key={participant.userId ?? `${participant.displayName}-${index}`}
                    data-tooltip={participant.displayName}
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
              <span
                className="system-call-duration"
                aria-label={t('Время разговора {p0}', { p0: duration })}
              >
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
        <span className="system-call-ended">{t('Звонок завершён')}</span>
      ) : joined ? (
        <span className="system-call-joined">{t('Вы в звонке')}</span>
      ) : message.metadata?.roomId ? (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onJoin(message.metadata!.roomId!);
          }}
        >
          {t('Присоединиться')}
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

const sendFlightKeyframes = [
  { offset: 0, transform: 'translate(0, 0) scale(1)', opacity: 1 },
  { offset: 0.4, transform: 'translate(24px, -24px) scale(.72)', opacity: 0 },
  { offset: 0.46, transform: 'translate(-19px, 19px) scale(.8)', opacity: 0 },
  { offset: 1, transform: 'translate(0, 0) scale(1)', opacity: 1 },
];
const longSendFlightKeyframes = [
  sendFlightKeyframes[0]!,
  { offset: 0.09, transform: 'translate(3px, -3px) rotate(-8deg)' },
  { offset: 0.17, transform: 'translate(-2px, 2px) rotate(5deg)' },
  { offset: 0.25, transform: 'translate(3px, -3px) rotate(-6deg)' },
  { offset: 0.32, transform: 'translate(-1px, 1px)' },
  ...sendFlightKeyframes.map((frame) => ({ ...frame, offset: 0.36 + frame.offset * 0.64 })),
];

function MessageComposer({
  disabled,
  onSend,
  onSendImage,
  onSendFile,
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
  onSendFile(file: globalThis.File, caption: string, replyToMessageId?: string): Promise<boolean>;
  onSendGif(gif: GifMessageData | File, replyToMessageId?: string): Promise<boolean>;
  replyTarget?: MessageItem;
  onCancelReply(): void;
}) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [processingImage, setProcessingImage] = useState(false);
  const [imageDataUrl, setImageDataUrl] = useState('');
  const [thumbnailDataUrl, setThumbnailDataUrl] = useState('');
  const [attachmentFile, setAttachmentFile] = useState<globalThis.File>();
  const [imageError, setImageError] = useState('');
  const [picker, setPicker] = useState<'gif' | 'stickers' | 'emoji'>();
  const showGifPicker = picker === 'gif';
  const [gifError, setGifError] = useState('');
  const [gifFilePreview, setGifFilePreview] = useState('');
  const [composerMenu, setComposerMenu] = useState<{
    x: number;
    y: number;
    section?: 'suggestions' | 'languages';
  }>();
  const [spellCheckEnabled, setSpellCheckEnabled] = useState(true);
  const [showSendButton, setShowSendButton] = useState(true);
  const [composerLanguage, setComposerLanguage] = useState<'ru' | 'en' | 'auto'>('ru');
  const imageInputRef = useRef<HTMLInputElement>(null);
  const sendIconRef = useRef<SVGSVGElement>(null);
  const sendAnimationRef = useRef<Animation>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerMenuRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const messageLimit = imageDataUrl || attachmentFile ? 1000 : CHAT_MESSAGE_MAX_LENGTH;
  const remaining = messageLimit - value.trim().length;
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const resize = () => {
      const scrollTop = textarea.scrollTop;
      textarea.style.height = '0px';
      textarea.style.height = `${textarea.scrollHeight}px`;
      textarea.scrollTop = scrollTop;
    };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    let width = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth === width) return;
      width = textarea.clientWidth;
      resize();
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [value]);
  useEffect(() => {
    if (!picker || picker === 'gif') return;
    const dismiss = (event: globalThis.PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setPicker(undefined);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setPicker(undefined);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [picker]);
  useEffect(() => {
    if (
      !attachmentFile ||
      !(attachmentFile.type === 'image/gif' || /\.gif$/i.test(attachmentFile.name))
    ) {
      setGifFilePreview('');
      return;
    }
    const url = URL.createObjectURL(attachmentFile);
    setGifFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [attachmentFile]);
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
  const insertText = (text: string) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? start;
    setValue(`${value.slice(0, start)}${text}${value.slice(end)}`);
    window.requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + text.length, start + text.length);
    });
  };
  const pasteClipboardText = async () => {
    try {
      const pasted = await navigator.clipboard.readText();
      if (pasted) insertText(pasted);
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
        setAttachmentFile(undefined);
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
  const prepareSelectedAttachment = (file: globalThis.File) => {
    setImageError('');
    if (file.size < 1) {
      setImageError('Нельзя отправить пустой файл.');
      return;
    }
    if (file.size > MAX_CHAT_FILE_BYTES) {
      setImageError('Размер файла не должен превышать 30 МБ.');
      return;
    }
    if (CHAT_IMAGE_TYPES.has(file.type) && file.size <= 25 * 1024 * 1024) {
      prepareSelectedImage(file);
      return;
    }
    setImageDataUrl('');
    setThumbnailDataUrl('');
    setAttachmentFile(file);
  };
  const selectSticker = (emoji: string) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 192;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.font = '144px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(emoji, 96, 100);
    canvas.toBlob((blob) => {
      if (blob) prepareSelectedImage(new File([blob], 'sticker.png', { type: 'image/png' }));
      else setImageError('Не удалось подготовить стикер');
    }, 'image/png');
    setPicker(undefined);
  };
  const send = async () => {
    const body = value.trim();
    if (
      disabled ||
      remaining < 0 ||
      (!body && !imageDataUrl && !attachmentFile) ||
      sending ||
      processingImage
    )
      return;
    setSending(true);
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      const longMessage = body.length >= 200;
      sendAnimationRef.current?.cancel();
      sendAnimationRef.current =
        sendIconRef.current?.animate?.(
          longMessage ? longSendFlightKeyframes : sendFlightKeyframes,
          {
            duration: longMessage ? 560 : 360,
            easing: longMessage ? 'linear' : 'cubic-bezier(.22,.61,.36,1)',
          },
        ) ?? null;
    }
    try {
      const sent =
        attachmentFile &&
        (attachmentFile.type === 'image/gif' || /\.gif$/i.test(attachmentFile.name))
          ? await onSendGif(attachmentFile, replyTarget?.id)
          : attachmentFile
            ? replyTarget
              ? await onSendFile(attachmentFile, body, replyTarget.id)
              : await onSendFile(attachmentFile, body)
            : imageDataUrl
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
        setAttachmentFile(undefined);
        setImageError('');
        onCancelReply();
      }
    } catch (caught) {
      setImageError(caught instanceof Error ? caught.message : 'Не удалось отправить сообщение');
    } finally {
      setSending(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
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
              {t('Ответ для')} {replyTarget.display_name || replyTarget.username || 'пользователя'}
            </strong>
            <small>{replyTarget.body || mediaKindLabel(replyTarget.kind)}</small>
          </span>
          <button type="button" aria-label={t('Отменить ответ')} onClick={onCancelReply}>
            <X />
          </button>
        </div>
      ) : null}
      {imageDataUrl && (
        <div className="composer-image-preview">
          <img src={imageDataUrl} alt={t('Предпросмотр отправляемой фотографии')} />
          <span>{t('Фотография готова к отправке')}</span>
          <button
            type="button"
            aria-label={t('Убрать фотографию')}
            onClick={() => {
              setImageDataUrl('');
              setThumbnailDataUrl('');
            }}
          >
            <X />
          </button>
        </div>
      )}
      {attachmentFile && (
        <div className="composer-file-preview">
          {gifFilePreview ? (
            <img
              className="composer-gif-preview"
              src={gifFilePreview}
              alt={t('Предпросмотр своего GIF')}
            />
          ) : (
            <FileText aria-hidden="true" />
          )}
          <span>
            <strong>{attachmentFile.name}</strong>
            <small>{formatFileSize(attachmentFile.size)}</small>
          </span>
          <button
            type="button"
            aria-label={t('Убрать файл')}
            onClick={() => setAttachmentFile(undefined)}
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
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          prepareSelectedAttachment(file);
        }}
      />
      <button
        type="button"
        className="composer-add-button"
        data-tooltip={t('Отправить файл или фотографию (до 30 МБ)')}
        aria-label={t('Добавить файл или фотографию')}
        disabled={disabled || sending || processingImage}
        onClick={() => imageInputRef.current?.click()}
      >
        <ImagePlus />
      </button>
      <div className="composer-editor">
        <textarea
          ref={textareaRef}
          value={value}
          rows={1}
          disabled={disabled}
          spellCheck={spellCheckEnabled}
          lang={composerLanguage === 'auto' ? undefined : composerLanguage}
          placeholder={t('Написать сообщение…')}
          aria-label={t('Сообщение')}
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
            prepareSelectedAttachment(image);
          }}
        />
        <div className="composer-expression-tools" ref={pickerRef}>
          <button
            type="button"
            className={`composer-gif-button${showGifPicker ? ' active' : ''}`}
            data-tooltip={t('Найти GIF')}
            aria-label={t('Открыть поиск GIF')}
            aria-expanded={showGifPicker}
            disabled={disabled || sending || processingImage}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setPicker(showGifPicker ? undefined : 'gif')}
          >
            <span>GIF</span>
          </button>
          <button
            type="button"
            className="composer-expression-button composer-sticker-button"
            aria-label={t('Стикеры')}
            aria-expanded={picker === 'stickers'}
            disabled={disabled || sending || processingImage}
            onClick={() => setPicker(picker === 'stickers' ? undefined : 'stickers')}
          >
            <Sticker />
          </button>
          <button
            type="button"
            className="composer-expression-button composer-emoji-button"
            aria-label={t('Эмодзи')}
            aria-expanded={picker === 'emoji'}
            disabled={disabled || sending}
            onClick={() => setPicker(picker === 'emoji' ? undefined : 'emoji')}
          >
            <Smile />
          </button>
          {(picker === 'stickers' || picker === 'emoji') && (
            <div
              className="composer-expression-picker"
              role="group"
              aria-label={picker === 'stickers' ? t('Выбор стикера') : t('Выбор эмодзи')}
            >
              {(picker === 'stickers'
                ? ['😎', '😂', '🔥', '❤️', '🎉', '👋']
                : [
                    '😀',
                    '😂',
                    '🥹',
                    '😎',
                    '😍',
                    '😮',
                    '😭',
                    '👍',
                    '👋',
                    '🙏',
                    '❤️',
                    '🔥',
                    '🎉',
                    '✨',
                    '🤝',
                    '💯',
                  ]
              ).map((emoji) => (
                <button
                  type="button"
                  key={emoji}
                  onClick={() => {
                    if (picker === 'stickers') selectSticker(emoji);
                    else {
                      insertText(emoji);
                      setPicker(undefined);
                    }
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {showSendButton ? (
        <button
          type="button"
          className="send-message-button"
          data-tooltip={t('Отправить')}
          aria-label={t('Отправить сообщение')}
          disabled={
            disabled ||
            sending ||
            processingImage ||
            remaining < 0 ||
            (!value.trim() && !imageDataUrl && !attachmentFile)
          }
          onClick={() => void send()}
        >
          <Send ref={sendIconRef} aria-hidden="true" />
        </button>
      ) : null}
      {remaining < 100 && (
        <output className={`composer-character-count${remaining < 0 ? ' over-limit' : ''}`}>
          {remaining < 0
            ? t('{p0} · лимит {p1} символов', { p0: remaining, p1: messageLimit })
            : remaining}
        </output>
      )}
      {showGifPicker ? (
        <GifPicker
          externalError={gifError}
          busy={sending || disabled}
          onClose={() => setPicker(undefined)}
          onSelect={(gif) => {
            if (sending || disabled) return;
            setGifError('');
            setSending(true);
            void (replyTarget ? onSendGif(gif, replyTarget.id) : onSendGif(gif))
              .then((sent) => {
                if (sent) {
                  setPicker(undefined);
                  onCancelReply();
                }
              })
              .catch((caught) =>
                setGifError(caught instanceof Error ? caught.message : 'Не удалось отправить GIF'),
              )
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
      aria-label={t('Действия с полем сообщения')}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type="button" role="menuitem" onClick={() => onSection('suggestions')}>
        <span>{t('Предложения')}</span>
        <ChevronRight />
      </button>
      {section === 'suggestions' ? (
        <p className="composer-context-note">{t('Подсказки появятся для слов с ошибками')}</p>
      ) : null}
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={showSendButton}
        onClick={onToggleSendButton}
      >
        <span>{t('Кнопка отправки сообщений')}</span>
        <i>{showSendButton ? <Check /> : null}</i>
      </button>
      <hr />
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={spellCheckEnabled}
        onClick={onToggleSpellCheck}
      >
        <span>{t('Проверка правописания')}</span>
        <i>{spellCheckEnabled ? <Check /> : null}</i>
      </button>
      <button type="button" role="menuitem" onClick={() => onSection('languages')}>
        <span>{t('Языки')}</span>
        <ChevronRight />
      </button>
      {section === 'languages' ? (
        <div className="composer-language-options" role="group" aria-label={t('Язык проверки')}>
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
        <span>{t('Вставить')}</span>
        <kbd>Ctrl+V</kbd>
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
      <strong>{t('Выберите чат')}</strong>
      <p>{t('Откройте диалог или начните новый.')}</p>
    </div>
  );
}

function ChatListSkeleton() {
  return (
    <div className="chat-list-skeleton" aria-label={t('Загрузка чатов')} aria-busy="true">
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
    <div className="message-skeleton" aria-label={t('Загрузка сообщений')} aria-busy="true">
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

export function ChatAvatar({
  name,
  group,
  avatarUrl,
  compact = false,
  activeCall = false,
  presence,
  positionX = 50,
  positionY = 50,
  scale = 100,
}: {
  name: string;
  group: boolean;
  avatarUrl?: string | null;
  compact?: boolean;
  activeCall?: boolean;
  presence?: PresenceStatus;
  positionX?: number;
  positionY?: number;
  scale?: number;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const cachedAvatarUrl = useCachedMediaUrl(avatarUrl);
  useEffect(() => setImageFailed(false), [avatarUrl]);
  const showImage = Boolean(cachedAvatarUrl && !imageFailed);
  if (avatarUrl === SERVICE_BOT_AVATAR_URL)
    return <ServiceBotAvatar className={`chat-avatar${compact ? ' compact' : ''}`} />;
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
      {group && activeCall && (
        <span className="group-active-call-badge" data-tooltip={t('Идёт звонок')}>
          <Volume2 />
        </span>
      )}
      {!group && presence ? <PresenceBadge status={presence} /> : null}
    </span>
  );
}

function chatName(chat: ChatItem, userId: string) {
  if (chat.isSaved) return t('Избранное');
  if (chat.title) return chat.title;
  return (
    chat.members
      .filter((member) => member.id !== userId)
      .map((member) => member.displayName)
      .join(', ') || 'Чат Trlka'
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
  return new Date(value).toLocaleTimeString(appLanguage(), { hour: '2-digit', minute: '2-digit' });
}

function formatProfileMemberSince(value: string) {
  const date = new Date(value);
  const language = appLanguage();
  const monthYear = new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric' });
  if (language !== 'ru') return t('В Trlka с {date}', { date: monthYear.format(date) });
  const month = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' })
    .formatToParts(date)
    .find((part) => part.type === 'month')?.value;
  const since = monthYear
    .formatToParts(date)
    .map((part) => (part.type === 'month' ? (month ?? part.value) : part.value))
    .join('');
  return `В TRLKA с ${since}`;
}

function formatMessageDate(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(date.toISOString(), today.toISOString())) return t('Сегодня');
  if (isSameDay(date.toISOString(), yesterday.toISOString())) return t('Вчера');
  return date.toLocaleDateString(appLanguage(), { day: 'numeric', month: 'long' });
}

function formatConversationTime(value: string) {
  const date = new Date(value);
  return isSameDay(date.toISOString(), new Date().toISOString())
    ? formatMessageTime(value)
    : date.toLocaleDateString(appLanguage(), { day: '2-digit', month: '2-digit' });
}

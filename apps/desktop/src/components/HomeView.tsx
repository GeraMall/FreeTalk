import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Clock3, DoorOpen, History, PhoneCall, ShieldCheck, Users } from 'lucide-react';
import { ROOM_MAX_PARTICIPANTS } from '@freetalk/config';
import { accountClient, ApiError, type AccountUser } from '../lib/api-client';
import { ChatSendPacer } from '@freetalk/protocol';
import { ChatRealtimeClient } from '../lib/chat-realtime';
import { clearChatImageCache, seedChatImageCache } from '../lib/chat-image-cache';
import { collectAccountMediaUrls, warmAccountMediaCache } from '../lib/account-media-cache';
import { dataUrlToBlob } from '../lib/profile';
import {
  ACCOUNT_SIDEBAR_MAX_WIDTH,
  ACCOUNT_SIDEBAR_MIN_WIDTH,
  useAccountSidebarWidth,
} from '../lib/account-sidebar-width';
import { generateRoomCode } from '../lib/room-code';
import type { UpdateStatus } from '../lib/updater';
import {
  activeCallRoomId,
  hasConversationParticipants,
  uniqueCallParticipants,
  type CallHistoryParticipant,
} from '../lib/call-history';
import mascot from '../assets/freetalk-mascot.png';
import { AccountSidebar, type AccountPage } from './AccountSidebar';
import { ChatsPage, type ChatItem, type MessageItem } from './ChatsPage';
import { FriendsPage, type BlockedItem, type FriendItem, type PendingItem } from './FriendsPage';
import { BrandLogo } from './BrandLogo';
import { MobileNavigation } from './MobileNavigation';
import { CachedMediaImage } from './CachedMedia';
import { useMobileLayout } from '../lib/mobile-layout';
import type { PresenceStatus } from '@freetalk/protocol';

const ACCOUNT_PAGES: AccountPage[] = ['home', 'friends', 'chats', 'history'];
const NAVIGATION_STATE_KEY = 'freetalkAccountPage';
function isAccountPage(value: unknown): value is AccountPage {
  return typeof value === 'string' && ACCOUNT_PAGES.includes(value as AccountPage);
}

export interface CallItem {
  id: string;
  room_id: string;
  started_at: string;
  duration_seconds: number;
  participants: CallHistoryParticipant[];
}

export interface HomeSidebarState {
  chats: ChatItem[];
  friends: Array<{
    id: string;
    displayName: string;
    avatarUrl?: string | null;
    presence?: PresenceStatus;
  }>;
  chatsLoading: boolean;
  openChat(chatId: string): Promise<void>;
  createGroup(title: string, memberIds: string[]): Promise<boolean>;
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
  onActiveChatChange,
  onSidebarStateChange,
  updateStatus,
  onInstallUpdate,
  embedded = false,
}: {
  user: AccountUser;
  busy: boolean;
  error: string;
  onCreateRoom(roomId?: string): void;
  onJoinRoom(code: string): void;
  onSettings(tab?: 'profile'): void;
  onLogout(): void;
  onClearError?(): void;
  page?: AccountPage;
  onPageChange?(page: AccountPage): void;
  onActiveChatChange?(chatId?: string): void;
  onSidebarStateChange?(state: HomeSidebarState): void;
  updateStatus?: UpdateStatus;
  onInstallUpdate?(): void;
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
  const [historyLoading, setHistoryLoading] = useState(true);
  const [localError, setLocalError] = useState('');
  const [chatSlowMode, setChatSlowMode] = useState<{ chatId: string; until: number }>();
  const chatSendPacerRef = useRef(new ChatSendPacer());
  const mobileLayout = useMobileLayout();
  const {
    width: accountSidebarWidth,
    startResize: startAccountSidebarResize,
    resize: resizeAccountSidebar,
    finishResize: finishAccountSidebarResize,
    resizeWithKeyboard: resizeAccountSidebarWithKeyboard,
    resetWidth: resetAccountSidebarWidth,
  } = useAccountSidebarWidth();
  const activeChatRef = useRef(activeChat);
  const navigationInitialized = useRef(false);
  const chatFriendOptions = useMemo(
    () =>
      friends.map((friend) => ({
        id: friend.id,
        displayName: friend.displayName ?? friend.display_name,
        avatarUrl: friend.avatarUrl,
        presence: friend.presence,
      })),
    [friends],
  );

  useEffect(() => {
    activeChatRef.current = activeChat;
  }, [activeChat]);

  useEffect(() => {
    onActiveChatChange?.(activeChat);
    return () => onActiveChatChange?.(undefined);
  }, [activeChat, onActiveChatChange]);

  useEffect(() => {
    if (!navigationInitialized.current) {
      if (!isAccountPage(window.history.state?.[NAVIGATION_STATE_KEY])) {
        window.history.replaceState({ ...window.history.state, [NAVIGATION_STATE_KEY]: page }, '');
      }
      navigationInitialized.current = true;
    }

    const handleHistoryNavigation = (event: PopStateEvent) => {
      const next = event.state?.[NAVIGATION_STATE_KEY];
      if (!isAccountPage(next)) return;
      if (next === 'friends') setFriendsLoading(true);
      if (next === 'chats') setChatsLoading(true);
      setInternalPage(next);
      onPageChange?.(next);
    };

    window.addEventListener('popstate', handleHistoryNavigation);
    return () => window.removeEventListener('popstate', handleHistoryNavigation);
  }, [onPageChange, page]);

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
      } else if (event.type === 'message-updated') {
        if (activeChatRef.current === event.chatId)
          setMessages((current) =>
            current.map((message) =>
              message.id === event.messageId
                ? { ...message, metadata: { ...message.metadata, ...event.metadata } }
                : message,
            ),
          );
      } else if (event.type === 'history-cleared') {
        if (activeChatRef.current === event.chatId) setMessages([]);
        setChats((current) =>
          current.map((chat) =>
            chat.id === event.chatId
              ? { ...chat, lastMessage: null, lastMessageAt: null, lastMessageKind: null }
              : chat,
          ),
        );
      } else if (event.type === 'chat-removed') {
        void clearChatImageCache(user.id);
        setChats((current) => current.filter((chat) => chat.id !== event.chatId));
        if (activeChatRef.current === event.chatId) {
          setActiveChat(undefined);
          setMessages([]);
        }
      } else if (event.type === 'retention-changed') {
        setChats((current) =>
          current.map((chat) =>
            chat.id === event.chatId ? { ...chat, retentionHours: event.retentionHours } : chat,
          ),
        );
      } else if (event.type === 'profile-updated') {
        setProfileRevision((revision) => revision + 1);
        void accountClient
          .request<{
            profile: { displayName: string; username: string; avatarUrl: string | null };
          }>(`/v1/users/${event.userId}/profile`)
          .then(async ({ profile }) => {
            await warmAccountMediaCache(user.id, collectAccountMediaUrls(profile), 4_000);
            setMessages((current) =>
              current.map((message) =>
                message.sender_id === event.userId
                  ? {
                      ...message,
                      display_name: profile.displayName,
                      username: profile.username,
                      avatar_url: profile.avatarUrl,
                    }
                  : message,
              ),
            );
            setHistory((current) =>
              current.map((call) => ({
                ...call,
                participants: call.participants.map((participant) =>
                  participant.userId === event.userId
                    ? {
                        ...participant,
                        displayName: profile.displayName,
                        avatarUrl: profile.avatarUrl,
                      }
                    : participant,
                ),
              })),
            );
          })
          .catch(() => {
            // Lists below still refresh; inaccessible profiles stay unchanged.
          });
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
      } else if (event.type === 'chat-updated') {
        setChats((current) =>
          current.map((chat) =>
            chat.id === event.chatId
              ? {
                  ...chat,
                  avatarUrl: event.avatarUrl,
                  avatarPositionX: event.avatarPositionX,
                  avatarPositionY: event.avatarPositionY,
                  avatarScale: event.avatarScale,
                }
              : chat,
          ),
        );
      } else if (event.type === 'presence-updated') {
        setFriends((current) =>
          current.map((friend) =>
            friend.id === event.userId ? { ...friend, presence: event.status } : friend,
          ),
        );
        setPending((current) =>
          current.map((friend) =>
            (friend.profile_id ?? friend.id) === event.userId
              ? { ...friend, presence: event.status }
              : friend,
          ),
        );
        setBlocked((current) =>
          current.map((friend) =>
            friend.id === event.userId ? { ...friend, presence: event.status } : friend,
          ),
        );
        setChats((current) =>
          current.map((chat) => ({
            ...chat,
            members: chat.members.map((member) =>
              member.id === event.userId ? { ...member, presence: event.status } : member,
            ),
          })),
        );
        setProfileRevision((revision) => revision + 1);
      }
    });
    realtime.start();
    return () => realtime.stop();
  }, [user.id]);

  const navigatePage = (next: AccountPage) => {
    if (next !== page) {
      window.history.pushState({ ...window.history.state, [NAVIGATION_STATE_KEY]: next }, '');
    }
    if (next === 'friends') setFriendsLoading(true);
    if (next === 'chats') setChatsLoading(true);
    setInternalPage(next);
    onPageChange?.(next);
  };

  const loadPage = useCallback(async (next: AccountPage) => {
    setLocalError('');
    setChatsLoading(true);
    if (next === 'friends') {
      setFriendsLoading(true);
      setFriendsLoadError('');
    }
    if (next === 'home' || next === 'history') setHistoryLoading(true);

    const sidebarRequest = Promise.all([
      accountClient.request<{ chats: ChatItem[] }>('/v1/chats'),
      accountClient.request<{
        friends: FriendItem[];
        pending: PendingItem[];
        blocked: BlockedItem[];
      }>('/v1/friends'),
    ]);
    const historyRequest =
      next === 'home' || next === 'history'
        ? accountClient.request<{ calls: CallItem[] }>('/v1/history')
        : undefined;
    const historyOutcome = historyRequest?.then(
      (result) => ({ result }) as const,
      (error: unknown) => ({ error }) as const,
    );

    try {
      const [chatResult, friendResult] = await sidebarRequest;
      setChats(chatResult.chats);
      setFriends(friendResult.friends);
      if (next === 'friends') {
        setPending(friendResult.pending);
        setBlocked(friendResult.blocked);
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Не удалось загрузить чаты';
      if (next === 'friends') setFriendsLoadError(message);
      else setLocalError(message);
    } finally {
      setChatsLoading(false);
    }

    if (historyOutcome) {
      const outcome = await historyOutcome;
      if ('result' in outcome) {
        setHistory(
          outcome.result.calls.filter((call) => hasConversationParticipants(call.participants)),
        );
      } else {
        setLocalError(outcome.error instanceof Error ? outcome.error.message : 'Ошибка загрузки');
      }
    }
    if (next === 'friends') setFriendsLoading(false);
    if (next === 'home' || next === 'history') setHistoryLoading(false);
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

  const openChat = useCallback(
    async (chatId: string) => {
      setActiveChat(chatId);
      setChats((current) =>
        current.map((chat) => (chat.id === chatId ? { ...chat, unreadCount: 0 } : chat)),
      );
      setMessages([]);
      await loadChatMessages(chatId);
    },
    [loadChatMessages],
  );

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
    const pacing = chatSendPacerRef.current.check(activeChat);
    if (pacing.limited) {
      setChatSlowMode({ chatId: activeChat, until: pacing.blockedUntil });
      return false;
    }
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
      if (caught instanceof ApiError && caught.code === 'CHAT_SLOW_MODE') {
        const retryAfter = Number(caught.details.retryAfterSeconds);
        setChatSlowMode({
          chatId: activeChat,
          until: Date.now() + (Number.isFinite(retryAfter) ? Math.max(1, retryAfter) : 30) * 1_000,
        });
        return false;
      }
      setLocalError(caught instanceof Error ? caught.message : 'Не удалось отправить сообщение');
      return false;
    }
  };

  const sendImage = async (dataUrl: string, caption: string, thumbnailDataUrl: string) => {
    if (!activeChat) return false;
    const pacing = chatSendPacerRef.current.check(activeChat);
    if (pacing.limited) {
      setChatSlowMode({ chatId: activeChat, until: pacing.blockedUntil });
      return false;
    }
    try {
      const result = await accountClient.uploadChatImage<MessageItem>(
        activeChat,
        dataUrl,
        caption,
        thumbnailDataUrl,
      );
      seedChatImageCache(
        user.id,
        result.message.id,
        'full',
        dataUrlToBlob(dataUrl),
        result.message.expires_at,
      );
      seedChatImageCache(
        user.id,
        result.message.id,
        'thumbnail',
        dataUrlToBlob(thumbnailDataUrl),
        result.message.expires_at,
      );
      setMessages((current) => appendMessage(current, result.message));
      setChats((current) => promoteChat(current, activeChat, result.message));
      setSentMessageVersion((version) => version + 1);
      return true;
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'CHAT_SLOW_MODE') {
        const retryAfter = Number(caught.details.retryAfterSeconds);
        setChatSlowMode({
          chatId: activeChat,
          until: Date.now() + (Number.isFinite(retryAfter) ? Math.max(1, retryAfter) : 30) * 1_000,
        });
        return false;
      }
      setLocalError(caught instanceof Error ? caught.message : 'Не удалось отправить фотографию');
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

  const startDirectCall = async (friendId: string) => {
    try {
      const result = await accountClient.request<{ chat: { id: string } }>('/v1/chats', {
        method: 'POST',
        body: JSON.stringify({ type: 'direct', memberIds: [friendId] }),
      });
      const roomId = generateRoomCode();
      await accountClient.request(`/v1/chats/${result.chat.id}/calls`, {
        method: 'POST',
        body: JSON.stringify({ roomId }),
      });
      onCreateRoom(roomId);
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Не удалось начать звонок');
    }
  };

  const createGroup = useCallback(
    async (title: string, memberIds: string[]) => {
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
    },
    [loadPage],
  );

  useEffect(() => {
    onSidebarStateChange?.({
      chats,
      friends: chatFriendOptions,
      chatsLoading,
      openChat,
      createGroup,
    });
  }, [chatFriendOptions, chats, chatsLoading, createGroup, onSidebarStateChange, openChat]);

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

  const updateGroupAvatar = async (
    chatId: string,
    dataUrl: string | undefined,
    positionX: number,
    positionY: number,
    scale: number,
  ) => {
    try {
      const result = await accountClient.updateGroupAvatar(
        chatId,
        dataUrl,
        positionX,
        positionY,
        scale,
      );
      await warmAccountMediaCache(user.id, collectAccountMediaUrls(result), 4_000);
      setChats((current) =>
        current.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                avatarUrl: result.avatarUrl,
                avatarPositionX: result.avatarPositionX,
                avatarPositionY: result.avatarPositionY,
                avatarScale: result.avatarScale,
              }
            : chat,
        ),
      );
      setLocalError('Аватар группы сохранён');
      return true;
    } catch (caught) {
      setLocalError(
        caught instanceof Error ? caught.message : 'Не удалось сохранить аватар группы',
      );
      return false;
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
    const existingRoomId = activeCallRoomId(messages);
    if (existingRoomId) {
      onJoinRoom(existingRoomId);
      return;
    }
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
      await clearChatImageCache(user.id);
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
    await clearChatImageCache(user.id);
    setActiveChat(undefined);
    setMessages([]);
    await loadPage('chats');
    setLocalError('Пользователь заблокирован');
  };

  const removeChatLocally = (chatId: string) => {
    setChats((current) => current.filter((chat) => chat.id !== chatId));
    if (activeChatRef.current !== chatId) return;
    setActiveChat(undefined);
    setMessages([]);
  };

  const leaveGroup = async (chatId = activeChat) => {
    if (!chatId) return;
    const chat = chats.find((item) => item.id === chatId);
    if (chat?.type !== 'group') throw new Error('Личный чат нельзя покинуть');
    await accountClient.request(`/v1/chats/${chatId}/members/me`, { method: 'DELETE' });
    await clearChatImageCache(user.id);
    removeChatLocally(chatId);
    setLocalError('Вы покинули группу');
  };

  const deleteDirectChat = async () => {
    if (!activeChat) return;
    const chat = chats.find((item) => item.id === activeChat);
    if (chat?.type !== 'direct') return;
    await accountClient.request(`/v1/chats/${activeChat}`, { method: 'DELETE' });
    await clearChatImageCache(user.id);
    removeChatLocally(activeChat);
    setLocalError('Личный чат удалён у обоих');
  };

  return (
    <main
      className={`${embedded ? 'account-view-embedded' : 'account-shell account-shell-with-chat-sidebar'} ${
        page === 'home' ? 'account-home-shell' : ''
      }${mobileLayout ? ' mobile-account-shell' : ''}${page === 'chats' && activeChat ? ' mobile-chat-open' : ''}`}
      style={
        embedded
          ? undefined
          : ({ '--account-sidebar-width': `${accountSidebarWidth}px` } as CSSProperties)
      }
    >
      {!embedded && !mobileLayout && (
        <AccountSidebar
          user={user}
          activePage={page}
          readingChatId={activeChat}
          chats={chats}
          friends={chatFriendOptions}
          chatsLoading={chatsLoading}
          updateStatus={updateStatus}
          onNavigate={(next) => next !== 'room' && navigatePage(next)}
          onOpenChat={openChat}
          onCreateGroup={createGroup}
          onLeaveGroup={leaveGroup}
          onInstallUpdate={onInstallUpdate}
          onSettings={onSettings}
          onLogout={onLogout}
        />
      )}
      {!embedded && !mobileLayout ? (
        <div
          className="account-sidebar-resizer"
          role="separator"
          aria-label="Изменить ширину боковой панели"
          aria-orientation="vertical"
          aria-valuemin={ACCOUNT_SIDEBAR_MIN_WIDTH}
          aria-valuemax={ACCOUNT_SIDEBAR_MAX_WIDTH}
          aria-valuenow={Math.round(accountSidebarWidth)}
          title="Потяните для изменения ширины. Двойной щелчок — размер по умолчанию"
          tabIndex={0}
          onDoubleClick={resetAccountSidebarWidth}
          onPointerDown={startAccountSidebarResize}
          onPointerMove={resizeAccountSidebar}
          onPointerUp={finishAccountSidebarResize}
          onPointerCancel={finishAccountSidebarResize}
          onKeyDown={resizeAccountSidebarWithKeyboard}
        />
      ) : null}
      {!embedded && mobileLayout && !(page === 'chats' && activeChat) ? (
        <header className="mobile-app-header">
          <BrandLogo variant="compact" />
          <button type="button" aria-label="Открыть профиль" onClick={() => onSettings('profile')}>
            {user.avatarUrl ? (
              <CachedMediaImage src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
            ) : (
              user.displayName.slice(0, 1).toUpperCase()
            )}
          </button>
        </header>
      ) : null}
      <section
        className={`account-content page-enter ${page === 'chats' ? 'account-content-chat' : ''}`}
      >
        <TransientNotice
          message={error || localError}
          tone={!error && localError === 'Аватар группы сохранён' ? 'success' : 'error'}
          onDismiss={() => {
            setLocalError('');
            onClearError?.();
          }}
        />
        {page === 'home' && (
          <div className="home-dashboard">
            <section className="home-hero">
              <img className="home-hero-watermark" src={mascot} alt="" aria-hidden="true" />
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
                <Users size={17} /> До {ROOM_MAX_PARTICIPANTS} участников
              </span>
              <span>
                <ShieldCheck size={17} /> Приватный WebRTC
              </span>
              <span>
                <Clock3 size={17} /> Без записи разговоров
              </span>
            </div>
            <RecentRooms
              calls={history}
              selfId={user.id}
              loading={historyLoading}
              onCreateAgain={() => onCreateRoom()}
            />
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
            onCall={startDirectCall}
            onOpenChat={async (chatId) => {
              navigatePage('chats');
              await openChat(chatId);
            }}
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
            externalSidebar={!mobileLayout}
            mobile={mobileLayout}
            userId={user.id}
            chats={chats}
            friends={chatFriendOptions}
            activeChatId={activeChat}
            messages={messages}
            chatsLoading={chatsLoading}
            messagesLoading={messagesLoading}
            messagesError={messagesError}
            sentMessageVersion={sentMessageVersion}
            hasMoreMessages={hasMoreMessages}
            profileRevision={profileRevision}
            slowModeUntil={
              chatSlowMode && chatSlowMode.chatId === activeChat ? chatSlowMode.until : undefined
            }
            onOpenChat={openChat}
            onCloseChat={() => {
              setActiveChat(undefined);
              setMessages([]);
            }}
            onRetryMessages={() => activeChat && void loadChatMessages(activeChat)}
            onLoadOlder={loadOlderMessages}
            onSendMessage={sendMessage}
            onSendImage={sendImage}
            onCreateGroup={createGroup}
            onJoinInvite={joinInvite}
            onStartCall={startChatCall}
            onCreateInvite={createInvite}
            onUpdateGroupAvatar={updateGroupAvatar}
            onUpdateRetention={updateChatRetention}
            onClearHistory={clearChatHistory}
            onBlockUser={blockChatUser}
            onDeleteDirectChat={deleteDirectChat}
            onLeaveGroup={() => leaveGroup()}
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
                      <HistoryCallCard call={call} key={call.id} onCallAgain={onCreateRoom} />
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
      {!embedded && mobileLayout && !(page === 'chats' && activeChat) ? (
        <MobileNavigation activePage={page} onNavigate={navigatePage} />
      ) : null}
    </main>
  );
}

function HistoryCallCard({ call, onCallAgain }: { call: CallItem; onCallAgain(): void }) {
  const participants = uniqueCallParticipants(call.participants);
  const visibleParticipants = participants.slice(0, 4);
  const hiddenCount = Math.max(0, participants.length - visibleParticipants.length);
  return (
    <article className="social-card history-call-card">
      <span className="history-participant-avatars" aria-hidden="true">
        {visibleParticipants.map((participant, index) => (
          <span key={participant.userId ?? `${participant.displayName}-${index}`}>
            {participant.avatarUrl ? (
              <CachedMediaImage src={participant.avatarUrl} alt="" referrerPolicy="no-referrer" />
            ) : (
              participant.displayName.slice(0, 1).toUpperCase()
            )}
          </span>
        ))}
        {hiddenCount > 0 && <span className="history-avatar-overflow">+{hiddenCount}</span>}
      </span>
      <span className="history-call-copy">
        <strong>{new Date(call.started_at).toLocaleString('ru-RU')}</strong>
        <small>
          {participants.length
            ? participants.map((participant) => participant.displayName).join(', ')
            : 'Участники не указаны'}{' '}
          · {Math.max(1, Math.round(call.duration_seconds / 60))} мин
        </small>
      </span>
      <button
        className="history-call-again-button"
        title="Создать новую комнату"
        onClick={onCallAgain}
      >
        <PhoneCall size={16} aria-hidden="true" />
        Позвонить снова
      </button>
    </article>
  );
}

export function RecentRooms({
  calls,
  selfId,
  loading,
  onCreateAgain,
}: {
  calls: CallItem[];
  selfId: string;
  loading: boolean;
  onCreateAgain(): void;
}) {
  const recent = calls
    .filter((call) => hasConversationParticipants(call.participants))
    .sort((left, right) => Date.parse(right.started_at) - Date.parse(left.started_at))
    .slice(0, 4);
  return (
    <section className="recent-rooms" aria-labelledby="recent-rooms-title" aria-busy={loading}>
      <header>
        <div>
          <p>ВАШИ ЗВОНКИ</p>
          <h2 id="recent-rooms-title">Недавние комнаты</h2>
        </div>
        <span>Последние {Math.min(4, recent.length) || '—'}</span>
      </header>
      {loading ? (
        <div className="recent-room-grid recent-room-loading" aria-label="Загружаем историю">
          <i />
          <i />
        </div>
      ) : recent.length ? (
        <div className="recent-room-grid">
          {recent.map((call, index) => {
            const participants = uniqueCallParticipants(call.participants);
            const others = participants.filter((participant) => participant.userId !== selfId);
            const title = others.length
              ? others.length === 1
                ? `Комната с ${others[0].displayName}`
                : `Групповой звонок · ${others.length + 1}`
              : 'Приватная комната';
            return (
              <article
                className="recent-room-card"
                style={{ '--recent-index': index } as CSSProperties}
                key={call.id}
              >
                <span className="recent-room-avatars" aria-hidden="true">
                  {(others.length ? others : participants)
                    .slice(0, 3)
                    .map((participant, participantIndex) => (
                      <i
                        key={participant.userId ?? `${participant.displayName}-${participantIndex}`}
                      >
                        {participant.avatarUrl ? (
                          <CachedMediaImage
                            src={participant.avatarUrl}
                            alt=""
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          participant.displayName.slice(0, 1).toUpperCase()
                        )}
                      </i>
                    ))}
                  {!participants.length && <PhoneCall />}
                </span>
                <span className="recent-room-copy">
                  <strong>{title}</strong>
                  <small>
                    {formatRecentDate(call.started_at)} ·{' '}
                    {formatCallDuration(call.duration_seconds)}
                  </small>
                </span>
                <button onClick={onCreateAgain}>
                  <PhoneCall size={15} /> Создать снова
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="recent-rooms-empty">
          <span>
            <History size={20} />
          </span>
          <div>
            <strong>Недавних комнат пока нет</strong>
            <p>Создайте первую комнату — она появится здесь.</p>
          </div>
        </div>
      )}
    </section>
  );
}

export function TransientNotice({
  message,
  tone = 'error',
  onDismiss,
}: {
  message: string;
  tone?: 'success' | 'error';
  onDismiss(): void;
}) {
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
    <div
      className={`home-transient-notice ${tone} ${closing ? 'closing' : ''}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
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
      lastMessage: message.kind === 'image' ? message.body || 'Фотография' : message.body,
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

function formatRecentDate(startedAt: string) {
  const date = new Date(startedAt);
  const period = historyPeriod(startedAt);
  if (period === 'Сегодня' || period === 'Вчера')
    return `${period}, ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

function formatCallDuration(seconds: number) {
  if (seconds < 60) return 'меньше минуты';
  return `${Math.max(1, Math.round(seconds / 60))} мин`;
}

import { formatChatCallLabel, t } from '../lib/app-language';
import { SERVICE_CHAT_ID } from '@freetalk/config';
import { ServiceBotAvatar } from './ServiceBotAvatar';
import {
  ChevronLeft,
  Archive,
  ArrowLeft,
  Bookmark,
  Pin,
  BellOff,
  ChevronRight,
  Circle,
  Download,
  DoorOpen,
  Edit3,
  EyeOff,
  History,
  LockKeyhole,
  LogOut,
  MessageCircle,
  MinusCircle,
  Moon,
  PhoneCall,
  Plus,
  Search,
  Settings,
  Store,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AccountUser } from '../lib/api-client';
import type { UpdateStatus } from '../lib/updater';
import { compactVersionLabel } from '../lib/version-label';
import type { PresenceStatus } from '@freetalk/protocol';
import { ChatRealtimeClient } from '../lib/chat-realtime';
import { selfPresence } from '../lib/self-presence';
import {
  appIsInForeground,
  listenForNotificationOpen,
  showChatNotificationOverlay,
} from '../lib/chat-notification-overlay';
import {
  getPresenceMode,
  presenceModeLabel,
  setPresenceMode,
  type PresenceMode,
} from '../lib/presence-preference';
import { BrandLogo } from './BrandLogo';
import { useCachedMediaUrl } from '../lib/use-cached-media';
import { avatarImageStyle } from '../lib/avatar-image-style';
import { CachedMediaImage } from './CachedMedia';
import { ChatActionConfirmDialog } from './ChatActionConfirmDialog';
import { CreateGroupDialog } from './CreateGroupDialog';
import { PresenceBadge } from './PresenceBadge';
import type { ChatNotificationPreview } from './ChatNotificationStack';
import type { ChatItem } from './ChatsPage';
import { UserProfileDialog, type UserProfileTarget } from './UserProfileDialog';
import { playNotificationSound } from '../lib/notification-sounds';
import { loadSettings } from '../lib/settings';
import { CallDock, ProfileAudioControls, type CallDockState } from './CallDock';
import { ChatArchiveMenu, type ChatArchiveMenuTarget } from './ChatArchiveMenu';

export type AccountPage = 'home' | 'friends' | 'chats' | 'store' | 'history';
export type AccountDestination = AccountPage | 'room';

export function AccountSidebar({
  user,
  activePage,
  roomActive = false,
  readingChatId,
  chats,
  friends = [],
  chatsLoading = false,
  updateStatus,
  onNavigate,
  onOpenChat,
  onOpenSavedChat,
  onArchiveChat,
  onManageChat,
  onCreateGroup,
  onLeaveGroup,
  onInstallUpdate,
  onSettings,
  onLogout,
  callDock,
}: {
  user: AccountUser;
  activePage: AccountDestination;
  roomActive?: boolean;
  readingChatId?: string;
  chats?: ChatItem[];
  friends?: Array<{
    id: string;
    displayName: string;
    avatarUrl?: string | null;
    presence?: PresenceStatus;
  }>;
  chatsLoading?: boolean;
  updateStatus?: UpdateStatus;
  onNavigate(page: AccountDestination): void;
  onOpenChat?(chatId: string): Promise<void> | void;
  onOpenSavedChat?(): Promise<void> | void;
  onArchiveChat?(chatId: string, archived: boolean): Promise<void> | void;
  onManageChat?(chatId: string, action: 'mute' | 'pin' | 'delete' | 'block'): Promise<void> | void;
  onCreateGroup?(title: string, memberIds: string[]): Promise<boolean>;
  onLeaveGroup?(chatId: string): Promise<void>;
  onInstallUpdate?(): void;
  onSettings(tab?: 'profile'): void;
  onLogout(): void;
  callDock?: CallDockState;
}) {
  const [presence, setPresence] = useState<PresenceStatus>(() => selfPresence.get(user.id));
  const [menuOpen, setMenuOpen] = useState(false);
  const [presenceMode, setLocalPresenceMode] = useState(getPresenceMode);
  const [unreadByChat, setUnreadByChat] = useState<Record<string, number>>({});
  const [chatSearch, setChatSearch] = useState('');
  const [groupFormOpen, setGroupFormOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [archiveMenu, setArchiveMenu] = useState<ChatArchiveMenuTarget>();
  const [chatAction, setChatAction] = useState<{
    target: ChatArchiveMenuTarget;
    action: 'delete' | 'block';
  }>();
  const [chatActionBusy, setChatActionBusy] = useState(false);
  const [chatActionError, setChatActionError] = useState('');
  const latestChats = useRef(chats);
  latestChats.current = chats;
  const [leaveTarget, setLeaveTarget] = useState<ChatItem>();
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leaveError, setLeaveError] = useState('');
  const [fullProfileTarget, setFullProfileTarget] = useState<UserProfileTarget>();
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const statusPickerRef = useRef<HTMLDivElement>(null);
  const activePageRef = useRef(activePage);
  const readingChatIdRef = useRef(readingChatId);
  const previewSequence = useRef(0);
  const cachedCoverUrl = useCachedMediaUrl(user.coverUrl);

  useEffect(() => {
    activePageRef.current = activePage;
    readingChatIdRef.current = readingChatId;
  }, [activePage, readingChatId]);

  useEffect(() => {
    const realtime = new ChatRealtimeClient((event) => {
      if (event.type !== 'message-created') return;
      const serviceNotice = event.chatId === SERVICE_CHAT_ID && event.message.kind === 'system';
      if (
        !serviceNotice &&
        (!['text', 'image', 'file'].includes(event.message.kind) ||
          !event.message.sender_id ||
          event.message.sender_id === user.id)
      )
        return;
      if (
        appIsInForeground() &&
        activePageRef.current === 'chats' &&
        readingChatIdRef.current === event.chatId
      )
        return;

      setUnreadByChat((current) => ({
        ...current,
        [event.chatId]: Math.min(99, (current[event.chatId] ?? 0) + 1),
      }));

      const preference = latestChats.current?.find((chat) => chat.id === event.chatId);
      if (getPresenceMode() === 'dnd' || preference?.archived || preference?.muted) return;
      const senderName = serviceNotice
        ? 'TRLKA'
        : event.message.display_name || event.message.username || 'Новое сообщение';
      const previewBody =
        event.message.kind === 'image'
          ? event.message.body || 'Фотография'
          : event.message.kind === 'file'
            ? event.message.body || String(event.message.metadata?.filename || 'Файл')
            : event.message.body;
      const preview: ChatNotificationPreview = {
        sequence: ++previewSequence.current,
        chatId: event.chatId,
        senderName,
        avatarUrl: event.message.avatar_url,
        body: previewBody,
      };
      void playNotificationSound(loadSettings());
      if (!appIsInForeground()) void showChatNotificationOverlay(preview);
    }, setPresence);
    realtime.start();
    return () => realtime.stop();
  }, [user.id]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenForNotificationOpen((chatId) => {
      setUnreadByChat((current) => {
        if (!current[chatId]) return current;
        const next = { ...current };
        delete next[chatId];
        return next;
      });
      onNavigate('chats');
    }).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [onNavigate]);

  useEffect(() => {
    if (!readingChatId) return;
    setUnreadByChat((current) => {
      if (!current[readingChatId]) return current;
      const next = { ...current };
      delete next[readingChatId];
      return next;
    });
  }, [readingChatId]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!profileMenuRef.current?.contains(target)) {
        setMenuOpen(false);
        return;
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('pointerdown', closeOnOutsideClick);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsideClick);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  const choosePresence = (mode: PresenceMode) => {
    setPresenceMode(mode);
    setLocalPresenceMode(mode);
  };

  const inlinePresence = getInlinePresence(presenceMode, presence);
  const unreadChatCount = useMemo(() => {
    if (!chats) {
      return Math.min(
        99,
        Object.values(unreadByChat).reduce((total, count) => total + count, 0),
      );
    }
    const listedChatIds = new Set(chats.map((chat) => chat.id));
    const listedTotal = chats.reduce(
      (total, chat) => total + Math.max(chat.unreadCount ?? 0, unreadByChat[chat.id] ?? 0),
      0,
    );
    const pendingTotal = Object.entries(unreadByChat).reduce(
      (total, [chatId, count]) => total + (listedChatIds.has(chatId) ? 0 : count),
      0,
    );
    return Math.min(99, listedTotal + pendingTotal);
  }, [chats, unreadByChat]);
  const deferredChatSearch = useDeferredValue(chatSearch);
  const sidebarChats = useMemo(() => {
    const query = deferredChatSearch.trim().toLocaleLowerCase('ru-RU');
    return (chats ?? [])
      .filter(
        (chat) =>
          !chat.isSaved &&
          Boolean(chat.archived) === showArchived &&
          (!query || sidebarChatName(chat, user.id).toLocaleLowerCase('ru-RU').includes(query)),
      )
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
  }, [chats, deferredChatSearch, user.id, showArchived]);
  const savedChat = chats?.find((chat) => chat.isSaved);
  const chatNavigationEnabled = chats !== undefined && Boolean(onOpenChat && onCreateGroup);
  const updateVersion =
    updateStatus?.kind === 'available' || updateStatus?.kind === 'downloading'
      ? updateStatus.version
      : undefined;

  return (
    <aside
      className={`account-sidebar${chatNavigationEnabled ? ' account-sidebar-with-chats' : ''}${menuOpen ? ' account-sidebar-profile-open' : ''}`}
    >
      {chatNavigationEnabled ? (
        <>
          <div className="account-sidebar-brand-search">
            <BrandLogo variant="compact" />
            <label className="account-chat-search">
              <Search aria-hidden="true" />
              <span className="sr-only">{t('Поиск по чатам')}</span>
              <input
                value={chatSearch}
                placeholder={t('Поиск по чатам')}
                onChange={(event) => setChatSearch(event.target.value)}
              />
              {chatSearch ? (
                <button
                  type="button"
                  aria-label={t('Очистить поиск')}
                  onClick={() => setChatSearch('')}
                >
                  <X />
                </button>
              ) : null}
            </label>
          </div>
        </>
      ) : (
        <BrandLogo variant="compact" />
      )}

      {chatNavigationEnabled && roomActive ? (
        <nav className="account-sidebar-call-navigation">
          <Nav
            active={activePage === 'room'}
            icon={<PhoneCall />}
            label={t('Текущий звонок')}
            live
            onClick={() => onNavigate('room')}
          />
        </nav>
      ) : null}
      {chatNavigationEnabled && updateVersion ? (
        <button
          type="button"
          className="account-sidebar-update"
          disabled={updateStatus?.kind === 'downloading'}
          onClick={onInstallUpdate}
        >
          <Download aria-hidden="true" />
          <span>
            {updateStatus?.kind === 'downloading'
              ? t('Загрузка {p0}%', { p0: Math.round(updateStatus.progress) })
              : t('Обновиться до версии {p0}', { p0: compactVersionLabel(updateVersion) })}
          </span>
        </button>
      ) : null}

      <nav>
        {roomActive && !chatNavigationEnabled && (
          <Nav
            active={activePage === 'room'}
            icon={<PhoneCall />}
            label={t('Текущий звонок')}
            live
            onClick={() => onNavigate('room')}
          />
        )}
        <Nav
          active={activePage === 'home'}
          icon={<DoorOpen />}
          label={t('Главная')}
          clickMotion
          onClick={() => onNavigate('home')}
        />
        <Nav
          active={activePage === 'friends'}
          icon={<Users />}
          label={t('Друзья')}
          clickMotion
          onClick={() => onNavigate('friends')}
        />
        {!chatNavigationEnabled && (
          <Nav
            active={activePage === 'chats'}
            icon={<MessageCircle />}
            label={t('Чаты')}
            unread={unreadChatCount}
            onClick={() => onNavigate('chats')}
          />
        )}
        <Nav
          active={activePage === 'store'}
          icon={user.canAccessStore ? <Store /> : <LockKeyhole />}
          label={t('Магазин')}
          clickMotion
          onClick={() => onNavigate('store')}
        />
        <Nav
          active={activePage === 'history'}
          icon={<History />}
          label={t('История')}
          clickMotion
          onClick={() => onNavigate('history')}
        />
      </nav>
      {chatNavigationEnabled ? (
        <section className="account-sidebar-chats" aria-label={t('Чаты и группы')}>
          <header>
            <span className="account-sidebar-chat-heading">
              <span>{showArchived ? t('Архив') : t('Чаты и группы')}</span>
              {unreadChatCount > 0 ? <b>{unreadChatCount > 99 ? '99+' : unreadChatCount}</b> : null}
            </span>
            <div className="account-sidebar-collection-actions">
              <button
                type="button"
                className="account-sidebar-chat-add"
                data-tooltip={showArchived ? t('Вернуться к чатам') : t('Архив')}
                aria-label={showArchived ? t('Вернуться к чатам') : t('Архив')}
                aria-pressed={showArchived}
                onClick={() => {
                  setShowArchived((current) => !current);
                  setArchiveMenu(undefined);
                }}
              >
                {showArchived ? <ArrowLeft aria-hidden="true" /> : <Archive aria-hidden="true" />}
              </button>
              <button
                type="button"
                className="account-sidebar-chat-add"
                data-tooltip={t('Избранное')}
                aria-label={t('Избранное')}
                aria-pressed={Boolean(savedChat && savedChat.id === readingChatId)}
                onClick={() => {
                  setShowArchived(false);
                  void onOpenSavedChat?.();
                }}
              >
                <Bookmark aria-hidden="true" />
              </button>
              <button
                type="button"
                className="account-sidebar-chat-add"
                aria-label={t('Создать групповой чат')}
                aria-expanded={groupFormOpen}
                onClick={() => setGroupFormOpen(true)}
              >
                <Plus aria-hidden="true" />
              </button>
            </div>
          </header>
          <div className="account-sidebar-chat-list">
            {chatsLoading && (chats?.length ?? 0) === 0 ? (
              <div className="account-sidebar-chat-state">{t('Загружаем чаты…')}</div>
            ) : sidebarChats.length > 0 ? (
              sidebarChats.map((chat) => {
                const name = sidebarChatName(chat, user.id);
                const other = chat.members.find((member) => member.id !== user.id);
                const unread = Math.max(chat.unreadCount ?? 0, unreadByChat[chat.id] ?? 0);
                return (
                  <div
                    className={`account-sidebar-chat-row${chat.type === 'group' && onLeaveGroup ? ' has-leave-action' : ''}`}
                    key={chat.id}
                  >
                    <button
                      type="button"
                      className={`account-sidebar-chat-open${chat.id === readingChatId ? ' active' : ''}`}
                      aria-current={chat.id === readingChatId ? 'true' : undefined}
                      aria-label={
                        unread > 0
                          ? t('{p0}, непрочитанных сообщений: {p1}', { p0: name, p1: unread })
                          : name
                      }
                      onClick={() => {
                        onNavigate('chats');
                        void onOpenChat?.(chat.id);
                      }}
                      onContextMenu={(event) => {
                        if (!onArchiveChat || chat.id === SERVICE_CHAT_ID) return;
                        event.preventDefault();
                        setArchiveMenu({
                          chatId: chat.id,
                          name,
                          archived: Boolean(chat.archived),
                          muted: chat.muted,
                          pinned: chat.pinned,
                          group: chat.type === 'group',
                          x: event.clientX,
                          y: event.clientY,
                          trigger: event.currentTarget,
                        });
                      }}
                      onKeyDown={(event) => {
                        if (
                          !onArchiveChat ||
                          chat.id === SERVICE_CHAT_ID ||
                          !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
                        )
                          return;
                        event.preventDefault();
                        const bounds = event.currentTarget.getBoundingClientRect();
                        setArchiveMenu({
                          chatId: chat.id,
                          name,
                          archived: Boolean(chat.archived),
                          muted: chat.muted,
                          pinned: chat.pinned,
                          group: chat.type === 'group',
                          x: bounds.left,
                          y: bounds.bottom,
                          trigger: event.currentTarget,
                        });
                      }}
                    >
                      <SidebarAvatar
                        service={chat.id === SERVICE_CHAT_ID}
                        name={name}
                        avatarUrl={chat.type === 'group' ? chat.avatarUrl : other?.avatarUrl}
                        group={chat.type === 'group'}
                        activeCall={chat.hasActiveGroupCall}
                        presence={chat.type === 'direct' ? other?.presence : undefined}
                        positionX={chat.avatarPositionX}
                        positionY={chat.avatarPositionY}
                        scale={chat.avatarScale}
                      />
                      <span>
                        <strong>
                          {name}
                          {chat.pinned && <Pin size={11} className="sidebar-preference-icon" />}
                          {chat.muted && <BellOff size={11} className="sidebar-preference-icon" />}
                        </strong>
                        <small>
                          {(chat.lastMessage &&
                            formatChatCallLabel(chat.lastMessageKind, chat.lastMessage)) ||
                            (chat.type === 'group'
                              ? t('{count} участников', { count: chat.members.length })
                              : other?.presence === 'online'
                                ? 'В сети'
                                : t('Личный чат'))}
                        </small>
                      </span>
                      {unread > 0 ? <b>{unread > 99 ? '99+' : unread}</b> : null}
                    </button>
                    {chat.type === 'group' && onLeaveGroup ? (
                      <button
                        type="button"
                        className="account-sidebar-chat-leave"
                        aria-label={t('Покинуть группу {p0}', { p0: name })}
                        onClick={() => {
                          setLeaveError('');
                          setLeaveTarget(chat);
                        }}
                      >
                        <X aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <div className="account-sidebar-chat-state">
                {deferredChatSearch.trim()
                  ? t('Ничего не найдено')
                  : showArchived
                    ? t('Архив пуст')
                    : t('Чатов пока нет')}
              </div>
            )}
          </div>
        </section>
      ) : null}
      <div
        className={`account-profile-menu-anchor${callDock?.active ? ' has-active-call' : ''}`}
        ref={profileMenuRef}
      >
        {callDock && <CallDock state={callDock} />}
        {menuOpen && (
          <div className="account-profile-popover" role="dialog" aria-label={t('Профиль и статус')}>
            <div
              className={`profile-popover-cover${cachedCoverUrl ? ' has-cover' : ''}`}
              style={cachedCoverUrl ? { backgroundImage: `url(${cachedCoverUrl})` } : undefined}
            >
              <button
                type="button"
                className="profile-popover-avatar-trigger"
                aria-label={t('Открыть полный профиль')}
                onClick={() =>
                  setFullProfileTarget({
                    id: user.id,
                    displayName: user.displayName,
                    username: user.username,
                    avatarUrl: user.avatarUrl,
                    presence,
                  })
                }
              >
                <ProfileAvatar user={user} large />
              </button>
            </div>
            <div className="profile-popover-identity">
              <span>
                <strong>{user.displayName}</strong>
                <small className="profile-inline-identity">
                  @{user.username}
                  <i aria-hidden="true">•</i>
                  <span className={`profile-inline-presence ${inlinePresence.tone}`}>
                    {t(inlinePresence.label)}
                  </span>
                </small>
              </span>
              <p>{user.bio || t('Расскажите немного о себе в настройках профиля.')}</p>
            </div>
            <button
              type="button"
              className="profile-popover-action profile-edit-action"
              onClick={() => {
                setMenuOpen(false);
                onSettings('profile');
              }}
            >
              <Edit3 size={16} />
              <span>
                <strong>{t('Редактировать профиль')}</strong>
                <small>{t('Имя, аватар и информация о себе')}</small>
              </span>
            </button>
            <div className="profile-presence-picker" ref={statusPickerRef}>
              <button
                type="button"
                className="profile-status-arrow"
                aria-label={t('Предыдущий статус')}
                onClick={() => {
                  const modes: PresenceMode[] = ['auto', 'away', 'dnd', 'invisible'];
                  choosePresence(
                    modes[(modes.indexOf(presenceMode) + modes.length - 1) % modes.length],
                  );
                }}
              >
                <ChevronLeft size={17} />
              </button>
              <span className="profile-status-current" aria-live="polite">
                <PresenceModeIcon mode={presenceMode} />
                <span>
                  <strong>{presenceModeLabel(presenceMode)}</strong>
                  <small>{t(presenceModeDescription(presenceMode))}</small>
                </span>
              </span>
              <button
                type="button"
                className="profile-status-arrow"
                aria-label={t('Следующий статус')}
                onClick={() => {
                  const modes: PresenceMode[] = ['auto', 'away', 'dnd', 'invisible'];
                  choosePresence(modes[(modes.indexOf(presenceMode) + 1) % modes.length]);
                }}
              >
                <ChevronRight size={17} />
              </button>
            </div>
            <button type="button" className="profile-popover-logout" onClick={onLogout}>
              <LogOut size={16} />
              {t('Выйти из аккаунта')}
            </button>
          </div>
        )}
        <div
          className={`account-profile-mini${callDock ? ' with-audio-controls' : ''}`}
          onClickCapture={(event) => {
            if ((event.target as Element).closest('.profile-audio-controls')) {
              setMenuOpen(false);
            }
          }}
        >
          <button
            type="button"
            className="account-profile-avatar-trigger"
            aria-label={menuOpen ? t('Закрыть свой профиль') : t('Открыть свой профиль')}
            aria-expanded={menuOpen}
            onClick={() => {
              setMenuOpen((current) => !current);
            }}
          >
            <ProfileAvatar user={user} />
          </button>
          <span
            className="account-profile-identity"
            data-tooltip={`${user.displayName} · @${user.username}`}
          >
            <strong>{user.displayName}</strong>
            <small>
              <i
                className={`profile-online-indicator ${presence}`}
                aria-label={presenceText(presence)}
              />
              @{user.username}
            </small>
          </span>
          <button
            type="button"
            className="account-profile-settings-button"
            aria-label={t('Открыть настройки профиля')}
            onClick={() => {
              setMenuOpen(false);
              onSettings('profile');
            }}
          >
            <Settings size={17} aria-hidden="true" />
          </button>
          {callDock && <ProfileAudioControls state={callDock} />}
        </div>
      </div>
      {leaveTarget ? (
        <ChatActionConfirmDialog
          title={t('Покинуть «{p0}»?', { p0: sidebarChatName(leaveTarget, user.id) })}
          description={t(
            'После выхода группа исчезнет из списка. Вернуться можно будет только по новому приглашению участника.',
          )}
          confirmLabel="Покинуть группу"
          busy={leaveBusy}
          error={leaveError}
          onCancel={() => !leaveBusy && setLeaveTarget(undefined)}
          onConfirm={() => {
            if (!onLeaveGroup || leaveBusy) return;
            setLeaveBusy(true);
            setLeaveError('');
            void onLeaveGroup(leaveTarget.id)
              .then(() => setLeaveTarget(undefined))
              .catch((caught) =>
                setLeaveError(
                  caught instanceof Error ? caught.message : 'Не удалось выйти из группы',
                ),
              )
              .finally(() => setLeaveBusy(false));
          }}
        />
      ) : null}
      {onCreateGroup ? (
        <CreateGroupDialog
          open={groupFormOpen}
          friends={friends}
          onClose={() => setGroupFormOpen(false)}
          onCreate={onCreateGroup}
          onCreated={() => onNavigate('chats')}
        />
      ) : null}
      <UserProfileDialog
        viewerId={user.id}
        target={fullProfileTarget}
        onClose={() => setFullProfileTarget(undefined)}
      />
      {archiveMenu && onArchiveChat ? (
        <ChatArchiveMenu
          target={archiveMenu}
          onClose={() => setArchiveMenu(undefined)}
          onArchive={onArchiveChat}
          onManage={onManageChat}
          onDestructive={
            onManageChat
              ? (action) => {
                  setChatAction({ target: archiveMenu, action });
                  setChatActionError('');
                  setArchiveMenu(undefined);
                }
              : undefined
          }
        />
      ) : null}
      {chatAction && onManageChat && (
        <ChatActionConfirmDialog
          title={t(
            chatAction.action === 'block'
              ? 'Заблокировать пользователя?'
              : chatAction.target.group
                ? 'Покинуть группу?'
                : 'Удалить чат?',
          )}
          description={t(
            chatAction.action === 'block'
              ? 'Вы перестанете получать сообщения и звонки от этого пользователя.'
              : chatAction.target.group
                ? 'Группа исчезнет из вашего списка. Вернуться можно по приглашению.'
                : 'Чат будет удалён из вашего списка.',
          )}
          confirmLabel={t(
            chatAction.action === 'block'
              ? 'Заблокировать'
              : chatAction.target.group
                ? 'Покинуть'
                : 'Удалить',
          )}
          busy={chatActionBusy}
          error={chatActionError}
          onCancel={() => {
            if (!chatActionBusy) setChatAction(undefined);
          }}
          onConfirm={() => {
            if (chatActionBusy) return;
            setChatActionBusy(true);
            void Promise.resolve(onManageChat(chatAction.target.chatId, chatAction.action))
              .then(() => setChatAction(undefined))
              .catch(() =>
                setChatActionError(t('Не удалось выполнить действие. Попробуйте ещё раз.')),
              )
              .finally(() => setChatActionBusy(false));
          }}
        />
      )}
    </aside>
  );
}

function sidebarChatName(chat: ChatItem, userId: string) {
  if (chat.type === 'group') return chat.title?.trim() || 'Групповой чат';
  return chat.members.find((member) => member.id !== userId)?.displayName || 'Личный чат';
}

function SidebarAvatar({
  service = false,
  name,
  avatarUrl,
  group = false,
  activeCall = false,
  presence,
  positionX,
  positionY,
  scale,
}: {
  service?: boolean;
  name: string;
  avatarUrl?: string | null;
  group?: boolean;
  activeCall?: boolean;
  presence?: PresenceStatus;
  positionX?: number;
  positionY?: number;
  scale?: number;
}) {
  if (service) return <ServiceBotAvatar className="account-sidebar-chat-avatar" />;
  return (
    <span className={`account-sidebar-chat-avatar${group ? ' group' : ''}`} aria-hidden="true">
      {avatarUrl ? (
        <CachedMediaImage
          src={avatarUrl}
          alt=""
          draggable={false}
          referrerPolicy="no-referrer"
          style={avatarImageStyle(positionX, positionY, scale)}
        />
      ) : (
        name[0] || '?'
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

function presenceText(status: PresenceStatus) {
  if (status === 'online') return t('В сети');
  if (status === 'away') return t('Нет на месте');
  if (status === 'dnd') return t('Не беспокоить');
  return t('Не в сети');
}

function presenceModeDescription(mode: PresenceMode) {
  if (mode === 'away') return 'Показывать, что вы отошли';
  if (mode === 'dnd') return 'Показывать статус «Не беспокоить»';
  if (mode === 'invisible') return 'Другие всегда видят вас не в сети';
  return 'Вы в сети — это замечательно.';
}

function getInlinePresence(mode: PresenceMode, presence: PresenceStatus) {
  if (mode === 'away') return { label: 'Нет на месте', tone: 'away' };
  if (mode === 'dnd') return { label: 'Не беспокоить', tone: 'dnd' };
  if (mode === 'invisible') return { label: 'Невидимый', tone: 'invisible' };
  if (presence === 'away') return { label: 'Нет на месте', tone: 'away' };
  if (presence === 'dnd') return { label: 'Не беспокоить', tone: 'dnd' };
  if (presence === 'offline') return { label: 'Не в сети', tone: 'invisible' };
  return { label: 'В сети', tone: 'online' };
}

function PresenceModeIcon({ mode }: { mode: PresenceMode }) {
  if (mode === 'away') return <Moon className="presence-mode-icon away" size={15} />;
  if (mode === 'dnd') return <MinusCircle className="presence-mode-icon dnd" size={15} />;
  if (mode === 'invisible') return <EyeOff className="presence-mode-icon invisible" size={15} />;
  return <Circle className="presence-mode-icon online" size={13} fill="currentColor" />;
}

function ProfileAvatar({ user, large = false }: { user: AccountUser; large?: boolean }) {
  return (
    <span className={`profile-avatar-small${large ? ' large' : ''}`}>
      {user.avatarUrl ? (
        <CachedMediaImage src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
      ) : (
        user.displayName.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

function Nav({
  active,
  icon,
  label,
  live = false,
  passive = false,
  unread = 0,
  clickMotion = false,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  live?: boolean;
  passive?: boolean;
  unread?: number;
  clickMotion?: boolean;
  onClick?(): void;
}) {
  const iconAnimation = useRef<Animation>(null);
  return (
    <button
      className={`${active ? 'active' : ''} ${live ? 'call-navigation' : ''} ${passive ? 'passive' : ''}`}
      aria-label={
        unread > 0 ? t('{p0}, непрочитанных сообщений: {p1}', { p0: label, p1: unread }) : label
      }
      aria-current={active ? 'page' : undefined}
      aria-disabled={passive || undefined}
      onClick={
        passive
          ? undefined
          : (event) => {
              if (clickMotion && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
                iconAnimation.current?.cancel();
                iconAnimation.current =
                  event.currentTarget
                    .querySelector('svg')
                    ?.animate?.(
                      [
                        { transform: 'scale(1)' },
                        { offset: 0.22, transform: 'scale(0.86)' },
                        { offset: 0.55, transform: 'scale(1.16) rotate(-8deg)' },
                        { transform: 'scale(1)' },
                      ],
                      { duration: 300, easing: 'ease-in-out' },
                    ) ?? null;
              }
              onClick?.();
            }
      }
    >
      {icon}
      <span>{label}</span>
      {unread > 0 && (
        <b className="account-nav-unread" aria-hidden="true">
          {unread >= 99 ? '99+' : unread}
        </b>
      )}
      {live && <i aria-label={t('Звонок продолжается')} />}
    </button>
  );
}

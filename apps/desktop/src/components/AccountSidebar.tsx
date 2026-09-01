import {
  Check,
  ChevronDown,
  Circle,
  Download,
  DoorOpen,
  Edit3,
  EyeOff,
  History,
  LogOut,
  MessageCircle,
  MinusCircle,
  Moon,
  PhoneCall,
  Plus,
  Search,
  Settings,
  Users,
  X,
} from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AccountUser } from '../lib/api-client';
import type { UpdateStatus } from '../lib/updater';
import { compactVersionLabel } from '../lib/version-label';
import type { PresenceStatus } from '@freetalk/protocol';
import { ChatRealtimeClient } from '../lib/chat-realtime';
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
import type { ChatNotificationPreview } from './ChatNotificationStack';
import type { ChatItem } from './ChatsPage';

export type AccountPage = 'home' | 'friends' | 'chats' | 'history';
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
  onCreateGroup,
  onInstallUpdate,
  onSettings,
  onLogout,
}: {
  user: AccountUser;
  activePage: AccountDestination;
  roomActive?: boolean;
  readingChatId?: string;
  chats?: ChatItem[];
  friends?: Array<{ id: string; displayName: string; avatarUrl?: string | null }>;
  chatsLoading?: boolean;
  updateStatus?: UpdateStatus;
  onNavigate(page: AccountDestination): void;
  onOpenChat?(chatId: string): Promise<void> | void;
  onCreateGroup?(title: string, memberIds: string[]): Promise<boolean>;
  onInstallUpdate?(): void;
  onSettings(tab?: 'profile'): void;
  onLogout(): void;
}) {
  const [presence, setPresence] = useState<PresenceStatus>('offline');
  const [menuOpen, setMenuOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [presenceMode, setLocalPresenceMode] = useState(getPresenceMode);
  const [unreadByChat, setUnreadByChat] = useState<Record<string, number>>({});
  const [chatSearch, setChatSearch] = useState('');
  const [groupFormOpen, setGroupFormOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [groupBusy, setGroupBusy] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const statusPickerRef = useRef<HTMLDivElement>(null);
  const activePageRef = useRef(activePage);
  const readingChatIdRef = useRef(readingChatId);
  const previewSequence = useRef(0);

  useEffect(() => {
    activePageRef.current = activePage;
    readingChatIdRef.current = readingChatId;
  }, [activePage, readingChatId]);

  useEffect(() => {
    const realtime = new ChatRealtimeClient((event) => {
      if (
        event.type !== 'message-created' ||
        !['text', 'image'].includes(event.message.kind) ||
        !event.message.sender_id ||
        event.message.sender_id === user.id
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

      if (getPresenceMode() === 'dnd') return;
      const senderName = event.message.display_name || event.message.username || 'Новое сообщение';
      const previewBody =
        event.message.kind === 'image' ? event.message.body || 'Фотография' : event.message.body;
      const preview: ChatNotificationPreview = {
        sequence: ++previewSequence.current,
        chatId: event.chatId,
        senderName,
        avatarUrl: event.message.avatar_url,
        body: previewBody,
      };
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
        setStatusOpen(false);
        setMenuOpen(false);
        return;
      }
      if (statusOpen && !statusPickerRef.current?.contains(target)) {
        setStatusOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (statusOpen) {
          setStatusOpen(false);
        } else {
          setMenuOpen(false);
        }
      }
    };
    window.addEventListener('pointerdown', closeOnOutsideClick);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsideClick);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen, statusOpen]);

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
    if (!query) return chats ?? [];
    return (chats ?? []).filter((chat) =>
      sidebarChatName(chat, user.id).toLocaleLowerCase('ru-RU').includes(query),
    );
  }, [chats, deferredChatSearch, user.id]);
  const chatNavigationEnabled = chats !== undefined && Boolean(onOpenChat && onCreateGroup);
  const updateVersion =
    updateStatus?.kind === 'available' || updateStatus?.kind === 'downloading'
      ? updateStatus.version
      : undefined;

  const createGroup = async () => {
    if (!onCreateGroup || groupBusy || !groupTitle.trim() || groupMembers.length === 0) return;
    setGroupBusy(true);
    try {
      if (!(await onCreateGroup(groupTitle, groupMembers))) return;
      setGroupTitle('');
      setGroupMembers([]);
      setGroupFormOpen(false);
      onNavigate('chats');
    } finally {
      setGroupBusy(false);
    }
  };

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
              <span className="sr-only">Поиск по чатам</span>
              <input
                value={chatSearch}
                placeholder="Поиск по чатам"
                onChange={(event) => setChatSearch(event.target.value)}
              />
              {chatSearch ? (
                <button type="button" aria-label="Очистить поиск" onClick={() => setChatSearch('')}>
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
            label="Текущий звонок"
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
              ? `Загрузка ${Math.round(updateStatus.progress)}%`
              : `Обновиться до версии ${compactVersionLabel(updateVersion)}`}
          </span>
        </button>
      ) : null}

      <nav>
        {roomActive && !chatNavigationEnabled && (
          <Nav
            active={activePage === 'room'}
            icon={<PhoneCall />}
            label="Текущий звонок"
            live
            onClick={() => onNavigate('room')}
          />
        )}
        <Nav
          active={activePage === 'home'}
          icon={<DoorOpen />}
          label="Главная"
          onClick={() => onNavigate('home')}
        />
        <Nav
          active={activePage === 'friends'}
          icon={<Users />}
          label="Друзья"
          onClick={() => onNavigate('friends')}
        />
        {!chatNavigationEnabled && (
          <Nav
            active={activePage === 'chats'}
            icon={<MessageCircle />}
            label="Чаты"
            unread={unreadChatCount}
            onClick={() => onNavigate('chats')}
          />
        )}
        <Nav
          active={activePage === 'history'}
          icon={<History />}
          label="История"
          onClick={() => onNavigate('history')}
        />
      </nav>
      {chatNavigationEnabled ? (
        <section className="account-sidebar-chats" aria-label="Чаты и группы">
          <header>
            <span className="account-sidebar-chat-heading">
              <span>Чаты и группы</span>
              {unreadChatCount > 0 ? <b>{unreadChatCount > 99 ? '99+' : unreadChatCount}</b> : null}
            </span>
            <button
              type="button"
              className="account-sidebar-chat-add"
              aria-label="Создать групповой чат"
              aria-expanded={groupFormOpen}
              onClick={() => setGroupFormOpen((open) => !open)}
            >
              <Plus aria-hidden="true" />
            </button>
          </header>
          {groupFormOpen ? (
            <div className="account-group-form">
              <div>
                <strong>Новый групповой чат</strong>
                <button
                  type="button"
                  aria-label="Закрыть создание группы"
                  onClick={() => setGroupFormOpen(false)}
                >
                  <X />
                </button>
              </div>
              <input
                value={groupTitle}
                maxLength={80}
                aria-label="Название группы"
                placeholder="Название группы"
                onChange={(event) => setGroupTitle(event.target.value)}
              />
              <div className="account-group-friends">
                {friends.map((friend) => {
                  const selected = groupMembers.includes(friend.id);
                  return (
                    <label key={friend.id}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(event) =>
                          setGroupMembers((current) =>
                            event.target.checked
                              ? [...current, friend.id]
                              : current.filter((id) => id !== friend.id),
                          )
                        }
                      />
                      <SidebarAvatar name={friend.displayName} avatarUrl={friend.avatarUrl} />
                      <span>{friend.displayName}</span>
                      {selected ? <Check aria-hidden="true" /> : null}
                    </label>
                  );
                })}
                {friends.length === 0 ? <small>Сначала добавьте друзей</small> : null}
              </div>
              <button
                type="button"
                disabled={!groupTitle.trim() || groupMembers.length === 0 || groupBusy}
                onClick={() => void createGroup()}
              >
                Создать группу
              </button>
            </div>
          ) : null}
          <div className="account-sidebar-chat-list">
            {chatsLoading && (chats?.length ?? 0) === 0 ? (
              <div className="account-sidebar-chat-state">Загружаем чаты…</div>
            ) : sidebarChats.length > 0 ? (
              sidebarChats.map((chat) => {
                const name = sidebarChatName(chat, user.id);
                const other = chat.members.find((member) => member.id !== user.id);
                const unread = Math.max(chat.unreadCount ?? 0, unreadByChat[chat.id] ?? 0);
                return (
                  <button
                    type="button"
                    className={chat.id === readingChatId ? 'active' : ''}
                    aria-current={chat.id === readingChatId ? 'true' : undefined}
                    aria-label={unread > 0 ? `${name}, непрочитанных сообщений: ${unread}` : name}
                    key={chat.id}
                    onClick={() => {
                      onNavigate('chats');
                      void onOpenChat?.(chat.id);
                    }}
                  >
                    <SidebarAvatar
                      name={name}
                      avatarUrl={chat.type === 'group' ? chat.avatarUrl : other?.avatarUrl}
                      group={chat.type === 'group'}
                    />
                    <span>
                      <strong>{name}</strong>
                      <small>
                        {chat.lastMessage ||
                          (chat.type === 'group'
                            ? `${chat.members.length} участников`
                            : other?.presence === 'online'
                              ? 'В сети'
                              : 'Личный чат')}
                      </small>
                    </span>
                    {unread > 0 ? <b>{unread > 99 ? '99+' : unread}</b> : null}
                  </button>
                );
              })
            ) : (
              <div className="account-sidebar-chat-state">
                {chats?.length ? 'Ничего не найдено' : 'Чатов пока нет'}
              </div>
            )}
          </div>
        </section>
      ) : null}
      <div className="account-profile-menu-anchor" ref={profileMenuRef}>
        {menuOpen && (
          <div className="account-profile-popover" role="dialog" aria-label="Профиль и статус">
            <div
              className={`profile-popover-cover${user.coverUrl ? ' has-cover' : ''}`}
              style={user.coverUrl ? { backgroundImage: `url(${user.coverUrl})` } : undefined}
            >
              <ProfileAvatar user={user} large />
            </div>
            <div className="profile-popover-identity">
              <span>
                <strong>{user.displayName}</strong>
                <small className="profile-inline-identity">
                  @{user.username}
                  <i aria-hidden="true">•</i>
                  <span className={`profile-inline-presence ${inlinePresence.tone}`}>
                    {inlinePresence.label}
                  </span>
                </small>
              </span>
              <p>{user.bio || 'Расскажите немного о себе в настройках профиля.'}</p>
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
                <strong>Редактировать профиль</strong>
                <small>Имя, аватар и информация о себе</small>
              </span>
            </button>
            <div className="profile-presence-picker" ref={statusPickerRef}>
              <button
                type="button"
                className={`profile-popover-action profile-status-control${statusOpen ? ' open' : ''}`}
                aria-expanded={statusOpen}
                aria-haspopup="menu"
                aria-controls="profile-status-menu"
                onClick={() => setStatusOpen((current) => !current)}
              >
                <PresenceModeIcon mode={presenceMode} />
                <span>
                  <strong>{presenceModeLabel(presenceMode)}</strong>
                  <small>{presenceModeDescription(presenceMode)}</small>
                </span>
                <ChevronDown
                  className={statusOpen ? 'expanded' : ''}
                  size={16}
                  aria-hidden="true"
                />
              </button>
              {statusOpen && (
                <div
                  id="profile-status-menu"
                  className="profile-presence-options"
                  role="menu"
                  aria-label="Выбор статуса"
                >
                  {(['auto', 'away', 'dnd', 'invisible'] as PresenceMode[]).map((mode) => (
                    <button
                      type="button"
                      className={mode === presenceMode ? 'selected' : ''}
                      role="menuitemradio"
                      aria-checked={mode === presenceMode}
                      key={mode}
                      onClick={() => choosePresence(mode)}
                    >
                      <PresenceModeIcon mode={mode} />
                      <span>
                        <strong>{presenceModeLabel(mode)}</strong>
                        <small>{presenceModeDescription(mode)}</small>
                      </span>
                      <Check className="status-item-check" size={15} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" className="profile-popover-logout" onClick={onLogout}>
              <LogOut size={16} /> Выйти из аккаунта
            </button>
          </div>
        )}
        <div className="account-profile-mini">
          <button
            type="button"
            className="account-profile-avatar-trigger"
            aria-label={menuOpen ? 'Закрыть свой профиль' : 'Открыть свой профиль'}
            aria-expanded={menuOpen}
            onClick={() => {
              setMenuOpen((current) => !current);
              setStatusOpen(false);
            }}
          >
            <ProfileAvatar user={user} />
          </button>
          <span>
            <strong>{user.displayName}</strong>
            <small>
              <i
                className={`profile-online-indicator ${presence}`}
                aria-label={presenceText(presence)}
              />
              @{user.username} · {presenceText(presence)}
            </small>
          </span>
          <button
            type="button"
            className="account-profile-settings-button"
            aria-label="Открыть настройки профиля"
            onClick={() => {
              setMenuOpen(false);
              setStatusOpen(false);
              onSettings('profile');
            }}
          >
            <Settings size={17} aria-hidden="true" />
          </button>
        </div>
      </div>
    </aside>
  );
}

function sidebarChatName(chat: ChatItem, userId: string) {
  if (chat.type === 'group') return chat.title?.trim() || 'Групповой чат';
  return chat.members.find((member) => member.id !== userId)?.displayName || 'Личный чат';
}

function SidebarAvatar({
  name,
  avatarUrl,
  group = false,
}: {
  name: string;
  avatarUrl?: string | null;
  group?: boolean;
}) {
  return (
    <span className={`account-sidebar-chat-avatar${group ? ' group' : ''}`} aria-hidden="true">
      {avatarUrl ? (
        <img src={avatarUrl} alt="" draggable={false} referrerPolicy="no-referrer" />
      ) : (
        name[0] || '?'
      )}
    </span>
  );
}

function presenceText(status: PresenceStatus) {
  if (status === 'online') return 'В сети';
  if (status === 'away') return 'Нет на месте';
  if (status === 'dnd') return 'Не беспокоить';
  return 'Не в сети';
}

function presenceModeDescription(mode: PresenceMode) {
  if (mode === 'away') return 'Показывать, что вы отошли';
  if (mode === 'dnd') return 'Показывать статус «Не беспокоить»';
  if (mode === 'invisible') return 'Другие всегда видят вас не в сети';
  return 'Автоматически: неактивен через 10 минут';
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
        <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
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
  unread = 0,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  live?: boolean;
  unread?: number;
  onClick(): void;
}) {
  return (
    <button
      className={`${active ? 'active' : ''} ${live ? 'call-navigation' : ''}`}
      aria-label={unread > 0 ? `${label}, непрочитанных сообщений: ${unread}` : label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
      {unread > 0 && (
        <b className="account-nav-unread" aria-hidden="true">
          {unread >= 99 ? '99+' : unread}
        </b>
      )}
      {live && <i aria-label="Звонок продолжается" />}
    </button>
  );
}

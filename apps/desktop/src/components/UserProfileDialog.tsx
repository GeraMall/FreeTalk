import {
  Activity,
  Ban,
  CalendarDays,
  Clock3,
  Hash,
  MessageCircle,
  MoreHorizontal,
  Phone,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PresenceStatus } from '@freetalk/protocol';
import { accountClient } from '../lib/api-client';
import { collectAccountMediaUrls, warmAccountMediaCache } from '../lib/account-media-cache';
import { CachedMediaImage } from './CachedMedia';

type ProfileRelationship = 'self' | 'friend' | 'incoming' | 'outgoing' | 'none';
type ProfileTab = 'profile' | 'activity' | 'common';

export interface UserProfileData {
  id: string;
  username: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  registeredAt: string;
  presence?: PresenceStatus;
  relationship?: ProfileRelationship;
  mutualFriendsCount: number;
  mutualFriends: Array<{
    id: string;
    username?: string;
    displayName: string;
    avatarUrl: string | null;
    presence?: PresenceStatus;
  }>;
  commonChatsCount?: number;
  commonChats?: Array<{
    id: string;
    type: 'direct' | 'group';
    title: string;
    avatarUrl: string | null;
    lastInteractionAt: string | null;
  }>;
  sharedCalls?: {
    count: number;
    lastStartedAt: string | null;
    lastDurationSeconds: number | null;
  };
}

export interface UserProfileTarget {
  id: string;
  displayName: string;
  username?: string;
  avatarUrl?: string | null;
  presence?: PresenceStatus;
  relationship?: ProfileRelationship;
}

export interface UserProfileActions {
  onMessage?(userId: string): Promise<void> | void;
  onCall?(userId: string): Promise<void> | void;
  onOpenChat?(chatId: string): Promise<void> | void;
  onRemoveFriend?(userId: string): Promise<void> | void;
  onBlock?(userId: string): Promise<void> | void;
}

export function UserProfileDialog({
  viewerId,
  target,
  initialProfile,
  actions,
  onClose,
}: {
  viewerId: string;
  target?: UserProfileTarget;
  initialProfile?: UserProfileData;
  actions?: UserProfileActions;
  onClose(): void;
}) {
  const [activeTarget, setActiveTarget] = useState(target);
  const [profile, setProfile] = useState<UserProfileData | undefined>(initialProfile);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<ProfileTab>('profile');
  const [busyAction, setBusyAction] = useState('');
  const targetId = target?.id;
  const targetDisplayName = target?.displayName;
  const targetUsername = target?.username;
  const targetAvatarUrl = target?.avatarUrl;
  const targetPresence = target?.presence;
  const targetRelationship = target?.relationship;

  useEffect(() => {
    setActiveTarget(
      targetId && targetDisplayName
        ? {
            id: targetId,
            displayName: targetDisplayName,
            username: targetUsername,
            avatarUrl: targetAvatarUrl,
            presence: targetPresence,
            relationship: targetRelationship,
          }
        : undefined,
    );
    setTab('profile');
  }, [
    targetAvatarUrl,
    targetDisplayName,
    targetId,
    targetPresence,
    targetRelationship,
    targetUsername,
  ]);

  useEffect(() => {
    if (!activeTarget) return;
    let cancelled = false;
    const seed = initialProfile?.id === activeTarget.id ? initialProfile : undefined;
    setProfile(seed);
    setLoading(true);
    setError('');
    void accountClient
      .request<{ profile: UserProfileData }>(`/v1/users/${activeTarget.id}/profile`)
      .then(async (result) => {
        await warmAccountMediaCache(viewerId, collectAccountMediaUrls(result.profile), 4_000);
        if (!cancelled) setProfile(result.profile);
      })
      .catch((caught) => {
        if (!cancelled && !seed)
          setError(caught instanceof Error ? caught.message : 'Не удалось загрузить профиль');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTarget, initialProfile, viewerId]);

  useEffect(() => {
    if (!activeTarget) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [activeTarget, onClose]);

  const commonChats = profile?.commonChats ?? [];
  const sharedCalls = profile?.sharedCalls ?? {
    count: 0,
    lastStartedAt: null,
    lastDurationSeconds: null,
  };
  const relationship =
    profile?.relationship ??
    activeTarget?.relationship ??
    (activeTarget?.id === viewerId ? 'self' : undefined);
  const isSelf = relationship === 'self' || activeTarget?.id === viewerId;
  const activityItems = (() => {
    if (!profile) return [];
    const items: Array<{ icon: 'call' | 'chat' | 'presence'; title: string; text: string }> = [];
    if (sharedCalls.lastStartedAt)
      items.push({
        icon: 'call',
        title: isSelf ? 'Последний звонок' : 'Последний звонок с вами',
        text: `${formatRelativeDate(sharedCalls.lastStartedAt)} · ${formatDuration(sharedCalls.lastDurationSeconds)}`,
      });
    if (commonChats[0])
      items.push({
        icon: 'chat',
        title: commonChats[0].title,
        text: commonChats[0].lastInteractionAt
          ? `${isSelf ? 'Твой чат' : 'Общий чат'} · ${formatRelativeDate(commonChats[0].lastInteractionAt)}`
          : isSelf
            ? 'Твой чат'
            : 'Общий чат',
      });
    if (profile.presence && profile.presence !== 'offline')
      items.push({
        icon: 'presence',
        title: presenceLabel(profile.presence),
        text: 'Текущий статус в FreeTalk',
      });
    return items;
  })();

  if (!activeTarget) return null;
  const displayName = profile?.displayName ?? activeTarget.displayName;
  const username = profile?.username ?? activeTarget.username;
  const avatarUrl = profile?.avatarUrl ?? activeTarget.avatarUrl;
  const presence = profile?.presence ?? activeTarget.presence ?? 'offline';

  const runAction = async (key: string, action: () => Promise<void> | void) => {
    if (busyAction) return;
    setBusyAction(key);
    setError('');
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось выполнить действие');
    } finally {
      setBusyAction('');
    }
  };

  const addFriend = username
    ? () =>
        runAction('friend', async () => {
          await accountClient.request('/v1/friends/requests', {
            method: 'POST',
            body: JSON.stringify({ username }),
          });
          setProfile((current) => (current ? { ...current, relationship: 'outgoing' } : current));
        })
    : undefined;

  return createPortal(
    <div className="full-profile-backdrop" onMouseDown={onClose}>
      <article
        className="full-profile-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Профиль ${displayName}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="full-profile-close"
          aria-label="Закрыть профиль"
          onClick={onClose}
        >
          <X />
        </button>

        <section className="full-profile-identity-card">
          <div className="full-profile-cover">
            {profile?.coverUrl ? <CachedMediaImage src={profile.coverUrl} alt="" /> : null}
          </div>
          <div className="full-profile-avatar">
            {avatarUrl ? (
              <CachedMediaImage src={avatarUrl} alt={`Аватар ${displayName}`} />
            ) : (
              <span>{displayName.trim().slice(0, 1).toLocaleUpperCase('ru-RU')}</span>
            )}
            <i className={presence} aria-label={presenceLabel(presence)} />
          </div>
          <div className="full-profile-name">
            <h2>{displayName}</h2>
            {username ? <p>@{username}</p> : null}
            <span className={presence}>
              <i /> {presenceLabel(presence)}
            </span>
          </div>

          <ProfileActions
            relationship={relationship}
            targetId={activeTarget.id}
            busy={busyAction}
            actions={actions}
            onAddFriend={addFriend}
            onRun={runAction}
          />

          <div className="full-profile-relationship">
            <Users />
            <span>{relationshipLabel(relationship)}</span>
          </div>
          {profile?.registeredAt ? (
            <div className="full-profile-since">
              <CalendarDays />
              <span>
                <small>В FreeTalk с</small>
                <strong>{formatRegistrationDate(profile.registeredAt)}</strong>
              </span>
            </div>
          ) : null}
        </section>

        <section className="full-profile-content">
          <header>
            <span>ПОЛНЫЙ ПРОФИЛЬ</span>
            {loading ? <i>Обновляем…</i> : null}
          </header>
          <nav className="full-profile-tabs" aria-label="Разделы профиля">
            {(
              [
                ['profile', 'Профиль'],
                ['activity', 'Активность'],
                ['common', isSelf ? 'Твои' : 'Общие'],
              ] as const
            ).map(([id, label]) => (
              <button
                type="button"
                key={id}
                className={tab === id ? 'active' : ''}
                aria-selected={tab === id}
                role="tab"
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="full-profile-tab-panel" key={tab} role="tabpanel">
            {tab === 'profile' ? (
              <ProfileTabContent
                profile={profile}
                commonChats={commonChats}
                isSelf={isSelf}
                onOpenMutual={(friend) => {
                  setActiveTarget(friend);
                  setTab('profile');
                }}
                onOpenChat={actions?.onOpenChat}
                onRun={runAction}
              />
            ) : null}
            {tab === 'activity' ? <ActivityTab items={activityItems} /> : null}
            {tab === 'common' ? (
              <CommonTab
                profile={profile}
                commonChats={commonChats}
                sharedCalls={sharedCalls}
                isSelf={isSelf}
              />
            ) : null}
          </div>
          {error ? <p className="full-profile-error">{error}</p> : null}
        </section>
      </article>
    </div>,
    document.body,
  );
}

function ProfileActions({
  relationship,
  targetId,
  busy,
  actions,
  onAddFriend,
  onRun,
}: {
  relationship?: ProfileRelationship;
  targetId: string;
  busy: string;
  actions?: UserProfileActions;
  onAddFriend?: () => void;
  onRun(key: string, action: () => Promise<void> | void): Promise<void>;
}) {
  if (!relationship || relationship === 'self') return null;
  const canMessage = Boolean(actions?.onMessage);
  const canCall = relationship === 'friend' && Boolean(actions?.onCall);
  const canManage =
    relationship === 'friend' && Boolean(actions?.onRemoveFriend || actions?.onBlock);
  if (
    !canMessage &&
    !canCall &&
    !canManage &&
    relationship !== 'none' &&
    relationship !== 'outgoing'
  )
    return null;
  return (
    <div className="full-profile-actions">
      {relationship === 'none' && onAddFriend ? (
        <button className="primary" disabled={Boolean(busy)} onClick={onAddFriend}>
          <UserPlus /> Добавить
        </button>
      ) : null}
      {relationship === 'outgoing' ? (
        <button className="request-sent" disabled>
          <Clock3 /> Запрос отправлен
        </button>
      ) : null}
      {canMessage ? (
        <button
          className={relationship === 'friend' ? 'primary' : 'secondary'}
          disabled={Boolean(busy)}
          onClick={() => void onRun('message', () => actions!.onMessage!(targetId))}
        >
          <MessageCircle /> Написать
        </button>
      ) : null}
      {canCall ? (
        <button
          className="secondary icon-action"
          aria-label="Позвонить"
          disabled={Boolean(busy)}
          onClick={() => void onRun('call', () => actions!.onCall!(targetId))}
        >
          <Phone />
        </button>
      ) : null}
      {canManage ? (
        <details className="full-profile-more">
          <summary aria-label="Другие действия">
            <MoreHorizontal />
          </summary>
          <div>
            {actions?.onRemoveFriend ? (
              <button onClick={() => void onRun('remove', () => actions.onRemoveFriend!(targetId))}>
                <UserMinus /> Удалить из друзей
              </button>
            ) : null}
            {actions?.onBlock ? (
              <button
                className="destructive"
                onClick={() => void onRun('block', () => actions.onBlock!(targetId))}
              >
                <Ban /> Заблокировать
              </button>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function ProfileTabContent({
  profile,
  commonChats,
  isSelf,
  onOpenMutual,
  onOpenChat,
  onRun,
}: {
  profile?: UserProfileData;
  commonChats: NonNullable<UserProfileData['commonChats']>;
  isSelf: boolean;
  onOpenMutual(friend: UserProfileData['mutualFriends'][number]): void;
  onOpenChat?: (chatId: string) => Promise<void> | void;
  onRun(key: string, action: () => Promise<void> | void): Promise<void>;
}) {
  return (
    <>
      <section className="full-profile-section full-profile-about">
        <h3>О СЕБЕ</h3>
        <p>{profile?.bio || 'Пользователь пока ничего не добавил.'}</p>
      </section>
      <section className="full-profile-section">
        <div className="full-profile-section-heading">
          <h3>{isSelf ? 'ТВОИ ДРУЗЬЯ' : 'ОБЩИЕ ДРУЗЬЯ'}</h3>
          <small>{profile?.mutualFriendsCount ?? 0}</small>
        </div>
        {(profile?.mutualFriends.length ?? 0) > 0 ? (
          <div className="full-profile-person-list">
            {profile!.mutualFriends.slice(0, 4).map((friend) => (
              <button type="button" key={friend.id} onClick={() => onOpenMutual(friend)}>
                <ProfileMedia avatarUrl={friend.avatarUrl} name={friend.displayName} />
                <span>
                  <strong>{friend.displayName}</strong>
                  <small>
                    {friend.username ? `@${friend.username}` : presenceLabel(friend.presence)}
                  </small>
                </span>
                <i className={friend.presence ?? 'offline'} />
              </button>
            ))}
          </div>
        ) : (
          <ProfileEmpty
            icon="friends"
            text={
              profile
                ? isSelf
                  ? 'У тебя пока нет друзей.'
                  : 'Нет общих друзей.'
                : 'Информация загружается.'
            }
          />
        )}
      </section>
      <section className="full-profile-section">
        <div className="full-profile-section-heading">
          <h3>{isSelf ? 'ТВОИ ЧАТЫ' : 'ОБЩИЕ ЧАТЫ'}</h3>
          <small>{profile?.commonChatsCount ?? 0}</small>
        </div>
        {commonChats.length > 0 ? (
          <div className="full-profile-chat-list">
            {commonChats.slice(0, 3).map((chat) => {
              const content = (
                <>
                  <ProfileMedia
                    avatarUrl={chat.avatarUrl}
                    name={chat.title}
                    square={chat.type === 'group'}
                  />
                  <span>
                    <strong>{chat.title}</strong>
                    <small>{chat.type === 'group' ? 'Групповой чат' : 'Личный чат'}</small>
                  </span>
                  <small>
                    {chat.lastInteractionAt ? formatRelativeDate(chat.lastInteractionAt) : ''}
                  </small>
                </>
              );
              return onOpenChat ? (
                <button
                  type="button"
                  key={chat.id}
                  onClick={() => void onRun('chat', () => onOpenChat(chat.id))}
                >
                  {content}
                </button>
              ) : (
                <div key={chat.id}>{content}</div>
              );
            })}
          </div>
        ) : (
          <ProfileEmpty
            icon="chat"
            text={
              profile
                ? isSelf
                  ? 'У тебя пока нет чатов.'
                  : 'Нет общих чатов.'
                : 'Информация загружается.'
            }
          />
        )}
      </section>
      {!isSelf && profile?.registeredAt ? (
        <section className="full-profile-section full-profile-joined-section">
          <CalendarDays />
          <span>
            <h3>В FREETALK С</h3>
            <p>{formatRegistrationDate(profile.registeredAt)}</p>
          </span>
        </section>
      ) : null}
    </>
  );
}

function ActivityTab({
  items,
}: {
  items: Array<{ icon: 'call' | 'chat' | 'presence'; title: string; text: string }>;
}) {
  if (items.length === 0)
    return <ProfileEmpty icon="activity" text="Недавней активности пока нет." />;
  return (
    <section className="full-profile-section">
      <h3>НЕДАВНЯЯ АКТИВНОСТЬ</h3>
      <div className="full-profile-activity-list">
        {items.map((item, index) => (
          <div key={`${item.icon}-${index}`}>
            <span>
              {item.icon === 'call' ? (
                <Phone />
              ) : item.icon === 'chat' ? (
                <MessageCircle />
              ) : (
                <Activity />
              )}
            </span>
            <p>
              <strong>{item.title}</strong>
              <small>{item.text}</small>
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CommonTab({
  profile,
  commonChats,
  sharedCalls,
  isSelf,
}: {
  profile?: UserProfileData;
  commonChats: NonNullable<UserProfileData['commonChats']>;
  sharedCalls: NonNullable<UserProfileData['sharedCalls']>;
  isSelf: boolean;
}) {
  return (
    <>
      <div className="full-profile-metrics">
        <div>
          <Users />
          <strong>{profile?.mutualFriendsCount ?? 0}</strong>
          <small>{isSelf ? 'твоих друзей' : 'общих друзей'}</small>
        </div>
        <div>
          <Hash />
          <strong>{profile?.commonChatsCount ?? commonChats.length}</strong>
          <small>{isSelf ? 'твоих чатов' : 'общих чатов'}</small>
        </div>
        <div>
          <Phone />
          <strong>{sharedCalls.count}</strong>
          <small>{isSelf ? 'твоих звонков' : 'звонков вместе'}</small>
        </div>
      </div>
      {sharedCalls.lastStartedAt ? (
        <section className="full-profile-section full-profile-call-summary">
          <Phone />
          <span>
            <h3>ПОСЛЕДНИЙ ЗВОНОК</h3>
            <p>
              {formatRelativeDate(sharedCalls.lastStartedAt)} ·{' '}
              {formatDuration(sharedCalls.lastDurationSeconds)}
            </p>
          </span>
        </section>
      ) : (
        <ProfileEmpty icon="call" text="Совместных звонков пока нет." />
      )}
    </>
  );
}

function ProfileMedia({
  avatarUrl,
  name,
  square = false,
}: {
  avatarUrl?: string | null;
  name: string;
  square?: boolean;
}) {
  return (
    <span className={`full-profile-list-avatar${square ? ' square' : ''}`}>
      {avatarUrl ? <CachedMediaImage src={avatarUrl} alt="" /> : name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function ProfileEmpty({
  icon,
  text,
}: {
  icon: 'friends' | 'chat' | 'call' | 'activity';
  text: string;
}) {
  return (
    <div className="full-profile-empty">
      {icon === 'friends' ? (
        <Users />
      ) : icon === 'call' ? (
        <Phone />
      ) : icon === 'activity' ? (
        <Activity />
      ) : (
        <MessageCircle />
      )}
      <span>{text}</span>
    </div>
  );
}

function presenceLabel(status: PresenceStatus = 'offline') {
  if (status === 'online') return 'В сети';
  if (status === 'away') return 'Нет на месте';
  if (status === 'dnd') return 'Не беспокоить';
  return 'Не в сети';
}

function relationshipLabel(relationship?: ProfileRelationship) {
  if (relationship === 'self') return 'Это ваш профиль';
  if (relationship === 'friend') return 'У вас в друзьях';
  if (relationship === 'incoming') return 'Отправил вам запрос в друзья';
  if (relationship === 'outgoing') return 'Запрос в друзья отправлен';
  if (relationship === 'none') return 'Вы ещё не друзья';
  return 'Связь обновляется…';
}

function formatRegistrationDate(value: string) {
  return new Date(value).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}

function formatRelativeDate(value: string) {
  const date = new Date(value);
  const difference = Date.now() - date.getTime();
  const day = 86_400_000;
  if (difference >= 0 && difference < day && date.getDate() === new Date().getDate())
    return `Сегодня, ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  if (difference >= day && difference < day * 2) return 'Вчера';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function formatDuration(seconds: number | null) {
  if (!seconds || seconds < 60) return 'меньше минуты';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} мин`;
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}

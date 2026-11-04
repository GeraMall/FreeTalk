import { t } from '../lib/app-language';
import { useRef, useState, type CSSProperties } from 'react';
import type { PresenceStatus } from '@freetalk/protocol';
import {
  Ban,
  Check,
  Clock3,
  MessageCircle,
  MoreHorizontal,
  RefreshCw,
  Search,
  ShieldOff,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { CachedMediaImage } from './CachedMedia';
import { PresenceBadge } from './PresenceBadge';
import { UserProfileDialog, type UserProfileTarget } from './UserProfileDialog';

export interface FriendItem {
  id: string;
  username: string;
  display_name: string;
  displayName?: string;
  avatarUrl?: string | null;
  presence?: PresenceStatus;
}

export interface PendingItem extends FriendItem {
  profile_id?: string;
  sender_id: string;
  recipient_id: string;
}

export type BlockedItem = FriendItem;
type FriendsFilter = 'all' | 'pending' | 'blocked';

interface FriendsPageProps {
  userId: string;
  friends: FriendItem[];
  pending: PendingItem[];
  blocked: BlockedItem[];
  loading: boolean;
  loadError: string;
  onRetry(): void;
  onAdd(username: string): Promise<void>;
  onAccept(requestId: string): Promise<void>;
  onDecline(requestId: string): Promise<void>;
  onCancel?(requestId: string): Promise<void>;
  onMessage(friendId: string): Promise<void>;
  onCall?(friendId: string): Promise<void>;
  onOpenChat?(chatId: string): Promise<void>;
  onRemove(friendId: string): Promise<void>;
  onBlock(friendId: string): Promise<void>;
  onUnblock(friendId: string): Promise<void>;
}

export function FriendsPage({
  userId,
  friends,
  pending,
  blocked,
  loading,
  loadError,
  onRetry,
  onAdd,
  onAccept,
  onDecline,
  onCancel,
  onMessage,
  onCall,
  onOpenChat,
  onRemove,
  onBlock,
  onUnblock,
}: FriendsPageProps) {
  const [filter, setFilter] = useState<FriendsFilter>('all');
  const [search, setSearch] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [fullProfileTarget, setFullProfileTarget] = useState<UserProfileTarget>();
  const searchRef = useRef<HTMLInputElement>(null);
  const query = search.trim().replace(/^@/, '').toLocaleLowerCase('ru-RU');
  const visibleFriends = query
    ? friends.filter((friend) => {
        const name = friend.displayName ?? friend.display_name;
        return (
          friend.username.toLocaleLowerCase('ru-RU').includes(query) ||
          name.toLocaleLowerCase('ru-RU').includes(query)
        );
      })
    : friends;

  const runAction = async (key: string, action: () => Promise<void>) => {
    if (busyAction) return;
    setBusyAction(key);
    try {
      await action();
    } finally {
      setBusyAction('');
    }
  };

  const addFriend = async () => {
    const username = search.trim().replace(/^@/, '');
    if (!username) {
      searchRef.current?.focus();
      return;
    }
    await runAction('add', async () => {
      await onAdd(username);
      setSearch('');
    });
  };

  const pendingLabel = `${pending.length} ${pluralize(pending.length, 'запрос', 'запроса', 'запросов')}`;
  const friendLabel = `${friends.length} ${pluralize(friends.length, 'друг', 'друга', 'друзей')}`;

  return (
    <div className="friends-page page-enter">
      <header className="friends-header">
        <div className="friends-title-mark" aria-hidden="true">
          <Users />
        </div>
        <div>
          <p className="friends-eyebrow">{t('ВАШ КРУГ ОБЩЕНИЯ')}</p>
          <h1>{t('Друзья')}</h1>
          <p>
            {friendLabel}
            <span aria-hidden="true">•</span>
            {pendingLabel}
          </p>
        </div>
      </header>

      <section className="friends-toolbar" aria-label={t('Поиск и добавление друзей')}>
        <label className="friends-search">
          <Search aria-hidden="true" />
          <span className="sr-only">{t('Найти по username')}</span>
          <input
            ref={searchRef}
            value={search}
            autoComplete="off"
            placeholder={t('Найти по @username')}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void addFriend()}
          />
          {search && (
            <button type="button" aria-label={t('Очистить поиск')} onClick={() => setSearch('')}>
              <X />
            </button>
          )}
        </label>
        <button
          className="friends-add-button"
          disabled={!search.trim() || busyAction === 'add'}
          onClick={() => void addFriend()}
        >
          <UserPlus />
          {busyAction === 'add' ? t('Отправляем…') : t('Добавить')}
        </button>
      </section>

      <div className="friends-filter-row" role="group" aria-label={t('Фильтры друзей')}>
        <FilterButton
          active={filter === 'all'}
          label={t('Все')}
          count={friends.length}
          onClick={() => setFilter('all')}
        />
        <FilterButton
          active={filter === 'pending'}
          label={t('Ожидают')}
          count={pending.length}
          onClick={() => setFilter('pending')}
        />
        <FilterButton
          active={filter === 'blocked'}
          label={t('Заблокированные')}
          compactLabel="Блок"
          count={blocked.length}
          onClick={() => setFilter('blocked')}
        />
      </div>

      {loading ? (
        <FriendsSkeleton />
      ) : loadError ? (
        <FriendsError message={loadError} onRetry={onRetry} />
      ) : (
        <div className="friends-results">
          {filter === 'all' && (
            <>
              {visibleFriends.length > 0 ? (
                <div className="friends-grid" aria-label={t('Список друзей')}>
                  {visibleFriends.map((friend, index) => (
                    <FriendCard
                      key={friend.id}
                      friend={friend}
                      index={index}
                      busyAction={busyAction}
                      onMessage={() =>
                        runAction(`message:${friend.id}`, () => onMessage(friend.id))
                      }
                      onRemove={() => runAction(`remove:${friend.id}`, () => onRemove(friend.id))}
                      onBlock={() => runAction(`block:${friend.id}`, () => onBlock(friend.id))}
                      onOpenProfile={() =>
                        setFullProfileTarget({
                          id: friend.id,
                          displayName: friend.displayName ?? friend.display_name,
                          username: friend.username,
                          avatarUrl: friend.avatarUrl,
                          presence: friend.presence,
                          relationship: 'friend',
                        })
                      }
                    />
                  ))}
                </div>
              ) : friends.length > 0 ? (
                <FriendsEmpty
                  title={t('Никого не найдено')}
                  description={t('Проверьте имя или username и попробуйте ещё раз.')}
                  action="Очистить поиск"
                  onAction={() => setSearch('')}
                />
              ) : (
                <FriendsEmpty
                  title={t('У вас пока нет друзей')}
                  description={t('Добавьте пользователя по @username, чтобы начать общение.')}
                  action="Добавить друга"
                  onAction={() => searchRef.current?.focus()}
                />
              )}
            </>
          )}

          {filter === 'pending' && (
            <div className="friends-stack" aria-label={t('Ожидающие запросы')}>
              {pending.map((item, index) => {
                const incoming = item.recipient_id === userId;
                const profileId =
                  item.profile_id ?? (incoming ? item.sender_id : item.recipient_id);
                return (
                  <article
                    className="friend-card pending-friend-card"
                    style={{ '--friend-index': index } as CSSProperties}
                    key={item.id}
                  >
                    <FriendAvatar
                      friend={item}
                      onOpenProfile={() =>
                        setFullProfileTarget({
                          id: profileId,
                          displayName: item.displayName ?? item.display_name,
                          username: item.username,
                          avatarUrl: item.avatarUrl,
                          presence: item.presence,
                          relationship: incoming ? 'incoming' : 'outgoing',
                        })
                      }
                    />
                    <div className="friend-identity">
                      <strong>{item.displayName ?? item.display_name}</strong>
                      <small>@{item.username}</small>
                      <span className="friend-status pending">
                        <Clock3 />
                        {incoming ? t('Входящий запрос') : t('Запрос отправлен')}
                      </span>
                    </div>
                    {incoming ? (
                      <div className="pending-actions">
                        <button
                          className="friend-primary-action"
                          disabled={Boolean(busyAction)}
                          onClick={() =>
                            void runAction(`accept:${item.id}`, () => onAccept(item.id))
                          }
                        >
                          <Check /> {t('Принять')}
                        </button>
                        <button
                          className="friend-icon-action"
                          aria-label={t('Отклонить запрос от {p0}', { p0: item.username })}
                          disabled={Boolean(busyAction)}
                          onClick={() =>
                            void runAction(`decline:${item.id}`, () => onDecline(item.id))
                          }
                        >
                          <X />
                        </button>
                      </div>
                    ) : (
                      <button
                        className="friend-cancel-request"
                        disabled={Boolean(busyAction) || !onCancel}
                        aria-label={t('Отменить запрос к {p0}', { p0: item.username })}
                        onClick={() =>
                          void runAction(`cancel:${item.id}`, () => onCancel!(item.id))
                        }
                      >
                        <X />
                        {busyAction === `cancel:${item.id}` ? t('Отменяем…') : t('Отменить запрос')}
                      </button>
                    )}
                  </article>
                );
              })}
              {pending.length === 0 && (
                <FriendsEmpty
                  title={t('Нет ожидающих запросов')}
                  description={t('Новые приглашения появятся здесь.')}
                />
              )}
            </div>
          )}

          {filter === 'blocked' && (
            <div className="friends-stack" aria-label={t('Заблокированные пользователи')}>
              {blocked.map((item, index) => (
                <article
                  className="friend-card blocked-friend-card"
                  style={{ '--friend-index': index } as CSSProperties}
                  key={item.id}
                >
                  <FriendAvatar friend={item} />
                  <div className="friend-identity">
                    <strong>{item.displayName ?? item.display_name}</strong>
                    <small>@{item.username}</small>
                    <span className="friend-status blocked">
                      <Ban /> {t('Заблокирован')}
                    </span>
                  </div>
                  <button
                    className="friend-secondary-action"
                    disabled={Boolean(busyAction)}
                    onClick={() => void runAction(`unblock:${item.id}`, () => onUnblock(item.id))}
                  >
                    <ShieldOff /> {t('Разблокировать')}
                  </button>
                </article>
              ))}
              {blocked.length === 0 && (
                <FriendsEmpty
                  title={t('Список блокировок пуст')}
                  description={t('Здесь появятся заблокированные вами пользователи.')}
                />
              )}
            </div>
          )}
        </div>
      )}
      <UserProfileDialog
        viewerId={userId}
        target={fullProfileTarget}
        actions={{
          onMessage,
          onCall,
          onOpenChat,
          onRemoveFriend: async (friendId) => {
            await onRemove(friendId);
            setFullProfileTarget(undefined);
          },
          onBlock: async (friendId) => {
            await onBlock(friendId);
            setFullProfileTarget(undefined);
          },
        }}
        onClose={() => setFullProfileTarget(undefined)}
      />
    </div>
  );
}

function FilterButton({
  active,
  label,
  compactLabel,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  compactLabel?: string;
  count: number;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={active ? 'active' : ''}
      onClick={onClick}
    >
      <span className="friends-filter-label">{label}</span>
      {compactLabel ? <span className="friends-filter-label-compact">{compactLabel}</span> : null}
      <span className="friends-filter-count">{count}</span>
    </button>
  );
}

function FriendCard({
  friend,
  index,
  busyAction,
  onMessage,
  onRemove,
  onBlock,
  onOpenProfile,
}: {
  friend: FriendItem;
  index: number;
  busyAction: string;
  onMessage(): Promise<void>;
  onRemove(): Promise<void>;
  onBlock(): Promise<void>;
  onOpenProfile(): void;
}) {
  const name = friend.displayName ?? friend.display_name;
  return (
    <article className="friend-card" style={{ '--friend-index': index } as CSSProperties}>
      <FriendAvatar friend={friend} onOpenProfile={onOpenProfile} />
      <div className="friend-identity">
        <strong>{name}</strong>
        <small>@{friend.username}</small>
        <span className={`friend-status ${friend.presence ?? 'offline'}`}>
          <i />
          {presenceLabel(friend.presence)}
        </span>
      </div>
      <div className="friend-card-actions">
        <button
          className="friend-primary-action"
          disabled={Boolean(busyAction)}
          onClick={() => void onMessage()}
        >
          <MessageCircle /> {t('Написать')}
        </button>
        <details className="friend-actions-menu">
          <summary aria-label={t('Другие действия для {p0}', { p0: name })}>
            <MoreHorizontal />
          </summary>
          <div>
            <button disabled={Boolean(busyAction)} onClick={() => void onRemove()}>
              <UserMinus /> {t('Удалить из друзей')}
            </button>
            <button
              className="destructive"
              disabled={Boolean(busyAction)}
              onClick={() => void onBlock()}
            >
              <Ban /> {t('Заблокировать')}
            </button>
          </div>
        </details>
      </div>
    </article>
  );
}

function presenceLabel(status: PresenceStatus = 'offline') {
  if (status === 'online') return 'В сети';
  if (status === 'away') return 'Нет на месте';
  if (status === 'dnd') return 'Не беспокоить';
  return 'Не в сети';
}

function FriendAvatar({
  friend,
  onOpenProfile,
}: {
  friend: FriendItem;
  onOpenProfile?: () => void;
}) {
  const name = friend.displayName ?? friend.display_name;
  const content = (
    <>
      {friend.avatarUrl ? (
        <CachedMediaImage src={friend.avatarUrl} alt="" />
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
      {friend.presence ? <PresenceBadge status={friend.presence} /> : null}
    </>
  );
  if (onOpenProfile)
    return (
      <button
        type="button"
        className="friend-avatar friend-profile-trigger"
        aria-label={t('Открыть полный профиль {p0}', { p0: name })}
        onClick={onOpenProfile}
      >
        {content}
      </button>
    );
  return (
    <span className="friend-avatar" aria-hidden="true">
      {content}
    </span>
  );
}

function FriendsEmpty({
  title,
  description,
  action,
  onAction,
}: {
  title: string;
  description: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="friends-empty">
      <span aria-hidden="true">
        <Users />
      </span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action && onAction && (
        <button onClick={onAction}>
          <UserPlus />
          {action}
        </button>
      )}
    </div>
  );
}

function FriendsSkeleton() {
  return (
    <div
      className="friends-grid friends-skeleton"
      aria-label={t('Загрузка списка друзей')}
      aria-busy="true"
    >
      {[0, 1, 2, 3].map((item) => (
        <div className="friend-card" key={item}>
          <i className="skeleton-avatar" />
          <span>
            <i />
            <i />
            <i />
          </span>
          <i className="skeleton-button" />
        </div>
      ))}
    </div>
  );
}

function FriendsError({ message, onRetry }: { message: string; onRetry(): void }) {
  return (
    <div className="friends-error" role="alert">
      <span aria-hidden="true">!</span>
      <div>
        <strong>{t('Не удалось загрузить друзей')}</strong>
        <p>{message}</p>
      </div>
      <button onClick={onRetry}>
        <RefreshCw /> {t('Повторить')}
      </button>
    </div>
  );
}

function pluralize(value: number, one: string, few: string, many: string) {
  const remainder100 = value % 100;
  const remainder10 = value % 10;
  if (remainder100 >= 11 && remainder100 <= 14) return many;
  if (remainder10 === 1) return one;
  if (remainder10 >= 2 && remainder10 <= 4) return few;
  return many;
}

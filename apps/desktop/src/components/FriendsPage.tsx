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
  onMessage(friendId: string): Promise<void>;
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
  onMessage,
  onRemove,
  onBlock,
  onUnblock,
}: FriendsPageProps) {
  const [filter, setFilter] = useState<FriendsFilter>('all');
  const [search, setSearch] = useState('');
  const [busyAction, setBusyAction] = useState('');
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
          <p className="friends-eyebrow">ВАШ КРУГ ОБЩЕНИЯ</p>
          <h1>Друзья</h1>
          <p>
            {friendLabel} <span aria-hidden="true">•</span> {pendingLabel}
          </p>
        </div>
      </header>

      <section className="friends-toolbar" aria-label="Поиск и добавление друзей">
        <label className="friends-search">
          <Search aria-hidden="true" />
          <span className="sr-only">Найти по username</span>
          <input
            ref={searchRef}
            value={search}
            autoComplete="off"
            placeholder="Найти по @username"
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void addFriend()}
          />
          {search && (
            <button type="button" aria-label="Очистить поиск" onClick={() => setSearch('')}>
              <X />
            </button>
          )}
        </label>
        <button
          className="friends-add-button"
          disabled={!search.trim() || busyAction === 'add'}
          onClick={() => void addFriend()}
        >
          <UserPlus /> {busyAction === 'add' ? 'Отправляем…' : 'Добавить'}
        </button>
      </section>

      <div className="friends-filter-row" role="group" aria-label="Фильтры друзей">
        <FilterButton
          active={filter === 'all'}
          label="Все"
          count={friends.length}
          onClick={() => setFilter('all')}
        />
        <FilterButton
          active={filter === 'pending'}
          label="Ожидают"
          count={pending.length}
          onClick={() => setFilter('pending')}
        />
        <FilterButton
          active={filter === 'blocked'}
          label="Заблокированные"
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
                <div className="friends-grid" aria-label="Список друзей">
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
                    />
                  ))}
                </div>
              ) : friends.length > 0 ? (
                <FriendsEmpty
                  title="Никого не найдено"
                  description="Проверьте имя или username и попробуйте ещё раз."
                  action="Очистить поиск"
                  onAction={() => setSearch('')}
                />
              ) : (
                <FriendsEmpty
                  title="У вас пока нет друзей"
                  description="Добавьте пользователя по @username, чтобы начать общение."
                  action="Добавить друга"
                  onAction={() => searchRef.current?.focus()}
                />
              )}
            </>
          )}

          {filter === 'pending' && (
            <div className="friends-stack" aria-label="Ожидающие запросы">
              {pending.map((item, index) => {
                const incoming = item.recipient_id === userId;
                return (
                  <article
                    className="friend-card pending-friend-card"
                    style={{ '--friend-index': index } as CSSProperties}
                    key={item.id}
                  >
                    <FriendAvatar friend={item} />
                    <div className="friend-identity">
                      <strong>{item.displayName ?? item.display_name}</strong>
                      <small>@{item.username}</small>
                      <span className="friend-status pending">
                        <Clock3 /> {incoming ? 'Входящий запрос' : 'Запрос отправлен'}
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
                          <Check /> Принять
                        </button>
                        <button
                          className="friend-icon-action"
                          aria-label={`Отклонить запрос от ${item.username}`}
                          disabled={Boolean(busyAction)}
                          onClick={() =>
                            void runAction(`decline:${item.id}`, () => onDecline(item.id))
                          }
                        >
                          <X />
                        </button>
                      </div>
                    ) : (
                      <span className="request-sent-label">Ожидаем ответа</span>
                    )}
                  </article>
                );
              })}
              {pending.length === 0 && (
                <FriendsEmpty
                  title="Нет ожидающих запросов"
                  description="Новые приглашения появятся здесь."
                />
              )}
            </div>
          )}

          {filter === 'blocked' && (
            <div className="friends-stack" aria-label="Заблокированные пользователи">
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
                      <Ban /> Заблокирован
                    </span>
                  </div>
                  <button
                    className="friend-secondary-action"
                    disabled={Boolean(busyAction)}
                    onClick={() => void runAction(`unblock:${item.id}`, () => onUnblock(item.id))}
                  >
                    <ShieldOff /> Разблокировать
                  </button>
                </article>
              ))}
              {blocked.length === 0 && (
                <FriendsEmpty
                  title="Список блокировок пуст"
                  description="Здесь появятся заблокированные вами пользователи."
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FilterButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
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
      {label} <span>{count}</span>
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
}: {
  friend: FriendItem;
  index: number;
  busyAction: string;
  onMessage(): Promise<void>;
  onRemove(): Promise<void>;
  onBlock(): Promise<void>;
}) {
  const name = friend.displayName ?? friend.display_name;
  return (
    <article className="friend-card" style={{ '--friend-index': index } as CSSProperties}>
      <FriendAvatar friend={friend} />
      <div className="friend-identity">
        <strong>{name}</strong>
        <small>@{friend.username}</small>
        <span className={`friend-status ${friend.presence ?? 'offline'}`}>
          <i /> {presenceLabel(friend.presence)}
        </span>
      </div>
      <div className="friend-card-actions">
        <button
          className="friend-primary-action"
          disabled={Boolean(busyAction)}
          onClick={() => void onMessage()}
        >
          <MessageCircle /> Написать
        </button>
        <details className="friend-actions-menu">
          <summary aria-label={`Другие действия для ${name}`}>
            <MoreHorizontal />
          </summary>
          <div>
            <button disabled={Boolean(busyAction)} onClick={() => void onRemove()}>
              <UserMinus /> Удалить из друзей
            </button>
            <button
              className="destructive"
              disabled={Boolean(busyAction)}
              onClick={() => void onBlock()}
            >
              <Ban /> Заблокировать
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
  return 'Не в сети';
}

function FriendAvatar({ friend }: { friend: FriendItem }) {
  const name = friend.displayName ?? friend.display_name;
  return (
    <span className="friend-avatar" aria-hidden="true">
      {friend.avatarUrl ? <img src={friend.avatarUrl} alt="" /> : name.slice(0, 1).toUpperCase()}
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
          <UserPlus /> {action}
        </button>
      )}
    </div>
  );
}

function FriendsSkeleton() {
  return (
    <div
      className="friends-grid friends-skeleton"
      aria-label="Загрузка списка друзей"
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
        <strong>Не удалось загрузить друзей</strong>
        <p>{message}</p>
      </div>
      <button onClick={onRetry}>
        <RefreshCw /> Повторить
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

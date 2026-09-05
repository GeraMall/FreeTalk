import { Check, Search, Users, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PresenceStatus } from '@freetalk/protocol';
import { CachedMediaImage } from './CachedMedia';
import { PresenceBadge } from './PresenceBadge';

export interface CreateGroupFriend {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  presence?: PresenceStatus;
}

export function CreateGroupDialog({
  open,
  friends,
  onClose,
  onCreate,
  onCreated,
}: {
  open: boolean;
  friends: CreateGroupFriend[];
  onClose(): void;
  onCreate(title: string, memberIds: string[]): Promise<boolean>;
  onCreated?(): void;
}) {
  const [title, setTitle] = useState('');
  const [search, setSearch] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setSearch('');
    setMembers([]);
    setError('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [busy, onClose, open]);

  const visibleFriends = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ru-RU');
    if (!query) return friends;
    return friends.filter((friend) =>
      friend.displayName.toLocaleLowerCase('ru-RU').includes(query),
    );
  }, [friends, search]);

  if (!open) return null;

  const create = async () => {
    if (busy || !title.trim() || members.length === 0) return;
    setBusy(true);
    setError('');
    try {
      if (!(await onCreate(title.trim(), members))) return;
      onClose();
      onCreated?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось создать группу');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="create-group-backdrop" onMouseDown={() => !busy && onClose()}>
      <section
        className="create-group-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-group-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="create-group-title">Новый групповой чат</h2>
            <p>Выберите друзей, которых хотите добавить в группу.</p>
          </div>
          <button
            type="button"
            aria-label="Закрыть создание группы"
            disabled={busy}
            onClick={onClose}
          >
            <X />
          </button>
        </header>

        <label className="create-group-field">
          <span>Название группы</span>
          <input
            autoFocus
            value={title}
            maxLength={80}
            aria-label="Название группы"
            placeholder="Название группы"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        <label className="create-group-field create-group-search">
          <span>Участники</span>
          <span className="create-group-search-control">
            <Search aria-hidden="true" />
            <input
              value={search}
              aria-label="Поиск участников"
              placeholder="Поиск участников"
              onChange={(event) => setSearch(event.target.value)}
            />
            {search ? (
              <button
                type="button"
                aria-label="Очистить поиск участников"
                onClick={() => setSearch('')}
              >
                <X />
              </button>
            ) : null}
          </span>
        </label>

        <div className="create-group-friends" aria-label="Список друзей">
          {visibleFriends.map((friend) => {
            const selected = members.includes(friend.id);
            return (
              <label className={selected ? 'selected' : ''} key={friend.id}>
                <span className="create-group-avatar">
                  {friend.avatarUrl ? (
                    <CachedMediaImage src={friend.avatarUrl} alt="" />
                  ) : (
                    <span>{friend.displayName.trim().slice(0, 1).toLocaleUpperCase('ru-RU')}</span>
                  )}
                  <PresenceBadge status={friend.presence} />
                </span>
                <span className="create-group-friend-copy">
                  <strong>{friend.displayName}</strong>
                  <small>{presenceLabel(friend.presence)}</small>
                </span>
                <input
                  type="checkbox"
                  aria-label={`Добавить ${friend.displayName}`}
                  checked={selected}
                  onChange={(event) =>
                    setMembers((current) =>
                      event.target.checked
                        ? [...current, friend.id]
                        : current.filter((id) => id !== friend.id),
                    )
                  }
                />
                <span className="create-group-checkbox" aria-hidden="true">
                  {selected ? <Check /> : null}
                </span>
              </label>
            );
          })}
          {friends.length === 0 ? (
            <div className="create-group-empty">
              <Users />
              <strong>Пока некого добавить</strong>
              <small>Сначала добавьте друзей</small>
            </div>
          ) : visibleFriends.length === 0 ? (
            <div className="create-group-empty">
              <Search />
              <strong>Никого не найдено</strong>
              <small>Попробуйте другой запрос</small>
            </div>
          ) : null}
        </div>

        {error ? <p className="create-group-error">{error}</p> : null}
        <footer>
          <span>{members.length > 0 ? `Выбрано: ${members.length}` : 'Выберите участников'}</span>
          <div>
            <button type="button" className="secondary" disabled={busy} onClick={onClose}>
              Отмена
            </button>
            <button
              type="button"
              disabled={busy || !title.trim() || members.length === 0}
              onClick={() => void create()}
            >
              {busy ? 'Создаём…' : 'Создать группу'}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function presenceLabel(presence: PresenceStatus | undefined) {
  if (presence === 'online') return 'В сети';
  if (presence === 'away') return 'Неактивен';
  if (presence === 'dnd') return 'Не беспокоить';
  return 'Не в сети';
}

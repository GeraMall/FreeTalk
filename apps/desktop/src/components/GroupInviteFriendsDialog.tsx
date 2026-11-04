import { t } from '../lib/app-language';
import { Check, Search, UserPlus, Users, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PresenceStatus } from '@freetalk/protocol';
import { CachedMediaImage } from './CachedMedia';
import { PresenceBadge } from './PresenceBadge';

export interface GroupInviteFriend {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  presence?: PresenceStatus;
}

export function GroupInviteFriendsDialog({
  open,
  createGroup = false,
  groupTitle,
  friends,
  memberIds,
  onClose,
  onInvite,
}: {
  open: boolean;
  createGroup?: boolean;
  groupTitle: string;
  friends: GroupInviteFriend[];
  memberIds: string[];
  onClose(): void;
  onInvite(usernames: string[]): Promise<boolean>;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const members = useMemo(() => new Set(memberIds), [memberIds]);
  const visibleFriends = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ru-RU');
    if (!query) return friends;
    return friends.filter(
      (friend) =>
        friend.displayName.toLocaleLowerCase('ru-RU').includes(query) ||
        friend.username.toLocaleLowerCase('ru-RU').includes(query.replace(/^@/, '')),
    );
  }, [friends, search]);
  const availableFriends = friends.filter((friend) => !members.has(friend.id));

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setSelected([]);
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

  if (!open) return null;

  const invite = async () => {
    if (!selected.length || busy) return;
    setBusy(true);
    setError('');
    try {
      const usernames = friends
        .filter((friend) => selected.includes(friend.id))
        .map((friend) => friend.username);
      if (await onInvite(usernames)) onClose();
      else setError('Не удалось добавить выбранных друзей');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось добавить выбранных друзей');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="call-friends-backdrop" onMouseDown={() => !busy && onClose()}>
      <section
        className="call-friends-dialog group-invite-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-invite-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <span className="call-friends-heading-icon">
            <UserPlus />
          </span>
          <div>
            <h2 id="group-invite-title">
              {createGroup ? t('Создать группу') : t('Пригласить в группу')}
            </h2>
            <p>{createGroup ? t('Выберите друзей для нового чата') : groupTitle}</p>
          </div>
          <button
            type="button"
            aria-label={t('Закрыть приглашение друзей')}
            onClick={onClose}
            disabled={busy}
          >
            <X />
          </button>
        </header>

        <label className="call-friends-search">
          <Search aria-hidden="true" />
          <input
            autoFocus
            value={search}
            aria-label={t('Поиск друзей для группы')}
            placeholder={t('Найти друга')}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        <div className="call-friends-list" aria-label={t('Друзья для приглашения в группу')}>
          {visibleFriends.map((friend) => {
            const alreadyMember = members.has(friend.id);
            const checked = alreadyMember || selected.includes(friend.id);
            return (
              <label
                className={`${checked ? 'selected' : ''}${alreadyMember ? ' present' : ''}`}
                key={friend.id}
              >
                <span className="call-friend-avatar">
                  {friend.avatarUrl ? (
                    <CachedMediaImage src={friend.avatarUrl} alt="" />
                  ) : (
                    friend.displayName.trim().charAt(0).toLocaleUpperCase('ru-RU') || '?'
                  )}
                  <PresenceBadge status={friend.presence} />
                </span>
                <span className="call-friend-copy">
                  <strong>{friend.displayName}</strong>
                  <small>
                    {alreadyMember
                      ? t('Уже в группе')
                      : `@${friend.username} · ${presenceLabel(friend.presence)}`}
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={alreadyMember || busy}
                  aria-label={
                    alreadyMember
                      ? t('{p0} уже в группе', { p0: friend.displayName })
                      : t('Пригласить {p0}', { p0: friend.displayName })
                  }
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, friend.id]
                        : current.filter((id) => id !== friend.id),
                    )
                  }
                />
                <span className="call-friend-check" aria-hidden="true">
                  {checked ? <Check /> : null}
                </span>
              </label>
            );
          })}
          {friends.length === 0 ? (
            <div className="call-friends-empty">
              <Users />
              <strong>{t('Пока некого пригласить')}</strong>
              <small>{t('Сначала добавьте друзей')}</small>
            </div>
          ) : availableFriends.length === 0 ? (
            <div className="call-friends-empty">
              <Check />
              <strong>{t('Все друзья уже в группе')}</strong>
            </div>
          ) : visibleFriends.length === 0 ? (
            <div className="call-friends-empty">
              <Search />
              <strong>{t('Никого не найдено')}</strong>
            </div>
          ) : null}
        </div>

        {error ? <p className="call-friends-error">{error}</p> : null}
        <footer>
          <span>
            {selected.length ? t('Выбрано: {p0}', { p0: selected.length }) : t('Выберите друзей')}
          </span>
          <button type="button" disabled={!selected.length || busy} onClick={() => void invite()}>
            {busy ? t('Добавляем…') : createGroup ? t('Создать группу') : t('Пригласить')}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function presenceLabel(presence?: PresenceStatus) {
  if (presence === 'online') return 'В сети';
  if (presence === 'away') return 'Неактивен';
  if (presence === 'dnd') return 'Не беспокоить';
  return 'Не в сети';
}

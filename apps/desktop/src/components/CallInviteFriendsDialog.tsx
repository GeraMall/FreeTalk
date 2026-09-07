import { Check, Copy, Link2, Search, UserPlus, Users, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PresenceStatus } from '@freetalk/protocol';
import { CachedMediaImage } from './CachedMedia';
import { PresenceBadge } from './PresenceBadge';

export interface CallInviteFriend {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  presence?: PresenceStatus;
}

export function CallInviteFriendsDialog({
  open,
  friends,
  participantAccountIds,
  participantCount,
  capacity,
  roomId,
  inviteCopied,
  onClose,
  onCopyInvite,
  onInvite,
}: {
  open: boolean;
  friends: CallInviteFriend[];
  participantAccountIds: string[];
  participantCount: number;
  capacity: number;
  roomId: string;
  inviteCopied: boolean;
  onClose(): void;
  onCopyInvite(): void;
  onInvite(userIds: string[]): Promise<boolean>;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const present = useMemo(() => new Set(participantAccountIds), [participantAccountIds]);
  const openSlots = Math.max(0, capacity - participantCount);
  const visibleFriends = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ru-RU');
    return query
      ? friends.filter((friend) => friend.displayName.toLocaleLowerCase('ru-RU').includes(query))
      : friends;
  }, [friends, search]);

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
      if (await onInvite(selected)) onClose();
      else setError('Не удалось отправить приглашение');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось отправить приглашение');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="call-friends-backdrop" onMouseDown={() => !busy && onClose()}>
      <section
        className="call-friends-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="call-friends-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <span className="call-friends-heading-icon">
            <UserPlus />
          </span>
          <div>
            <h2 id="call-friends-title">Добавить друзей</h2>
            <p>
              Вы можете добавить ещё {openSlots} · {participantCount} из {capacity}
            </p>
          </div>
          <button
            type="button"
            aria-label="Закрыть список друзей"
            onClick={onClose}
            disabled={busy}
          >
            <X />
          </button>
        </header>

        <div className="call-friends-room-link">
          <span className="call-friends-room-link-icon">
            <Link2 aria-hidden="true" />
          </span>
          <span>
            <small>Ссылка на голосовую комнату</small>
            <code>{roomId}</code>
          </span>
          <button type="button" onClick={onCopyInvite}>
            {inviteCopied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {inviteCopied ? 'Скопировано' : 'Копировать'}
          </button>
        </div>

        <label className="call-friends-search">
          <Search aria-hidden="true" />
          <input
            autoFocus
            value={search}
            aria-label="Поиск друзей для звонка"
            placeholder="Найти друга"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        <div className="call-friends-list" aria-label="Друзья для приглашения">
          {visibleFriends.map((friend) => {
            const alreadyPresent = present.has(friend.id);
            const checked = alreadyPresent || selected.includes(friend.id);
            const selectionFull = !checked && selected.length >= openSlots;
            return (
              <label
                className={`${checked ? 'selected' : ''}${alreadyPresent ? ' present' : ''}`}
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
                  <small>{alreadyPresent ? 'Уже в звонке' : presenceLabel(friend.presence)}</small>
                </span>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={alreadyPresent || selectionFull || busy}
                  aria-label={
                    alreadyPresent
                      ? `${friend.displayName} уже в звонке`
                      : `Пригласить ${friend.displayName}`
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
              <strong>Пока некого пригласить</strong>
              <small>Сначала добавьте друзей</small>
            </div>
          ) : visibleFriends.length === 0 ? (
            <div className="call-friends-empty">
              <Search />
              <strong>Никого не найдено</strong>
            </div>
          ) : null}
        </div>

        {error ? <p className="call-friends-error">{error}</p> : null}
        <footer>
          <span>{selected.length ? `Выбрано: ${selected.length}` : 'Выберите друзей'}</span>
          <button type="button" disabled={!selected.length || busy} onClick={() => void invite()}>
            {busy ? 'Отправляем…' : 'Добавить'}
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

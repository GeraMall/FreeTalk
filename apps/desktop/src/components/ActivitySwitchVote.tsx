import { useEffect, useState } from 'react';
import { Gamepad2, X, Clock3 } from 'lucide-react';
import type { RoomActivity, RoomActivityAction } from '@freetalk/protocol';
import { tableNames, type TableParticipant } from './activity-table-ui';
import { PokerSounds } from '../lib/poker-sounds';
import { loadSettings } from '../lib/settings';
import { t } from '../lib/app-language';
import './activity-switch-vote.css';
const names = { ...tableNames, mines: 'Сапёр' };
export function ActivitySwitchVote({
  activity,
  selfId,
  participants,
  send,
  deafened,
}: {
  activity?: RoomActivity;
  selfId: string;
  participants: TableParticipant[];
  send?: (action: RoomActivityAction) => void;
  deafened: boolean;
}) {
  const vote = activity?.switchVote;
  const [dismissed, setDismissed] = useState(''),
    [now, setNow] = useState(Date.now),
    [sounds] = useState(() => new PokerSounds());
  const voteId = vote?.id,
    voteState = vote?.state;
  const eligible = Boolean(vote?.electorate.includes(selfId));
  useEffect(() => {
    if (!voteId) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [voteId]);
  useEffect(() => {
    sounds.enabled = !deafened && loadSettings().messageNotificationSound !== false;
    if (!sounds.enabled) {
      sounds.stop();
      return;
    }
    if (!voteId || voteState !== 'voting' || !eligible || deafened) return;
    sounds.enabled = true;
    sounds.schedule({ key: `game-vote:${voteId}`, sound: 'vote', at: Date.now() });
  }, [voteId, voteState, eligible, deafened, sounds]);
  useEffect(() => () => sounds.stop(), [sounds]);
  if (!vote || dismissed === vote.id || !eligible) return null;
  const voted = vote.yes.includes(selfId) || vote.no.includes(selfId),
    majority = Math.floor(vote.electorate.length / 2) + 1;
  return (
    <aside
      className="activity-switch-vote"
      role="status"
      aria-label={t('Голосование за смену игры')}
    >
      <header>
        <Gamepad2 size={20} />
        <strong>
          {t(
            vote.state === 'voting'
              ? 'Сменим игру?'
              : vote.state === 'accepted'
                ? 'Переходим в новую игру'
                : 'Остаёмся в текущей игре',
          )}
        </strong>
        <button
          type="button"
          aria-label={t('Скрыть голосование')}
          onClick={() => setDismissed(vote.id)}
        >
          <X size={16} />
        </button>
      </header>
      <p>
        <b>{participants.find((p) => p.id === vote.requestedBy)?.name ?? t('Участник')}</b>{' '}
        {t('предлагает перейти в')} <b>{t(names[vote.game])}</b>.
      </p>
      {vote.state === 'voting' && (
        <>
          <small>{t('Текущая партия завершится только при согласии большинства.')}</small>
          <div className="game-vote-count">
            <span>
              {t('За')}: {vote.yes.length} / {majority}
            </span>
            <span>
              {t('Против')}: {vote.no.length}
            </span>
            <span>
              <Clock3 size={12} />
              {Math.max(0, Math.ceil((vote.deadline - now) / 1000))} {t('сек')}
            </span>
          </div>
          <div className="game-vote-actions">
            <button
              type="button"
              disabled={voted || !send}
              onClick={() => send?.({ kind: 'game-vote', id: vote.id, accept: true })}
            >
              {t('Перейти')}
            </button>
            <button
              type="button"
              disabled={voted || !send}
              onClick={() => send?.({ kind: 'game-vote', id: vote.id, accept: false })}
            >
              {t('Остаться')}
            </button>
          </div>
          {voted && <small>{t('Ваш голос принят. Ожидаем остальных.')}</small>}
        </>
      )}
      {vote.state === 'expired' && <small>{t('Время истекло. Партия продолжается.')}</small>}
    </aside>
  );
}

import type { TableOf } from '@freetalk/protocol';
import { useState } from 'react';
import { Spade, EyeOff } from 'lucide-react';
import { t } from '../lib/app-language';
import { playerName, type TableUiProps } from './activity-table-ui';
const suits: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
function Card({ value }: { value?: string }) {
  return (
    <span
      className={`poker-card ${value ? '' : 'card-back'} ${value && ['h', 'd'].includes(value[1]!) ? 'red' : ''}`}
    >
      {value ? (
        <>
          <b>{value[0] === 'T' ? '10' : value[0]}</b>
          <span>{suits[value[1]!]}</span>
        </>
      ) : (
        <Spade size={18} />
      )}
    </span>
  );
}
export function ActivityPoker({
  table,
  selfId,
  participants,
  send,
}: TableUiProps<TableOf<'poker'>>) {
  const seat = table.seats.indexOf(selfId ?? ''),
    canAct = seat === table.turn && table.stage !== 'showdown' && table.phase === 'playing';
  const owed = Math.max(0, table.bet - (table.bets[seat] ?? 0)),
    minimum = table.bet + table.minRaise,
    maximum = (table.stacks[seat] ?? 0) + (table.bets[seat] ?? 0);
  const [raise, setRaise] = useState(40);
  const amount = Math.min(maximum, Math.max(Math.min(minimum, maximum), raise));
  return (
    <div className="poker-game">
      <div className="poker-info">
        <strong>{t('Техасский холдем')}</strong>
        <small>
          {t('Раздача')} #{table.handNumber} · {t('Виртуальные фишки')} · 10 / 20
        </small>
      </div>
      <div className="poker-felt">
        <div className="poker-community">
          <span className="poker-pot">
            {t('Банк')} <b>{table.pot}</b>
          </span>
          <div className="poker-cards">
            {Array.from({ length: 5 }, (_, i) => (
              <Card key={i} value={table.board[i]} />
            ))}
          </div>
          <small>{table.stage.toUpperCase()}</small>
        </div>
        <div className="poker-seats">
          {table.seats.map((id, i) =>
            id ? (
              <div
                key={id}
                className={`poker-seat poker-position-${({ 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 5], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5] }[table.seats.length] ?? [0, 1, 2, 3, 4, 5])[seat >= 0 ? (i - seat + table.seats.length) % table.seats.length : i]} ${table.turn === i && table.stage !== 'showdown' ? 'is-moving' : ''} ${table.folded.includes(i) ? 'is-folded' : ''} ${i === seat ? 'is-self' : ''}`}
              >
                <strong>
                  {playerName(id, participants)}
                  {table.dealer === i && <i className="poker-dealer">D</i>}
                </strong>
                <div className="poker-cards">
                  {[0, 1].map((n) => (
                    <Card key={n} value={table.hands.find((h) => h.ownerId === id)?.cards[n]} />
                  ))}
                </div>
                <span>{table.stacks[i]} ¤</span>
                <small>
                  {table.payouts[i]
                    ? `+${table.payouts[i]}`
                    : table.folded.includes(i)
                      ? t('Пас')
                      : table.allIn.includes(i)
                        ? t('Олл-ин')
                        : table.bets[i]
                          ? `${t('Ставка')}: ${table.bets[i]}`
                          : '—'}
                </small>
              </div>
            ) : null,
          )}
        </div>
      </div>
      <div className="poker-controls">
        <div className="table-status" role="status">
          {table.phase === 'finished'
            ? `${t('Победитель')}: ${playerName(table.winner, participants)}`
            : table.stage === 'showdown'
              ? t('Раздача завершена')
              : `${t('Ход')}: ${playerName(table.seats[table.turn], participants)}`}
        </div>
        {canAct && (
          <>
            <div className="table-inline-controls">
              <button type="button" onClick={() => send({ kind: 'poker-bet', action: 'fold' })}>
                {t('Пас')}
              </button>
              {owed ? (
                <button type="button" onClick={() => send({ kind: 'poker-bet', action: 'call' })}>
                  {t('Уравнять')} {Math.min(owed, table.stacks[seat]!)}
                </button>
              ) : (
                <button type="button" onClick={() => send({ kind: 'poker-bet', action: 'check' })}>
                  {t('Чек')}
                </button>
              )}
            </div>
            <div className="poker-raise">
              <input
                type="number"
                aria-label={t('Размер ставки')}
                min={Math.min(minimum, maximum)}
                max={maximum}
                value={amount}
                onChange={(e) => setRaise(Number(e.target.value))}
              />
              <button
                type="button"
                className="table-primary"
                disabled={maximum <= table.bet || table.acted.includes(seat)}
                onClick={() => send({ kind: 'poker-bet', action: 'raise', amount })}
              >
                {amount === maximum ? t('Олл-ин') : table.bet ? t('Повысить до') : t('Ставка')}{' '}
                {amount}
              </button>
            </div>
          </>
        )}
        {seat < 0 && (
          <p className="table-muted">
            <EyeOff size={14} />
            {t('Вы зритель. Закрытые карты игроков не видны.')}
          </p>
        )}
        {selfId === table.hostId && table.stage === 'showdown' && table.phase !== 'finished' && (
          <button
            type="button"
            className="table-primary"
            onClick={() => send({ kind: 'poker-next' })}
          >
            {t('Следующая раздача')}
          </button>
        )}
        {selfId === table.hostId && table.phase === 'finished' && (
          <button
            type="button"
            className="table-primary"
            onClick={() => send({ kind: 'table-reset' })}
          >
            {t('Новый стол')}
          </button>
        )}
      </div>
      <div className="table-event-log">
        {table.log.slice(-5).map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
    </div>
  );
}

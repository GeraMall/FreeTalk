import { canRaisePoker, type TableOf } from '@freetalk/protocol';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Spade,
  Eye,
  BookOpen,
  ChartNoAxesCombined,
  X,
  Clock3,
  RotateCcw,
  Coins,
  ChevronRight,
} from 'lucide-react';
import { t } from '../lib/app-language';
import { pokerHand } from '../lib/poker-hand';
import { playerName, type TableUiProps } from './activity-table-ui';
import { PokerCard, PokerChips, PokerAvatar } from './PokerVisuals';
import { pokerCombinations } from '../lib/poker-guide';
import './poker-table.css';

const stages = {
  preflop: 'Префлоп',
  flop: 'Флоп',
  turn: 'Тёрн',
  river: 'Ривер',
  showdown: 'Вскрытие',
} as const;
const actions = {
  fold: 'Пас',
  check: 'Чек',
  call: 'Колл',
  raise: 'Повышение',
  timeout: 'Время вышло — пас',
  rebuy: 'Докупка',
} as const;
const positions: Record<number, number[]> = {
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 5],
  5: [0, 1, 2, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
};
const dealVectors = [
  ['0px', '-180px'],
  ['220px', '-100px'],
  ['220px', '180px'],
  ['0px', '200px'],
  ['-220px', '180px'],
  ['-220px', '-100px'],
];
const fmt = (n: number) => n.toLocaleString('ru-RU');

export function ActivityPoker({
  table,
  selfId,
  participants,
  send,
}: TableUiProps<TableOf<'poker'>>) {
  const [now, setNow] = useState(Date.now),
    [drawer, setDrawer] = useState<'hands' | 'stats'>();
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (table.stage === 'showdown' && !table.handEndedAt) return;
    const refresh = () => setNow(Date.now());
    const timer = window.setInterval(refresh, 250);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [table.stage, table.handEndedAt]);
  useEffect(() => {
    if (!drawer) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawer(undefined);
    };
    const outside = (e: PointerEvent) => {
      if (
        e.target instanceof Element &&
        !panel.current?.contains(e.target) &&
        !e.target.closest('[data-poker-drawer-toggle]')
      )
        setDrawer(undefined);
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', outside);
    };
  }, [drawer]);
  const seat = table.seats.indexOf(selfId ?? ''),
    settled = table.stage === 'showdown',
    advanced = table.pokerRules === 2;
  const dealing =
    advanced && !settled && now < (table.turnAt ?? 0) && now < (table.handStartedAt ?? 0) + 2600;
  const canAct =
    seat >= 0 &&
    seat === table.turn &&
    !settled &&
    table.phase === 'playing' &&
    !dealing &&
    !table.folded.includes(seat) &&
    !table.allIn.includes(seat);
  const owed = Math.max(0, table.bet - (table.bets[seat] ?? 0)),
    minimum = table.bet + table.minRaise,
    maximum = (table.stacks[seat] ?? 0) + (table.bets[seat] ?? 0);
  const scope = `${table.id}:${table.handNumber}:${table.stage}:${table.turn}:${table.bet}`;
  const [draft, setDraft] = useState({ scope: '', value: '' });
  const value = draft.scope === scope ? draft.value : String(Math.min(minimum, maximum)),
    amount = Number(value);
  const validAmount =
      value.trim() !== '' &&
      Number.isSafeInteger(amount) &&
      amount > table.bet &&
      amount <= maximum &&
      (amount >= minimum || amount === maximum),
    canRaise = canRaisePoker(table, seat);
  const setAmount = (n: number) =>
    setDraft({
      scope,
      value: String(Math.min(maximum, Math.max(Math.min(minimum, maximum), Math.round(n)))),
    });
  const ownCards = table.hands.find((h) => h.ownerId === selfId)?.cards ?? [];
  const cardsKey = [...ownCards, ...table.board].join(',');
  const hand = useMemo(
    () => (ownCards.length ? pokerHand(cardsKey.split(',')) : { name: '', cards: [], draw: '' }),
    [cardsKey, ownCards.length],
  );
  const seconds = table.turnDeadline
    ? Math.max(
        0,
        Math.min(30, Math.ceil((table.turnDeadline - Math.max(now, table.turnAt ?? 0)) / 1000)),
      )
    : undefined;
  const order = Array.from(
    { length: table.seats.length },
    (_, n) => (table.turn + n) % table.seats.length,
  ).filter((i) => table.seats[i] && !table.folded.includes(i) && !table.allIn.includes(i));
  const nextSeat = order[1],
    rebuyCount = table.rebuys?.[seat] ?? 0;
  const canRebuy = advanced && seat >= 0 && settled && table.stacks[seat] === 0 && rebuyCount < 3;
  const small =
      table.smallBlind ??
      (table.seats.length === 2 ? table.dealer : (table.dealer + 1) % table.seats.length),
    big = table.bigBlind ?? (small + 1) % table.seats.length;
  const raiseLabel = amount === maximum ? 'ALL IN' : t(table.bet ? 'Повысить до' : 'Ставка');
  return (
    <div className="poker-game pkr" data-hand={table.handNumber}>
      <header className="pkr-heading">
        <div className="pkr-heading-title">
          <span className="pkr-brand">
            <Spade size={21} />
          </span>
          <div>
            <h3>{t('Техасский холдем')}</h3>
            <p>
              {t('Раздача')} {String(table.handNumber).padStart(2, '0')}
              <i />
              10 / 20
              <i />
              {advanced ? t('30 секунд на ход') : t('Виртуальные фишки')}
            </p>
          </div>
        </div>
        <div className="pkr-heading-actions">
          <button
            type="button"
            data-poker-drawer-toggle
            aria-expanded={drawer === 'stats'}
            onClick={() => setDrawer(drawer === 'stats' ? undefined : 'stats')}
          >
            <ChartNoAxesCombined size={17} />
            <span>{t('Статистика стола')}</span>
          </button>
          <button
            type="button"
            data-poker-drawer-toggle
            aria-expanded={drawer === 'hands'}
            onClick={() => setDrawer(drawer === 'hands' ? undefined : 'hands')}
          >
            <BookOpen size={17} />
            <span>{t('Комбинации')}</span>
          </button>
        </div>
      </header>
      <div className={`pkr-arena ${dealing ? 'pkr-dealing' : ''} ${settled ? 'pkr-settled' : ''}`}>
        <div className="pkr-rail">
          <div className="pkr-fabric" />
          <span className="pkr-table-wordmark">
            TRLKA <Spade size={17} /> POKER
          </span>
          <span className="pkr-felt-rule">
            {t('Виртуальные фишки')} · {t('Старт')} 1 000
          </span>
        </div>
        <div className="pkr-center">
          <div className="pkr-pot" key={`pot:${table.handNumber}:${settled}`}>
            <span>{t(settled ? 'Разыграно' : 'Общий банк')}</span>
            <strong>
              <Coins size={19} />
              {fmt(table.pot)}
            </strong>
            <PokerChips amount={table.pot} />
          </div>
          <div className="pkr-board" aria-label={t('Общие карты')}>
            {Array.from({ length: 5 }, (_, i) =>
              table.board[i] ? (
                <PokerCard
                  key={`${table.handNumber}:${i}:${table.board[i]}`}
                  value={table.board[i]}
                  highlight={hand.cards.includes(table.board[i]!)}
                  animate={Boolean(table.lastAction && now - table.lastAction.at < 1800)}
                  delay={(i < 3 ? i : 0) * 100}
                />
              ) : (
                <span className="pkr-card-slot" key={`empty:${i}`}>
                  <Spade size={17} />
                </span>
              ),
            )}
          </div>
          <div className="pkr-hand-outlook" aria-live="polite">
            {ownCards.length && !dealing ? (
              <>
                <span>{t('Ваша комбинация')}</span>
                <strong>{t(hand.name)}</strong>
                {hand.draw && (
                  <small>
                    {hand.draw
                      .split(' · ')
                      .map((x) => t(x))
                      .join(' · ')}
                  </small>
                )}
              </>
            ) : (
              <span>{t(dealing ? 'Перемешиваем и раздаём карты' : stages[table.stage])}</span>
            )}
          </div>
        </div>
        {dealing && (
          <div
            className="pkr-shuffle"
            key={`shuffle:${table.handNumber}`}
            aria-label={t('Перемешиваем карты')}
          >
            <i />
            <i />
            <i />
            <i />
            <span>{t('Новая раздача')}</span>
          </div>
        )}
        <div className="pkr-seats">
          {table.seats.map((id, i) => {
            if (!id) return null;
            const pos = (positions[table.seats.length] ?? positions[6]!)[
              seat >= 0 ? (i - seat + table.seats.length) % table.seats.length : i
            ]!;
            const person = participants.find((p) => p.id === id),
              moving = !settled && table.turn === i && !dealing,
              folded = table.folded.includes(i),
              allIn = table.allIn.includes(i),
              winning = settled && table.payouts[i]! > table.contributions[i]!,
              hole = table.hands.find((h) => h.ownerId === id)?.cards;
            const vector = dealVectors[pos]!;
            return (
              <div
                key={id}
                className={`pkr-seat pkr-pos-${pos} ${i === seat ? 'pkr-own' : ''} ${moving ? 'pkr-seat-turn' : ''} ${folded ? 'pkr-folded' : ''} ${winning ? 'pkr-winning' : ''}`}
                style={{ '--deal-x': vector[0], '--deal-y': vector[1] } as CSSProperties}
              >
                <span className="pkr-seat-number">
                  {t('Место')} {String(i + 1).padStart(2, '0')}
                </span>
                <div className="pkr-player">
                  <PokerAvatar
                    person={person}
                    moving={moving}
                    seconds={seconds}
                    self={i === seat}
                  />
                  <div className="pkr-player-copy">
                    <strong title={playerName(id, participants)}>
                      {playerName(id, participants)}
                      {i === seat && <small>{t('Вы')}</small>}
                    </strong>
                    <span className="pkr-stack">
                      <Coins size={12} />
                      {fmt(table.stacks[i] ?? 0)}
                    </span>
                    <span className="pkr-player-state">
                      {t(
                        folded
                          ? 'Пас'
                          : allIn
                            ? 'Олл-ин'
                            : person?.deafened
                              ? 'Звук выключен'
                              : person?.muted
                                ? 'Микрофон выключен'
                                : person?.speaking
                                  ? 'Говорит'
                                  : 'За столом',
                      )}
                    </span>
                  </div>
                </div>
                <div
                  className="pkr-hole"
                  aria-label={i === seat ? t('Ваши карты') : t('Карты игрока')}
                >
                  {[0, 1].map((n) => (
                    <PokerCard
                      key={`${table.handNumber}:${id}:${n}`}
                      value={hole?.[n]}
                      highlight={i === seat && Boolean(hole?.[n] && hand.cards.includes(hole[n]!))}
                      animate={dealing && !folded}
                      delay={
                        780 +
                        (n * table.seats.length +
                          ((i - small + table.seats.length) % table.seats.length)) *
                          105
                      }
                    />
                  ))}
                </div>
                <div className="pkr-seat-tokens">
                  {table.dealer === i && (
                    <span className="pkr-dealer" title={t('Дилер')}>
                      D
                    </span>
                  )}
                  {small === i && <span className="pkr-blind">SB</span>}
                  {big === i && <span className="pkr-blind">BB</span>}
                  {allIn && !settled && (
                    <span className="pkr-allin" aria-label="ALL IN">
                      <b>ALL</b>
                      <b>IN</b>
                    </span>
                  )}
                </div>
                {moving && seconds !== undefined && (
                  <span className={`pkr-seat-clock ${seconds <= 8 ? 'pkr-urgent' : ''}`}>
                    <Clock3 size={12} />
                    {seconds} {t('сек')}
                  </span>
                )}
                {(table.bets[i] ?? 0) > 0 && !settled && (
                  <div className="pkr-wager" key={`wager:${table.handNumber}:${table.bets[i]}`}>
                    <PokerChips amount={table.bets[i]!} compact />
                    <span>{fmt(table.bets[i]!)}</span>
                  </div>
                )}
                {table.lastAction?.seat === i && now - table.lastAction.at < 2600 && !dealing && (
                  <span
                    className={`pkr-action-bubble pkr-action-${table.lastAction.kind}`}
                    key={`${table.handNumber}:${table.lastAction.sequence}`}
                  >
                    {t(actions[table.lastAction.kind])}
                    {table.lastAction.amount > 0 && ` · ${fmt(table.lastAction.amount)}`}
                  </span>
                )}
                {winning && (
                  <span className="pkr-payout" key={`win:${table.handNumber}:${i}`}>
                    +{fmt(table.payouts[i]! - table.contributions[i]!)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="pkr-turnline" role="status">
        <span className={`pkr-turn-dot ${settled ? 'pkr-turn-done' : ''}`} />
        <strong>
          {t(
            dealing
              ? 'Раздаём карты'
              : settled
                ? 'Раздача завершена'
                : seat === table.turn
                  ? 'Ваш ход'
                  : 'Сейчас ходит',
          )}
          {!dealing &&
            !settled &&
            seat !== table.turn &&
            ` ${playerName(table.seats[table.turn], participants)}`}
        </strong>
        {!settled && !dealing && nextSeat !== undefined && (
          <small>
            {t('Далее')}
            <ChevronRight size={12} />
            {playerName(table.seats[nextSeat], participants)}
          </small>
        )}
        <span className="pkr-turn-order">
          {table.seats.map((id, i) => (
            <i
              key={id ?? i}
              className={`${!settled && i === table.turn ? 'pkr-order-active' : ''} ${table.folded.includes(i) ? 'pkr-order-out' : ''}`}
              title={playerName(id, participants)}
            >
              {i + 1}
            </i>
          ))}
        </span>
      </div>
      {seat >= 0 && !settled && table.phase === 'playing' && table.stacks[seat]! > 0 ? (
        <section
          className={`pkr-decisions ${canAct ? 'pkr-your-decision' : ''}`}
          aria-label={t('Ваше действие')}
        >
          <div className="pkr-action-buttons">
            <button
              type="button"
              className="pkr-fold"
              disabled={!canAct}
              onClick={() => send({ kind: 'poker-bet', action: 'fold' })}
            >
              {t('Пас')}
            </button>
            <button
              type="button"
              className="pkr-call"
              disabled={!canAct}
              onClick={() => send({ kind: 'poker-bet', action: owed ? 'call' : 'check' })}
            >
              {t(owed ? 'Уравнять' : 'Чек')}
              {owed > 0 && <b>{fmt(Math.min(owed, table.stacks[seat]!))}</b>}
            </button>
          </div>
          <div className="pkr-bet-builder">
            <div className="pkr-bet-title">
              <label htmlFor={`poker-amount-${table.id}`}>{t('Общая ставка')}</label>
              <div className="pkr-amount-field">
                <Coins size={14} />
                <input
                  id={`poker-amount-${table.id}`}
                  type="number"
                  aria-label={t('Размер ставки')}
                  min={Math.min(minimum, maximum)}
                  max={maximum}
                  value={value}
                  onChange={(e) => setDraft({ scope, value: e.target.value })}
                />
              </div>
            </div>
            <input
              type="range"
              aria-label={t('Выбрать ставку')}
              min={Math.min(minimum, maximum)}
              max={maximum}
              step={1}
              value={validAmount ? amount : Math.min(minimum, maximum)}
              disabled={!canRaise}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
            <div className="pkr-bet-presets">
              {[
                [t('Мин.'), minimum],
                ['½ ' + t('банка'), table.bet + Math.floor(table.pot / 2)],
                ['2×', Math.max(minimum, table.bet * 2)],
                ['ALL IN', maximum],
              ].map(([label, n]) => (
                <button
                  type="button"
                  key={label}
                  disabled={!canRaise}
                  onClick={() => setAmount(Number(n))}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="pkr-raise"
            aria-label={`${raiseLabel} ${validAmount ? amount : '—'}`}
            disabled={!canAct || !canRaise || !validAmount}
            title={
              canRaise ? undefined : t('Повышение недоступно: можно уравнять или сбросить карты')
            }
            onClick={() => {
              if (canAct && canRaise && validAmount)
                send({ kind: 'poker-bet', action: 'raise', amount });
            }}
          >
            <span>{raiseLabel}</span>
            <b>{validAmount ? fmt(amount) : '—'}</b>
          </button>
        </section>
      ) : (
        <div className="pkr-between-hands">
          {seat < 0 ? (
            <span>
              <Eye size={16} />
              {t('Вы зритель. Закрытые карты игроков не видны.')}
            </span>
          ) : !settled && table.allIn.includes(seat) ? (
            <span>{t('Вы в олл-ине. Ждём вскрытия.')}</span>
          ) : advanced && table.stacks[seat] === 0 ? (
            <>
              <span>
                {t('Фишки закончились')} · {t('Докупки')} {rebuyCount} / 3
              </span>
              <button
                type="button"
                disabled={!canRebuy}
                onClick={() => send({ kind: 'poker-rebuy' })}
              >
                <RotateCcw size={15} />
                {t(rebuyCount >= 3 ? 'Лимит докупок' : 'Докупиться')} {rebuyCount < 3 && '+1 000'}
              </button>
              {!settled && rebuyCount < 3 && <small>{t('Докупка доступна между раздачами')}</small>}
            </>
          ) : (
            <span>{t(settled ? 'Банк распределён' : 'Вы в раздаче')}</span>
          )}
          {settled && selfId === table.hostId && (
            <button
              type="button"
              className="pkr-next-hand"
              disabled={advanced && now < (table.handEndedAt ?? 0) + 1800}
              onClick={() => send({ kind: 'poker-next' })}
            >
              {t('Следующая раздача')}
              <ChevronRight size={15} />
            </button>
          )}
          {table.phase === 'finished' && selfId === table.hostId && (
            <button type="button" onClick={() => send({ kind: 'table-reset' })}>
              {t('Новый стол')}
            </button>
          )}
        </div>
      )}
      <footer className="pkr-footnote">
        <span>
          <Spade size={12} />
          {t('Только виртуальные фишки')}
        </span>
        <span>
          {advanced ? t('30 секунд без ответа — пас') : t('Техасский холдем')}
          {advanced && seat >= 0 && ` · ${t('Докупки')} ${rebuyCount} / 3`}
        </span>
      </footer>
      <aside
        ref={panel}
        className={`pkr-drawer ${drawer ? 'pkr-drawer-open' : ''}`}
        aria-label={t(drawer === 'stats' ? 'Статистика стола' : 'Комбинации покера')}
        aria-hidden={!drawer}
        inert={!drawer}
      >
        <div className="pkr-drawer-header">
          <div>
            <small>TRLKA POKER</small>
            <h3>{t(drawer === 'stats' ? 'Статистика стола' : 'Комбинации покера')}</h3>
          </div>
          <button type="button" aria-label={t('Закрыть')} onClick={() => setDrawer(undefined)}>
            <X size={18} />
          </button>
        </div>
        <div className="pkr-drawer-scroll">
          {drawer === 'stats' ? (
            <>
              <p className="pkr-drawer-note">
                {t(
                  'Только текущий стол. Победа — раздача с прибылью. Докупки не считаются выигрышем.',
                )}
              </p>
              <div className="pkr-stats-head">
                <span>{t('Игрок')}</span>
                <span>{t('Победы')}</span>
                <span>{t('Выиграно')}</span>
                <span>{t('Проиграно')}</span>
              </div>
              {table.seats.map((id, i) => {
                const stats = table.stats?.[i] ?? { hands: 0, wins: 0, won: 0, lost: 0 };
                return id ? (
                  <div className="pkr-stats-row" key={id}>
                    <strong title={playerName(id, participants)}>
                      <i>{i + 1}</i>
                      {playerName(id, participants)}
                    </strong>
                    <span>
                      {stats.hands ? Math.round((stats.wins / stats.hands) * 100) : 0}%
                      <small>
                        {stats.wins} / {stats.hands}
                      </small>
                    </span>
                    <span className="pkr-stat-won">
                      {stats.won ? '+' : ''}
                      {fmt(stats.won)}
                    </span>
                    <span className="pkr-stat-lost">
                      {stats.lost ? '−' : ''}
                      {fmt(stats.lost)}
                    </span>
                  </div>
                ) : null;
              })}
              <p className="pkr-drawer-note">
                {t('Статистика и комбинации не останавливают таймер хода.')}
              </p>
            </>
          ) : (
            <>
              <p className="pkr-drawer-note">
                {t('От младшей к старшей. Лучшая комбинация — пять карт из семи.')}
              </p>
              {pokerCombinations.map(([name, description, cards, strong], i) => (
                <div className="pkr-guide-hand" key={name}>
                  <div>
                    <span>{String(i + 1).padStart(2, '0')}</span>
                    <strong>{t(name)}</strong>
                  </div>
                  <div className="pkr-guide-cards">
                    {cards.map((card, n) => (
                      <span key={card} className={n < strong ? '' : 'pkr-guide-dim'}>
                        <PokerCard value={card} />
                      </span>
                    ))}
                  </div>
                  <p>{t(description)}</p>
                </div>
              ))}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

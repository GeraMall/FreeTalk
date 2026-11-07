import { propertyBoard, housePrice, type TableOf } from '@freetalk/protocol';
import { useState } from 'react';
import { Dices, House, Landmark, ArrowRightLeft } from 'lucide-react';
import { t } from '../lib/app-language';
import { playerName, type TableUiProps } from './activity-table-ui';
const colors = [
  '#ad7861',
  '#8dc5df',
  '#b878a6',
  '#d09d6a',
  '#d37d84',
  '#dbcc79',
  '#88b899',
  '#7e9fd8',
  '#aab7ca',
  '#aab7ca',
];
const position = (i: number) =>
  i <= 10
    ? { gridRow: 11, gridColumn: 11 - i }
    : i <= 20
      ? { gridRow: 21 - i, gridColumn: 1 }
      : i <= 30
        ? { gridRow: 1, gridColumn: i - 19 }
        : { gridRow: i - 29, gridColumn: 11 };
export function ActivityProperty({
  table,
  selfId,
  participants,
  send,
}: TableUiProps<TableOf<'monopoly'>>) {
  const seat = table.seats.indexOf(selfId ?? ''),
    mine = seat === table.turn,
    active = table.phase === 'playing';
  const [selected, setSelected] = useState(0),
    [tradeTo, setTradeTo] = useState(seat === 0 ? 1 : 0),
    [give, setGive] = useState<number[]>([]),
    [want, setWant] = useState<number[]>([]),
    [cash, setCash] = useState(0),
    [showTrade, setShowTrade] = useState(false),
    [confirmBankrupt, setConfirmBankrupt] = useState(false);
  const tile = propertyBoard[selected]!,
    owner = table.owners[selected]!,
    auction = table.auction;
  const own = table.owners.flatMap((o, i) => (o === seat ? [i] : [])),
    other = table.owners.flatMap((o, i) => (o === tradeTo ? [i] : []));
  const toggle = (values: number[], index: number) =>
    values.includes(index) ? values.filter((i) => i !== index) : [...values, index];
  return (
    <div className="property-layout">
      <div
        className="property-board"
        data-activity-surface="property"
        role="group"
        aria-label={t('Поле Монополии')}
      >
        <div className="property-center">
          <Landmark size={38} />
          <h3>{t('Монополия')}</h3>
          <p>{t('Космическая недвижимость')}</p>
          <div className="property-dice">
            {table.dice.map((n, i) => (
              <b key={i}>{n || '—'}</b>
            ))}
          </div>
          <strong>
            {table.phase === 'finished'
              ? `${t('Победитель')}: ${playerName(table.winner, participants)}`
              : `${t('Ход')}: ${playerName(table.seats[table.turn], participants)}`}
          </strong>
          <small>
            {table.extraRoll ? t('Дубль · ещё один бросок') : t('За прохождение старта: +200')}
          </small>
        </div>
        {propertyBoard.map(([name, price, group], i) => (
          <button
            type="button"
            key={i}
            className={`property-cell ${selected === i ? 'selected' : ''} ${table.mortgaged.includes(i) ? 'is-mortgaged' : ''}`}
            style={{ ...position(i), borderTopColor: group >= 0 ? colors[group] : undefined }}
            onClick={() => setSelected(i)}
            aria-label={`${name}${price ? ' ' + price : ''}`}
          >
            <span>{name}</span>
            {table.houses[i]! > 0 ? (
              <small>{table.houses[i] === 5 ? '▰' : '⌂'.repeat(table.houses[i]!)}</small>
            ) : (
              <small>{price || '◆'}</small>
            )}
            <div className="property-tokens">
              {table.seats.map((id, seatIndex) =>
                id && table.positions[seatIndex] === i && !table.bankrupt.includes(seatIndex) ? (
                  <i
                    key={id}
                    className={`player-color-${seatIndex}`}
                    title={playerName(id, participants)}
                  >
                    {seatIndex + 1}
                  </i>
                ) : null,
              )}
            </div>
            {table.owners[i]! >= 0 && (
              <b className={`property-owner player-color-${table.owners[i]}`} />
            )}
          </button>
        ))}
      </div>
      <aside className="property-sidebar">
        <div className="property-players">
          {table.seats.map((id, i) => (
            <div
              key={id}
              className={`${table.turn === i ? 'is-moving' : ''} ${table.bankrupt.includes(i) ? 'is-folded' : ''}`}
            >
              <i className={`player-color-${i}`}>{i + 1}</i>
              <strong>
                {playerName(id, participants)}
                <small>
                  {table.jail[i]
                    ? t('В тюрьме')
                    : table.bankrupt.includes(i)
                      ? t('Банкрот')
                      : i === seat
                        ? t('Вы')
                        : ''}
                </small>
              </strong>
              <b>{table.money[i]} ¤</b>
            </div>
          ))}
        </div>
        {auction ? (
          <div className="property-auction">
            <h4>
              {t('Аукцион')}: {propertyBoard[auction.index]![0]}
            </h4>
            <p>
              {t('Текущая ставка')}: {auction.bid} ¤
            </p>
            <p>
              {t('Ход')}: {playerName(table.seats[auction.turn], participants)}
            </p>
            {auction.turn === seat && (
              <div className="table-inline-controls">
                <button
                  type="button"
                  disabled={table.money[seat]! < auction.bid + 10}
                  onClick={() => send({ kind: 'property', action: 'bid' })}
                >
                  +10 ¤
                </button>
                <button
                  type="button"
                  onClick={() => send({ kind: 'property', action: 'auction-pass' })}
                >
                  {t('Пас')}
                </button>
              </div>
            )}
          </div>
        ) : mine && active ? (
          <div className="property-actions">
            {table.step === 'roll' && (
              <>
                <button
                  type="button"
                  className="table-primary"
                  onClick={() => send({ kind: 'property', action: 'roll' })}
                >
                  <Dices size={18} />
                  {t('Бросить кубики')}
                </button>
                {table.jail[seat]! > 0 && (
                  <button
                    type="button"
                    disabled={table.money[seat]! < 50}
                    onClick={() => send({ kind: 'property', action: 'jail-pay' })}
                  >
                    {t('Выйти под залог')} · 50 ¤
                  </button>
                )}
              </>
            )}
            {table.step === 'buy' && (
              <>
                <strong>{propertyBoard[table.positions[seat]!]![0]}</strong>
                <button
                  type="button"
                  className="table-primary"
                  disabled={table.money[seat]! < propertyBoard[table.positions[seat]!]![1]}
                  onClick={() => send({ kind: 'property', action: 'buy' })}
                >
                  {t('Купить')} · {propertyBoard[table.positions[seat]!]![1]} ¤
                </button>
                <button type="button" onClick={() => send({ kind: 'property', action: 'pass' })}>
                  {t('Выставить на аукцион')}
                </button>
              </>
            )}
            {table.step === 'end' && (
              <button
                type="button"
                className="table-primary"
                onClick={() => send({ kind: 'property', action: 'end' })}
              >
                {table.extraRoll ? t('Бросить ещё раз') : t('Завершить ход')}
              </button>
            )}
            {table.step === 'debt' && (
              <p className="table-danger">
                {t(
                  'Недостаточно средств. Продайте дома, заложите участки или объявите банкротство.',
                )}
              </p>
            )}
          </div>
        ) : null}
        <div
          className="property-deed"
          style={{ borderTopColor: tile[2] >= 0 ? colors[tile[2]] : undefined }}
        >
          <h4>{tile[0]}</h4>
          <p>
            {t('Стоимость')}: {tile[1]} ¤
          </p>
          <p>
            {t('Владелец')}: {owner < 0 ? t('Банк') : playerName(table.seats[owner], participants)}
          </p>
          {table.houses[selected]! > 0 && (
            <p>
              {t('Постройки')}: {table.houses[selected]}
            </p>
          )}
          {owner === seat && seat >= 0 && active && (
            <div className="property-deed-actions">
              <button
                type="button"
                disabled={tile[2] < 0 || tile[2] > 7}
                onClick={() => send({ kind: 'property', action: 'build', index: selected })}
              >
                <House size={14} />
                {t('Построить')} · {housePrice(selected)} ¤
              </button>
              <button
                type="button"
                disabled={!table.houses[selected]}
                onClick={() => send({ kind: 'property', action: 'sell-house', index: selected })}
              >
                {t('Продать постройку')}
              </button>
              <button
                type="button"
                onClick={() => send({ kind: 'property', action: 'mortgage', index: selected })}
              >
                {t(table.mortgaged.includes(selected) ? 'Выкупить залог' : 'Заложить')}
              </button>
            </div>
          )}
        </div>
        {seat >= 0 && active && !table.bankrupt.includes(seat) && (
          <>
            <button type="button" onClick={() => setShowTrade(!showTrade)}>
              <ArrowRightLeft size={15} />
              {t('Предложить обмен')}
            </button>
            {showTrade && (
              <div className="property-trade">
                <select
                  aria-label={t('Кому предложить обмен')}
                  value={tradeTo}
                  onChange={(e) => {
                    setTradeTo(Number(e.target.value));
                    setWant([]);
                  }}
                >
                  {table.seats.map((id, i) =>
                    i !== seat && !table.bankrupt.includes(i) ? (
                      <option key={id} value={i}>
                        {playerName(id, participants)}
                      </option>
                    ) : null,
                  )}
                </select>
                <small>{t('Вы отдаёте')}</small>
                {own.map((i) => (
                  <label key={i}>
                    <input
                      type="checkbox"
                      checked={give.includes(i)}
                      onChange={() => setGive(toggle(give, i))}
                    />
                    {propertyBoard[i]![0]}
                  </label>
                ))}
                <small>{t('Вы получаете')}</small>
                {other.map((i) => (
                  <label key={i}>
                    <input
                      type="checkbox"
                      checked={want.includes(i)}
                      onChange={() => setWant(toggle(want, i))}
                    />
                    {propertyBoard[i]![0]}
                  </label>
                ))}
                <label>
                  {t('Доплата от вас / вам')}
                  <input
                    type="number"
                    min={-10000}
                    max={10000}
                    value={cash}
                    onChange={(e) => setCash(Number(e.target.value))}
                  />
                </label>
                <button
                  type="button"
                  disabled={Boolean(table.trade) || tradeTo === seat}
                  onClick={() => {
                    send({ kind: 'property-trade', to: tradeTo, give, want, cash });
                    setShowTrade(false);
                  }}
                >
                  {t('Отправить предложение')}
                </button>
              </div>
            )}
            {mine && (
              <button
                type="button"
                className="table-danger"
                onClick={() =>
                  confirmBankrupt
                    ? send({ kind: 'property', action: 'bankrupt' })
                    : setConfirmBankrupt(true)
                }
              >
                {confirmBankrupt ? t('Подтвердить банкротство') : t('Объявить банкротство')}
              </button>
            )}
          </>
        )}
        {table.trade && (
          <div className="property-trade-offer">
            <h4>{t('Предложение обмена')}</h4>
            <p>
              {playerName(table.seats[table.trade.from], participants)} →{' '}
              {playerName(table.seats[table.trade.to], participants)}
            </p>
            <p>
              {t('Отдаёт')}: {table.trade.give.map((i) => propertyBoard[i]![0]).join(', ') || '—'}
            </p>
            <p>
              {t('Просит')}: {table.trade.want.map((i) => propertyBoard[i]![0]).join(', ') || '—'}
            </p>
            <p>
              {t('Доплата')}: {table.trade.cash} ¤
            </p>
            {table.trade.to === seat && (
              <div className="table-inline-controls">
                <button
                  type="button"
                  onClick={() => send({ kind: 'property-trade-answer', accept: true })}
                >
                  {t('Принять')}
                </button>
                <button
                  type="button"
                  onClick={() => send({ kind: 'property-trade-answer', accept: false })}
                >
                  {t('Отклонить')}
                </button>
              </div>
            )}
          </div>
        )}
        {table.phase === 'finished' && selfId === table.hostId && (
          <button
            type="button"
            className="table-primary"
            onClick={() => send({ kind: 'table-reset' })}
          >
            {t('Новая партия')}
          </button>
        )}
        <div className="table-event-log">
          {table.log.slice(-5).map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      </aside>
    </div>
  );
}

import { propertyBuildingStock, propertyLiquidation, type TableOf } from '@freetalk/protocol';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  Landmark,
  Dices,
  ArrowRightLeft,
  Volume2,
  VolumeX,
  BookOpen,
  Crown,
  X,
  RotateCcw,
} from 'lucide-react';
import { t } from '../lib/app-language';
import { playerName, type TableUiProps } from './activity-table-ui';
import { PokerAvatar } from './PokerVisuals';
import { PropertyBoard } from './PropertyBoard';
import { propertyBoard, propertyLog, propertyColors, playerColors } from '../lib/monopoly-layout';
import { PropertyDice } from './PropertyDice';
import { PropertyDeed, PropertyModal, PropertyTrade } from './PropertyCards';
import { MonopolySounds } from '../lib/monopoly-sounds';
import './monopoly.css';
const heard = new Set<string>();
export function ActivityProperty({
  table,
  selfId,
  participants,
  send,
  onExit,
}: TableUiProps<TableOf<'monopoly'>> & { onExit?(): void }) {
  const seat = table.seats.indexOf(selfId ?? ''),
    mine = seat === table.turn,
    active = table.phase === 'playing';
  const [now, setNow] = useState(Date.now),
    [selected, setSelected] = useState(0),
    [panel, setPanel] = useState<'deed' | 'trade' | 'card' | 'bankrupt' | 'rules'>(),
    [portfolio, setPortfolio] = useState<number>(),
    [pending, setPending] = useState(0),
    [audioOn, setAudioOn] = useState(() => {
      try {
        return localStorage.getItem('trlka.monopoly.sounds') !== 'off';
      } catch {
        return true;
      }
    });
  const [audio] = useState(() => new MonopolySounds()),
    cardSeen = useRef(table.lastCard?.sequence ?? 0),
    previous = useRef(table),
    waitingWin = useRef(false);
  const move = table.lastMove,
    busy = now < (move?.until ?? 0),
    rolling = pending > 0 || (!!move && move.roll !== false && now < move.at + 900);
  const canRoll =
    active &&
    mine &&
    table.step === 'roll' &&
    !table.auction &&
    !busy &&
    !pending &&
    !table.bankrupt.includes(seat);
  const progress = move
    ? Math.max(
        0,
        Math.min(
          move.path.length,
          Math.floor((now - move.at - (move.roll === false ? 0 : 900)) / 110) + 1,
        ),
      )
    : 0;
  const positions = table.positions.map((p, i) =>
    move && i === move.seat && busy ? (progress ? move.path[progress - 1]! : move.from) : p,
  );
  const ownerToShow = portfolio ?? (seat >= 0 ? seat : table.turn),
    own = table.owners.flatMap((owner, i) => (owner === ownerToShow ? [i] : [])),
    stock = propertyBuildingStock(table);
  useEffect(() => {
    audio.enabled = audioOn && !participants.find((p) => p.id === selfId)?.deafened;
    if (!audio.enabled) audio.stop();
  }, [audio, audioOn, participants, selfId]);
  useEffect(() => () => audio.stop(), [audio]);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    refresh();
    if (!move || Date.now() >= move.until) return;
    const timer = setInterval(refresh, 25);
    return () => clearInterval(timer);
  }, [move]);
  useEffect(() => {
    setPending(0);
  }, [move?.sequence]);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setPending(0), 3500);
    return () => clearTimeout(timer);
  }, [pending]);
  useEffect(() => {
    const once = (key: string, sound: Parameters<MonopolySounds['play']>[0]) => {
      if (heard.has(key)) return;
      heard.add(key);
      if (heard.size > 512) heard.delete(heard.values().next().value!);
      void audio.play(sound);
    };
    if (move && move.roll !== false && now - move.at < 900)
      once(`${table.id}:${move.sequence}:roll`, 'roll');
    if (move && progress > 0 && busy) once(`${table.id}:${move.sequence}:step:${progress}`, 'step');
    if (previous.current.phase === 'playing' && table.phase === 'finished')
      waitingWin.current = true;
    if (waitingWin.current && !busy) {
      once(`${table.id}:win`, 'win');
      waitingWin.current = false;
    }
    if (
      previous.current.id === table.id &&
      (previous.current.owners.some((o, i) => o !== table.owners[i]) ||
        previous.current.houses.some((o, i) => o !== table.houses[i]))
    )
      void audio.play('buy');
    previous.current = table;
  }, [table, move, now, progress, busy, audio]);
  useEffect(() => {
    if (table.lastCard && table.lastCard.sequence !== cardSeen.current && !busy) {
      cardSeen.current = table.lastCard.sequence;
      setPanel('card');
      void audio.play('card');
    }
  }, [table.lastCard, busy, audio]);
  const roll = () => {
    if (!canRoll) return;
    setPending(Date.now());
    send({ kind: 'property', action: 'roll' });
  };
  const deed = (i: number) => {
    setSelected(i);
    setPanel('deed');
  };
  const action = (name: 'buy' | 'pass' | 'end' | 'bid' | 'auction-pass' | 'jail-pay') =>
    send({ kind: 'property', action: name });
  return (
    <section className="mono-game" aria-label={t('Монополия')}>
      <header className="mono-heading">
        <span className="mono-brand">
          <Landmark />
        </span>
        <div>
          <h3>{t('Монополия')}</h3>
          <small>{table.training ? t('Тренировка · без статистики') : t('Улицы Москвы')}</small>
        </div>
        <span className="mono-turn-label">
          {t('Ход')}: <b>{playerName(table.seats[table.turn], participants)}</b>
        </span>
        <div className="mono-heading-buttons">
          <button
            type="button"
            aria-label={t(audioOn ? 'Выключить звуки игры' : 'Включить звуки игры')}
            aria-pressed={audioOn}
            onClick={() => {
              setAudioOn(!audioOn);
              try {
                localStorage.setItem('trlka.monopoly.sounds', audioOn ? 'off' : 'on');
              } catch {
                /* Keep the current session preference. */
              }
            }}
          >
            {audioOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <button
            type="button"
            aria-label={t('Правила Монополии')}
            onClick={() => setPanel('rules')}
          >
            <BookOpen size={18} />
          </button>
        </div>
      </header>
      <div className="mono-players">
        {table.seats.map((id, i) => (
          <button
            type="button"
            key={id}
            style={{ '--seat-color': playerColors[i] } as CSSProperties}
            className={`${table.turn === i ? 'is-turn' : ''} ${table.bankrupt.includes(i) ? 'is-bankrupt' : ''}`}
            onClick={() => setPortfolio(i)}
            aria-label={`${playerName(id, participants)}: ${table.money[i]} ¤`}
          >
            <PokerAvatar
              person={participants.find((p) => p.id === id)}
              moving={false}
              self={i === seat}
            />
            <span>
              <strong>{playerName(id, participants)}</strong>
              <b>{table.bankrupt.includes(i) ? t('Банкрот') : `${table.money[i]} ¤`}</b>
            </span>
            {table.jail[i]! > 0 && <small>{t('Тюрьма')}</small>}
          </button>
        ))}
      </div>
      <div className="mono-main">
        <PropertyBoard
          table={table}
          positions={positions}
          motion={
            move && busy && progress > 0
              ? { seat: move.seat, sequence: move.sequence, step: progress }
              : undefined
          }
          participants={participants}
          onSelect={deed}
        >
          <span className="mono-center-mark">
            <Landmark size={23} /> TRLKA
          </span>
          <PropertyDice
            dice={table.dice}
            rolling={rolling}
            sequence={move?.sequence ?? 0}
            startAt={pending ? undefined : move?.at}
            canRoll={canRoll}
            onRoll={roll}
            onShake={() => void audio.play('shake')}
            onImpact={() => void audio.play('shake')}
          />
          <p className="mono-center-caption">
            {t(table.extraRoll ? 'Дубль · ещё один бросок' : 'За прохождение старта: +200')}
          </p>
          {table.lastCard && (
            <button
              type="button"
              className="mono-last-card"
              onClick={() => {
                setPanel('card');
                void audio.play('card');
              }}
            >
              {t(table.lastCard.kind === 'chance' ? 'Шанс' : 'Событие')} · {t('Прочитать карточку')}
            </button>
          )}
        </PropertyBoard>
        <aside className="mono-control-panel">
          <div className="mono-current-player">
            <small>{t(busy ? 'Фишка движется' : mine ? 'Ваш ход' : 'Сейчас ходит')}</small>
            <strong>{playerName(table.seats[table.turn], participants)}</strong>
          </div>
          {table.auction ? (
            <section className="mono-auction">
              <h4>{t('Аукцион')}</h4>
              <button
                type="button"
                className="mono-property-link"
                onClick={() => deed(table.auction!.index)}
              >
                {t(propertyBoard[table.auction.index]![0])}
              </button>
              <b>{table.auction.bid} ¤</b>
              <p>{playerName(table.seats[table.auction.turn], participants)}</p>
              {table.auction.turn === seat && (
                <div className="mono-buttons">
                  <button
                    type="button"
                    disabled={busy || table.money[seat]! < table.auction.bid + 10}
                    onClick={() => action('bid')}
                  >
                    +10 ¤
                  </button>
                  <button type="button" disabled={busy} onClick={() => action('auction-pass')}>
                    {t('Пас')}
                  </button>
                </div>
              )}
            </section>
          ) : active && mine ? (
            <div className="mono-actions">
              {table.step === 'roll' && (
                <>
                  <button type="button" className="mono-primary" disabled={!canRoll} onClick={roll}>
                    <Dices size={19} />
                    {t(rolling ? 'Бросаем…' : 'Бросить кубики')}
                  </button>
                  {table.jail[seat]! > 0 && (
                    <button
                      type="button"
                      disabled={busy || pending > 0 || table.money[seat]! < 50}
                      onClick={() => action('jail-pay')}
                    >
                      {t('Выйти под залог')} · 50 ¤
                    </button>
                  )}
                </>
              )}
              {table.step === 'buy' && (
                <>
                  <button
                    type="button"
                    className="mono-property-link"
                    onClick={() => deed(table.positions[seat]!)}
                  >
                    {t(propertyBoard[table.positions[seat]!]![0])}
                  </button>
                  <button
                    type="button"
                    className="mono-primary"
                    disabled={
                      busy || table.money[seat]! < propertyBoard[table.positions[seat]!]![1]
                    }
                    onClick={() => action('buy')}
                  >
                    {t('Купить')} · {propertyBoard[table.positions[seat]!]![1]} ¤
                  </button>
                  <button type="button" disabled={busy} onClick={() => action('pass')}>
                    {t('Выставить на аукцион')}
                  </button>
                </>
              )}
              {table.step === 'end' && (
                <button
                  type="button"
                  className="mono-primary"
                  disabled={busy}
                  onClick={() => action('end')}
                >
                  {t(table.extraRoll ? 'Бросить ещё раз' : 'Завершить ход')}
                </button>
              )}
              {table.step === 'debt' && (
                <div className="mono-debt">
                  <strong>
                    {t('Нужно погасить долг')}: {Math.abs(table.money[seat]!)} ¤
                  </strong>
                  <p>
                    {t('Продажа построек и залог могут дать')}: {propertyLiquidation(table, seat)} ¤
                  </p>
                  <small>{t('Нажмите на карточку собственности внизу, чтобы управлять ею.')}</small>
                </div>
              )}
            </div>
          ) : (
            <p className="mono-waiting">
              {t(
                table.phase === 'finished'
                  ? 'Партия завершена'
                  : 'Можно изучить улицы и собственность игроков, пока вы ждёте ход.',
              )}
            </p>
          )}
          {table.trade && (
            <button type="button" className="mono-primary" onClick={() => setPanel('trade')}>
              {t('Предложение обмена')}
            </button>
          )}
          <div className="mono-management">
            <button
              type="button"
              disabled={
                !active ||
                seat < 0 ||
                table.bankrupt.includes(seat) ||
                busy ||
                !!table.trade ||
                table.step === 'debt'
              }
              onClick={() => setPanel('trade')}
            >
              <ArrowRightLeft size={16} />
              {t('Обмен')}
            </button>
            {mine && active && (
              <button
                type="button"
                className="mono-danger"
                disabled={busy}
                onClick={() => setPanel('bankrupt')}
              >
                {t('Банкротство')}
              </button>
            )}
          </div>
          <div className="mono-bank-stock">
            <span>
              {t('Дома')}: <b>{stock.houses}/32</b>
            </span>
            <span>
              {t('Отели')}: <b>{stock.hotels}/12</b>
            </span>
          </div>
          <p className="mono-last-log" title={propertyLog(table.log.at(-1))}>
            {propertyLog(table.log.at(-1))}
          </p>
        </aside>
      </div>
      <footer className="mono-portfolio">
        <header>
          <strong>
            {t(ownerToShow === seat ? 'Ваши улицы' : 'Собственность')}
            {ownerToShow !== seat && ` · ${playerName(table.seats[ownerToShow], participants)}`}
          </strong>
          <small>{own.length} / 28</small>
        </header>
        <div className="mono-property-rack">
          {own.map((i) => (
            <button
              type="button"
              key={i}
              className={table.mortgaged.includes(i) ? 'is-mortgaged' : ''}
              style={{ '--group-color': propertyColors[propertyBoard[i]![2]] } as CSSProperties}
              onClick={() => deed(i)}
            >
              <i />
              <strong>{t(propertyBoard[i]![0])}</strong>
              <small>
                {table.mortgaged.includes(i)
                  ? t('В залоге')
                  : table.houses[i] === 5
                    ? t('Отель')
                    : table.houses[i]! > 0
                      ? `${table.houses[i]} ${t('дома')}`
                      : `${propertyBoard[i]![1]} ¤`}
              </small>
            </button>
          ))}
          {!own.length && (
            <p>
              {t(
                'Здесь появятся купленные улицы. Нажмите на клетку поля, чтобы прочитать её карточку.',
              )}
            </p>
          )}
        </div>
      </footer>
      {panel === 'deed' && (
        <PropertyDeed
          table={table}
          selfId={selfId}
          participants={participants}
          send={send}
          index={selected}
          onClose={() => setPanel(undefined)}
        />
      )}
      {panel === 'trade' && (
        <PropertyTrade
          table={table}
          selfId={selfId}
          participants={participants}
          send={send}
          onClose={() => setPanel(undefined)}
        />
      )}
      {panel === 'card' && table.lastCard && (
        <PropertyModal
          title={t(table.lastCard.kind === 'chance' ? 'Шанс' : 'Событие')}
          onClose={() => setPanel(undefined)}
        >
          <article className="mono-chance-card">
            <Landmark size={35} />
            <small>TRLKA · {t('Карточка')}</small>
            <h2>{t(table.lastCard.title)}</h2>
            <p>{t(table.lastCard.text)}</p>
            <button type="button" className="mono-primary" onClick={() => setPanel(undefined)}>
              {t('Понятно')}
            </button>
          </article>
        </PropertyModal>
      )}
      {panel === 'bankrupt' && (
        <PropertyModal title={t('Объявить банкротство?')} onClose={() => setPanel(undefined)}>
          <p className="mono-modal-copy">
            {t(
              'Вы выйдете из партии. Постройки будут проданы, а собственность получит кредитор или банк.',
            )}
          </p>
          <div className="mono-buttons">
            <button
              type="button"
              className="mono-danger"
              onClick={() => {
                send({ kind: 'property', action: 'bankrupt' });
                setPanel(undefined);
              }}
            >
              {t('Подтвердить банкротство')}
            </button>
            <button type="button" onClick={() => setPanel(undefined)}>
              {t('Отмена')}
            </button>
          </div>
        </PropertyModal>
      )}
      {panel === 'rules' && (
        <PropertyModal title={t('Правила Монополии')} onClose={() => setPanel(undefined)}>
          <div className="mono-rules">
            <p>
              {t(
                'Соберите все улицы цвета, чтобы строить равномерно: максимум четыре дома, затем один отель на улице.',
              )}
            </p>
            <p>
              {t(
                'Запас банка: 32 дома и 12 отелей. Отель возвращает четыре дома в банк. Для продажи отеля обратно в четыре дома в банке должны быть свободные дома.',
              )}
            </p>
            <p>
              {t(
                'Постройки продаются за половину цены. Залог — половина цены улицы, выкуп залога — сумма залога плюс 10%.',
              )}
            </p>
            <p>
              {t(
                'Если даже продажа всех построек и залог всей собственности не покрывают долг, банкротство определяется автоматически.',
              )}
            </p>
            <p>
              {t(
                'Кубики бросает сервер. Встряхивание меняет анимацию, но не позволяет выбрать результат.',
              )}
            </p>
          </div>
        </PropertyModal>
      )}
      {table.phase === 'finished' && !busy && !panel && (
        <div className="mono-win-overlay">
          <section className="mono-win">
            <Crown className="mono-win-crown" size={45} />
            <PokerAvatar
              person={participants.find((p) => p.id === table.winner)}
              moving={false}
              self={table.winner === selfId}
            />
            <small>{t('Победитель')}</small>
            <h2>{playerName(table.winner, participants)}</h2>
            <p>{t('Последний владелец империи. Отличная партия!')}</p>
            <div className="mono-buttons">
              {selfId === table.hostId && (
                <button
                  type="button"
                  className="mono-primary"
                  onClick={() => send({ kind: 'table-reset' })}
                >
                  <RotateCcw size={17} />
                  {t('Новая партия')}
                </button>
              )}
              <button type="button" onClick={onExit}>
                <X size={17} />
                {t('К играм')}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

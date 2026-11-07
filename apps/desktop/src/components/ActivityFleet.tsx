import { randomFleet, validFleet, type TableOf } from '@freetalk/protocol';
import { useEffect, useState } from 'react';
import { RotateCw, Shuffle, Check, Flag } from 'lucide-react';
import { t } from '../lib/app-language';
import { ActivityTableLobby } from './ActivityTableLobby';
import { playerName, type TableUiProps } from './activity-table-ui';
const sizes = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];
function splitFleet(cells: number[]) {
  const remaining = new Set(cells),
    groups: number[][] = [];
  while (remaining.size) {
    const first = remaining.values().next().value!,
      group = [first];
    remaining.delete(first);
    for (const i of group)
      for (const n of [i - 10, i + 10, ...(i % 10 ? [i - 1] : []), ...(i % 10 < 9 ? [i + 1] : [])])
        if (remaining.delete(n)) group.push(n);
    groups.push(group);
  }
  return groups.sort((a, b) => b.length - a.length);
}
export function ActivityFleet(props: TableUiProps<TableOf<'fleet'>>) {
  const { table, selfId, participants, send } = props,
    seat = table.seats.indexOf(selfId ?? '');
  const own = table.boards.find((b) => b.ownerId === selfId),
    ready = table.ready.includes(selfId ?? '');
  const [placements, setPlacements] = useState<number[][]>(() => sizes.map(() => [])),
    [selected, setSelected] = useState(0),
    [vertical, setVertical] = useState(false),
    [pending, setPending] = useState(false);
  const cells = placements.flat(),
    valid = validFleet(cells);
  useEffect(() => {
    setPlacements(sizes.map(() => []));
    setSelected(0);
    setPending(false);
  }, [table.id, seat]);
  useEffect(() => {
    if (
      pending &&
      own &&
      cells.length === 20 &&
      own.cells.filter((c) => c === 2).length === 20 &&
      cells.every((i) => own.cells[i] === 2)
    ) {
      setPending(false);
      send({ kind: 'fleet-ready' });
    }
  }, [pending, own, cells, send]);
  const grid = (ownerId: string, index: number, setup = false) => {
    const board = table.boards.find((b) => b.ownerId === ownerId),
      mine = ownerId === selfId,
      canShoot = table.phase === 'playing' && seat === table.turn && !mine && seat >= 0;
    return (
      <section className="fleet-field" key={ownerId}>
        <h4>
          {playerName(ownerId, participants)}
          {table.phase === 'playing' && table.turn === index && <small>{t('Ходит')}</small>}
          {table.ready.includes(ownerId) && table.phase === 'lobby' && <Check size={15} />}
        </h4>
        <div
          className="fleet-board"
          role="group"
          aria-label={mine ? t('Ваше поле') : t('Поле соперника')}
        >
          {Array.from({ length: 100 }, (_, i) => {
            const cell = setup ? (cells.includes(i) ? 2 : -1) : (board?.cells[i] ?? -1);
            return (
              <button
                type="button"
                key={i}
                className={`fleet-cell cell-${cell}`}
                aria-label={`${String.fromCharCode(65 + (i % 10))}${Math.floor(i / 10) + 1}${cell === 2 ? ' ' + t('Корабль') : cell === 1 ? ' ' + t('Попадание') : cell === 0 ? ' ' + t('Мимо') : ''}`}
                disabled={setup ? ready : !canShoot || cell !== -1}
                onClick={() => {
                  if (!setup) {
                    send({ kind: 'fleet-shot', index: i });
                    return;
                  }
                  const size = sizes[selected]!,
                    step = vertical ? 10 : 1;
                  if ((vertical ? Math.floor(i / 10) : i % 10) + size > 10) return;
                  const group = Array.from({ length: size }, (_, n) => i + n * step),
                    others = placements.filter((_, n) => n !== selected).flat();
                  if (
                    group.some((c) =>
                      others.some(
                        (p) =>
                          Math.abs((c % 10) - (p % 10)) <= 1 &&
                          Math.abs(Math.floor(c / 10) - Math.floor(p / 10)) <= 1,
                      ),
                    )
                  )
                    return;
                  const next = placements.map((old, n) => (n === selected ? group : old));
                  setPlacements(next);
                  const unplaced = next.findIndex((a) => !a.length);
                  if (unplaced >= 0) setSelected(unplaced);
                }}
              >
                {cell === 1 || cell === 3 ? '×' : cell === 0 ? '·' : ''}
              </button>
            );
          })}
        </div>
      </section>
    );
  };
  if (table.phase === 'lobby')
    return (
      <ActivityTableLobby {...props}>
        {seat >= 0 && (
          <div className="fleet-setup">
            <div>
              <h4>{t('Расставьте корабли')}</h4>
              <p className="table-muted">
                {t('Выберите корабль, затем клетку. Корабли не должны соприкасаться.')}
              </p>
              <div className="fleet-ship-list">
                {sizes.map((size, i) => (
                  <button
                    type="button"
                    key={i}
                    disabled={ready}
                    aria-label={`${t('Корабль')} ${i + 1}`}
                    aria-pressed={selected === i}
                    onClick={() => setSelected(i)}
                  >
                    {Array.from({ length: size }, (_, n) => (
                      <i key={n} />
                    ))}
                    {placements[i]!.length > 0 && <Check size={12} />}
                  </button>
                ))}
              </div>
              <div className="table-inline-controls">
                <button type="button" disabled={ready} onClick={() => setVertical(!vertical)}>
                  <RotateCw size={15} />
                  {t(vertical ? 'Вертикально' : 'Горизонтально')}
                </button>
                <button
                  type="button"
                  disabled={ready}
                  onClick={() => setPlacements(splitFleet(randomFleet()))}
                >
                  <Shuffle size={15} />
                  {t('Авторасстановка')}
                </button>
              </div>
              <button
                type="button"
                className="table-primary"
                disabled={!valid || ready || pending}
                onClick={() => {
                  setPending(true);
                  send({ kind: 'fleet-place', cells });
                }}
              >
                {ready
                  ? t('Готово · ждём соперника')
                  : pending
                    ? t('Сохраняем расстановку…')
                    : t('Готов к бою')}
              </button>
              <p className="table-muted">{t('Курсоры скрыты, чтобы не раскрывать расстановку.')}</p>
            </div>
            {grid(selfId!, seat, true)}
          </div>
        )}
        {seat < 0 && (
          <p className="table-muted">
            {t('Вы зритель. Поля откроются после готовности двух игроков.')}
          </p>
        )}
      </ActivityTableLobby>
    );
  return (
    <div className="fleet-match">
      <div className="table-status" role="status">
        {table.phase === 'finished'
          ? `${t('Победитель')}: ${playerName(table.winner, participants)}`
          : `${t('Ход')}: ${playerName(table.seats[table.turn], participants)}`}
      </div>
      <p className="table-muted">
        {seat < 0
          ? t('Режим зрителя: видны оба поля, стрелять могут только игроки.')
          : t('Попадание даёт ещё один выстрел. Чужие корабли скрыты.')}
      </p>
      <div className="fleet-fields">
        {(seat === 1 ? [1, 0] : [0, 1]).map((i) => grid(table.seats[i]!, i))}
      </div>
      <div className="table-inline-controls">
        {seat >= 0 && table.phase === 'playing' && (
          <button
            type="button"
            className="table-danger"
            onClick={() => send({ kind: 'table-resign' })}
          >
            <Flag size={15} />
            {t('Сдаться')}
          </button>
        )}
        {selfId === table.hostId && table.phase === 'finished' && (
          <button
            type="button"
            className="table-primary"
            onClick={() => send({ kind: 'table-reset' })}
          >
            {t('Новая партия')}
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

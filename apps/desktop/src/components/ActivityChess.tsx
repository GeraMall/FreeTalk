import { Chess, type TableOf } from '@freetalk/protocol';
import { useEffect, useMemo, useState } from 'react';
import { Flag, Handshake } from 'lucide-react';
import { t } from '../lib/app-language';
import { playerName, type TableUiProps } from './activity-table-ui';
const glyphs: Record<string, string> = {
  k: '♚',
  q: '♛',
  r: '♜',
  b: '♝',
  n: '♞',
  p: '♟',
  K: '♚',
  Q: '♛',
  R: '♜',
  B: '♝',
  N: '♞',
  P: '♟',
};
const square = (index: number) => `${'abcdefgh'[index % 8]}${8 - Math.floor(index / 8)}`;
const format = (ms: number) =>
  `${Math.floor(Math.max(0, ms) / 60000)}:${String(Math.floor(Math.max(0, ms) / 1000) % 60).padStart(2, '0')}`;
export function ActivityChess({
  table,
  selfId,
  participants,
  send,
}: TableUiProps<TableOf<'chess'>>) {
  const [selected, setSelected] = useState<string>(),
    [promotion, setPromotion] = useState<'q' | 'r' | 'b' | 'n'>('q'),
    [now, setNow] = useState(Date.now),
    [resign, setResign] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => setSelected(undefined), [table.fen]);
  const chess = useMemo(() => new Chess(table.fen), [table.fen]);
  const legal = useMemo(
    () =>
      selected ? chess.moves({ square: selected as 'a1', verbose: true }).map((m) => m.to) : [],
    [chess, selected],
  );
  const turn = chess.turn() === 'w' ? 0 : 1,
    seat = table.seats.indexOf(selfId ?? ''),
    flipped = seat === 1;
  const indices = Array.from({ length: 64 }, (_, i) => (flipped ? 63 - i : i));
  const running = table.phase === 'playing',
    canMove = running && seat === turn;
  const remaining = (side: number) =>
    table.clocks[side as 0 | 1] - (running && side === turn ? now - table.turnAt : 0);
  const player = (side: number) => (
    <div className={`chess-player ${side === turn && running ? 'is-moving' : ''}`}>
      <span className="chess-color">{side === 0 ? '♔' : '♚'}</span>
      <div>
        <strong>{playerName(table.seats[side], participants)}</strong>
        <small>
          {side === seat
            ? t('Вы')
            : side === turn && running
              ? t('Сейчас ходит')
              : t(side === 0 ? 'Белые' : 'Чёрные')}
        </small>
      </div>
      <time className={remaining(side) < 30000 && table.preset !== 'unlimited' ? 'clock-low' : ''}>
        {table.preset === 'unlimited' ? '∞' : format(remaining(side))}
      </time>
    </div>
  );
  return (
    <div className="chess-layout">
      <div className="chess-main">
        {player(flipped ? 0 : 1)}
        <div
          className="chess-board"
          data-activity-surface="chess"
          role="group"
          aria-label={t('Шахматная доска')}
        >
          {indices.map((index, i) => {
            const s = square(index),
              piece = chess.get(s as 'a1'),
              own = piece?.color === chess.turn();
            return (
              <button
                type="button"
                key={s}
                aria-label={`${s} ${piece?.type ?? ''}`}
                className={`${(Math.floor(index / 8) + index) % 2 ? 'dark' : 'light'} ${selected === s ? 'selected' : ''} ${table.lastMove?.includes(s) ? 'last-move' : ''} ${legal.includes(s as 'a1') ? 'legal' : ''}`}
                disabled={!canMove}
                onClick={() => {
                  if (selected === s) setSelected(undefined);
                  else if (own) setSelected(s);
                  else if (selected && legal.includes(s as 'a1'))
                    send({ kind: 'chess-move', from: selected, to: s, promotion });
                }}
              >
                {i % 8 === 0 && <small className="chess-rank">{s[1]}</small>}
                {i >= 56 && <small className="chess-file">{s[0]}</small>}
                {piece && (
                  <span className={`chess-piece piece-${piece.color}`}>
                    {glyphs[piece.color === 'w' ? piece.type.toUpperCase() : piece.type]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {player(flipped ? 1 : 0)}
      </div>
      <aside className="chess-sidebar">
        <div className="table-status" role="status">
          {table.phase === 'finished'
            ? table.winner === 'draw'
              ? t('Ничья')
              : `${t('Победитель')}: ${playerName(table.winner, participants)}`
            : `${table.check ? t('Шах') + ' · ' : ''}${t('Ход')}: ${playerName(table.seats[turn], participants)}`}
        </div>
        {seat < 0 && <p className="table-muted">{t('Вы наблюдаете за партией')}</p>}
        <div className="chess-history">
          <div className="table-section-label">{t('Ходы партии')}</div>
          {!table.moves.length && <p className="table-muted">{t('Белые делают первый ход')}</p>}
          {Array.from({ length: Math.ceil(table.moves.length / 2) }, (_, i) => (
            <div key={i}>
              <small>{i + 1}.</small>
              <span>{table.moves[i * 2]}</span>
              <span>{table.moves[i * 2 + 1] ?? ''}</span>
            </div>
          ))}
        </div>
        {seat >= 0 && running && (
          <>
            <label className="table-select">
              <span>{t('Превращение пешки')}</span>
              <select
                value={promotion}
                onChange={(e) => setPromotion(e.target.value as typeof promotion)}
              >
                {(['q', 'r', 'b', 'n'] as const).map((p) => (
                  <option key={p} value={p}>
                    {glyphs[p]}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => send({ kind: 'chess-draw' })}>
              <Handshake size={16} />
              {table.drawOffer && table.drawOffer !== selfId
                ? t('Принять ничью')
                : table.drawOffer === selfId
                  ? t('Ничья предложена')
                  : t('Предложить ничью')}
            </button>
            <button
              type="button"
              className="table-danger"
              onClick={() => (resign ? send({ kind: 'table-resign' }) : setResign(true))}
            >
              <Flag size={16} />
              {resign ? t('Подтвердить сдачу') : t('Сдаться')}
            </button>
          </>
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
      </aside>
    </div>
  );
}

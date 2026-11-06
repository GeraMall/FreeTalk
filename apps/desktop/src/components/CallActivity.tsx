import { ArrowLeft, Bomb, Crown, Flag, Gamepad2, RotateCcw, Ship, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ActivityGame, RoomActivity, RoomActivityAction } from '@freetalk/protocol';
import { t } from '../lib/app-language';
import './call-activity.css';
const games = { chess: 'Шахматы', mines: 'Сапёр', fleet: 'Морской бой' } as const;
const gameIcons = { chess: Crown, mines: Bomb, fleet: Ship };
const pieces: Record<string, string> = {
  k: '♚',
  q: '♛',
  r: '♜',
  b: '♝',
  n: '♞',
  p: '♟',
  K: '♔',
  Q: '♕',
  R: '♖',
  B: '♗',
  N: '♘',
  P: '♙',
};
const results = {
  won: 'Победа',
  lost: 'Игра окончена',
  white: 'Белые победили',
  black: 'Чёрные победили',
  draw: 'Ничья',
} as const;

function coordinates(index: number) {
  return `${'abcdefgh'[index % 8]}${8 - Math.floor(index / 8)}`;
}

function ChessBoard({
  game,
  onAction,
}: {
  game: Extract<NonNullable<RoomActivity['game']>, { kind: 'chess' }>;
  onAction?: (action: RoomActivityAction) => void;
}) {
  const [selected, setSelected] = useState<string>();
  const [promotion, setPromotion] = useState<'q' | 'r' | 'b' | 'n'>('q');
  const [placement, turn] = game.fen.split(' ');
  const cells = [
    ...placement!.replaceAll('/', '').replace(/[1-8]/g, (count) => '.'.repeat(Number(count))),
  ];
  return (
    <>
      <div className="activity-board" aria-label={t('Шахматы')}>
        {cells.map((piece, index) => {
          const square = coordinates(index);
          const own =
            piece !== '.' &&
            (turn === 'w' ? piece === piece.toUpperCase() : piece === piece.toLowerCase());
          return (
            <button
              key={square}
              type="button"
              className={`${(index + Math.floor(index / 8)) % 2 ? 'dark' : ''} ${selected === square ? 'selected' : ''}`}
              aria-label={`${square} ${pieces[piece] ?? ''}`.trim()}
              disabled={!onAction || Boolean(game.result)}
              onClick={() => {
                if (selected === square) setSelected(undefined);
                else if (own) setSelected(square);
                else if (selected) {
                  onAction?.({ kind: 'move', from: selected, to: square, promotion });
                  setSelected(undefined);
                }
              }}
            >
              {pieces[piece]}
            </button>
          );
        })}
      </div>
      <label className="activity-promotion">
        <span>{t('Превращение пешки')}</span>
        <select
          value={promotion}
          onChange={(event) => setPromotion(event.target.value as typeof promotion)}
        >
          {(['q', 'r', 'b', 'n'] as const).map((piece) => (
            <option key={piece} value={piece}>
              {pieces[piece]}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

export function CallActivity({
  activity,
  onAction,
  onClose,
  onEnd,
}: {
  activity: RoomActivity;
  onAction?(action: RoomActivityAction): void;
  onClose?(): void;
  onEnd?(): void;
}) {
  const [flagging, setFlagging] = useState(false);
  const game = activity.game;
  const [catalog, setCatalog] = useState(!activity.game);
  const gameKind = activity.game?.kind;
  useEffect(() => {
    if (gameKind) setCatalog(false);
  }, [gameKind]);
  const play = (next: ActivityGame) => {
    setFlagging(false);
    setCatalog(false);
    onAction?.({ kind: 'game', game: next });
  };
  return (
    <section className="call-activity" aria-label={t('Общий планшет')}>
      <header className="activity-heading">
        <div>
          {!catalog && game ? (
            <button type="button" aria-label={t('К играм')} onClick={() => setCatalog(true)}>
              <ArrowLeft size={17} />
            </button>
          ) : (
            <Gamepad2 size={17} />
          )}
          <h2>{!catalog && game ? t(games[game.kind]) : t('Общий планшет')}</h2>
        </div>
        <div>
          {onEnd && (
            <button type="button" onClick={onEnd}>
              {t('Завершить для всех')}
            </button>
          )}
          <button type="button" aria-label={t('Свернуть планшет')} onClick={onClose}>
            <X size={17} />
          </button>
        </div>
      </header>
      <div
        className={`activity-content ${catalog || !game ? 'activity-catalog' : 'activity-playing'}`}
      >
        {catalog || !game ? (
          <>
            <div className="activity-pixel-planet" aria-hidden="true">
              <i />
            </div>
            <div className="activity-catalog-content">
              <h3>{t('Игры')}</h3>
              <p className="activity-intro">
                {t('Выбирайте игру и играйте вместе. Планшетом управляют все участники.')}
              </p>
              <div className="activity-tiles">
                {(Object.keys(games) as ActivityGame[]).map((kind) => {
                  const Icon = gameIcons[kind];
                  return (
                    <button
                      type="button"
                      className="activity-tile"
                      key={kind}
                      disabled={!onAction}
                      onClick={() => play(kind)}
                    >
                      <span className={`activity-game-mark game-mark-${kind}`}>
                        <Icon size={27} />
                      </span>
                      {t(games[kind])}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}
        {game && !catalog && (
          <div className="activity-game">
            <div className="activity-game-status">
              <span role="status">
                {game.result
                  ? t(results[game.result])
                  : game.kind === 'chess'
                    ? t(
                        game.check
                          ? 'Шах'
                          : game.fen.split(' ')[1] === 'w'
                            ? 'Ход белых'
                            : 'Ход чёрных',
                      )
                    : t(
                        game.kind === 'fleet'
                          ? 'Найдите три корабля за 24 промаха'
                          : 'Откройте все безопасные клетки',
                      )}
              </span>
              {game.kind === 'mines' && (
                <button
                  type="button"
                  aria-label={t('Флажок')}
                  aria-pressed={flagging}
                  onClick={() => setFlagging(!flagging)}
                >
                  <Flag size={15} />
                </button>
              )}
              <button type="button" disabled={!onAction} onClick={() => play(game.kind)}>
                <RotateCcw size={14} /> {t('Новая игра')}
              </button>
            </div>
            {game.kind === 'chess' ? (
              <ChessBoard key={game.fen} game={game} onAction={onAction} />
            ) : (
              <div
                className={`activity-board activity-board-${game.kind}`}
                aria-label={t(games[game.kind])}
              >
                {game.cells.map((cell, index) => (
                  <button
                    type="button"
                    key={index}
                    className={cell >= 0 ? 'revealed' : ''}
                    aria-label={`${coordinates(index)}${cell !== -1 ? ` · ${cell}` : ''}`}
                    disabled={
                      !onAction ||
                      Boolean(game.result) ||
                      (cell !== -1 && !(cell === -2 && flagging))
                    }
                    onClick={() => onAction?.({ kind: 'cell', index, flag: flagging })}
                    onContextMenu={(event) => {
                      if (game.kind !== 'mines' || !onAction || game.result) return;
                      event.preventDefault();
                      onAction({ kind: 'cell', index, flag: true });
                    }}
                  >
                    {cell === -2 ? (
                      <Flag size={15} />
                    ) : cell === 9 ? (
                      <Bomb size={15} />
                    ) : cell === 10 ? (
                      <Ship size={15} />
                    ) : cell > 0 ? (
                      cell
                    ) : cell === 0 && game.kind === 'fleet' ? (
                      '·'
                    ) : (
                      ''
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <footer className="activity-dock">
        <span>{!catalog && game ? t(games[game.kind]) : t('Игры')}</span>
        <div>
          {(Object.keys(games) as ActivityGame[]).map((kind) => {
            const Icon = gameIcons[kind];
            return (
              <button
                type="button"
                key={kind}
                aria-label={`${t('Открыть')} ${t(games[kind])}`}
                aria-pressed={!catalog && game?.kind === kind}
                disabled={!onAction}
                onClick={() => {
                  if (game?.kind === kind) setCatalog(false);
                  else play(kind);
                }}
              >
                <span className={`activity-game-mark game-mark-${kind}`}>
                  <Icon size={15} />
                </span>
                <span>{t(games[kind])}</span>
              </button>
            );
          })}
        </div>
      </footer>
    </section>
  );
}

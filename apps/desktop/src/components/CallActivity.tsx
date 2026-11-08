import {
  ArrowLeft,
  Bomb,
  Crown,
  Flag,
  Gamepad2,
  RotateCcw,
  Ship,
  X,
  Landmark,
  Trophy,
  Spade,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ActivityGame, RoomActivity, RoomActivityAction, TableKind } from '@freetalk/protocol';
import { t } from '../lib/app-language';
import './call-activity.css';
import './activity-tables.css';
import { ActivityTableLobby } from './ActivityTableLobby';
import { ActivityChess } from './ActivityChess';
import { ActivityFleet } from './ActivityFleet';
import { ActivityMillionaire } from './ActivityMillionaire';
import { ActivityPoker } from './ActivityPoker';
import type { TableParticipant } from './activity-table-ui';
import { ActivityProperty } from './ActivityProperty';
import { ActivityPointers } from './ActivityPointers';
const games = {
  chess: 'Шахматы',
  mines: 'Сапёр',
  fleet: 'Морской бой',
  monopoly: 'Монополия',
  millionaire: 'Кто хочет стать миллионером?',
  poker: 'Покер',
} as const;
const gameIcons = {
  chess: Crown,
  mines: Bomb,
  fleet: Ship,
  monopoly: Landmark,
  millionaire: Trophy,
  poker: Spade,
};
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
  selfId,
  participants = [],
  onAction,
  onClose,
  onEnd,
}: {
  activity: RoomActivity;
  selfId?: string;
  participants?: TableParticipant[];
  onAction?(action: RoomActivityAction): void;
  onClose?(): void;
  onEnd?(): void;
}) {
  const [flagging, setFlagging] = useState(false);
  const game = activity.game;
  const table = activity.table;
  const activeKind = table?.kind ?? game?.kind;
  const surface = useRef<HTMLElement>(null);
  const actionRef = useRef(onAction);
  actionRef.current = onAction;
  const pointerAt = useRef(0);
  useEffect(() => {
    actionRef.current?.({ kind: 'tablet-join', joined: true });
    return () => actionRef.current?.({ kind: 'tablet-join', joined: false });
  }, [activity.sessionId]);
  const [catalog, setCatalog] = useState(!activeKind);
  const gameKind = activeKind;
  const [switchTo, setSwitchTo] = useState<ActivityGame | TableKind>();
  useEffect(() => {
    if (gameKind) setCatalog(false);
  }, [gameKind]);
  const play = (next: ActivityGame | TableKind) => {
    if (table?.phase === 'playing' && next !== table.kind) {
      setSwitchTo(next);
      return;
    }
    setFlagging(false);
    setCatalog(false);
    onAction?.(
      next === 'mines'
        ? { kind: 'game', game: next }
        : {
            kind: 'table-open',
            game: next,
            ...(next === 'poker' ? { pokerRules: 2 as const, pokerSeats: 8 as const } : {}),
          },
    );
  };
  return (
    <section ref={surface} className="call-activity" aria-label={t('Общий планшет')}>
      {switchTo && (
        <div className="table-switch-confirm">
          <section role="alertdialog" aria-label={t('Сменить игру?')}>
            <h3>{t('Сменить игру?')}</h3>
            <p>{t('Текущая партия будет завершена для всех участников.')}</p>
            <div className="table-inline-controls">
              <button type="button" onClick={() => setSwitchTo(undefined)}>
                {t('Продолжить партию')}
              </button>
              <button
                type="button"
                onClick={() => {
                  onAction?.(
                    switchTo === 'mines'
                      ? { kind: 'game', game: 'mines' }
                      : {
                          kind: 'table-open',
                          game: switchTo,
                          ...(switchTo === 'poker'
                            ? { pokerRules: 2 as const, pokerSeats: 8 as const }
                            : {}),
                        },
                  );
                  setFlagging(false);
                  setCatalog(false);
                  setSwitchTo(undefined);
                }}
              >
                {t('Сменить игру')}
              </button>
            </div>
          </section>
        </div>
      )}
      <header className="activity-heading">
        <div>
          {!catalog && activeKind ? (
            <button type="button" aria-label={t('К играм')} onClick={() => setCatalog(true)}>
              <ArrowLeft size={17} />
            </button>
          ) : (
            <Gamepad2 size={17} />
          )}
          <h2>{!catalog && activeKind ? t(games[activeKind]) : t('Общий планшет')}</h2>
          <div className="tablet-viewers" aria-label={t('Участники планшета')}>
            {(activity.viewers ?? []).slice(0, 5).map((id) => {
              const participant = participants.find((p) => p.id === id);
              return participant ? (
                <span key={id} title={participant.name}>
                  {participant.name.slice(0, 1)}
                </span>
              ) : null;
            })}
            {(activity.viewers?.length ?? 0) > 5 && <small>+{activity.viewers!.length - 5}</small>}
          </div>
        </div>
        <div>
          {onEnd && (!table || table.hostId === selfId) && (
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
        data-activity-surface="catalog"
        onPointerMove={(event) => {
          if (table && ['fleet', 'poker'].includes(table.kind)) return;
          const now = performance.now();
          if (now - pointerAt.current < 145) return;
          pointerAt.current = now;
          const anchor =
            (event.target as HTMLElement).closest<HTMLElement>('[data-activity-surface]') ??
            event.currentTarget;
          const rect = anchor.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          onAction?.({
            kind: 'tablet-pointer',
            surface: `${table?.id ?? 'catalog'}:${anchor.dataset.activitySurface}`,
            x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
            y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
            visible: true,
          });
        }}
        onPointerLeave={() =>
          onAction?.({
            kind: 'tablet-pointer',
            surface: `${table?.id ?? 'catalog'}:tablet`,
            x: 0,
            y: 0,
            visible: false,
          })
        }
        className={`activity-content ${catalog || !activeKind ? 'activity-catalog' : 'activity-playing'}`}
      >
        {catalog || !activeKind ? (
          <>
            <div className="activity-pixel-planet" aria-hidden="true">
              <i />
            </div>
            <div className="activity-catalog-content">
              <h3>{t('Игры')}</h3>
              <p className="activity-intro">
                {t('Выберите игру, займите место или наблюдайте за друзьями.')}
                {activity.viewers?.length ? (
                  <small className="tablet-viewer-count">
                    {t('В планшете')}: {activity.viewers.length}
                  </small>
                ) : null}
              </p>
              <div className="activity-tiles">
                {(Object.keys(games) as (ActivityGame | TableKind)[]).map((kind) => {
                  const Icon = gameIcons[kind];
                  return (
                    <button
                      type="button"
                      className="activity-tile"
                      key={kind}
                      disabled={!onAction || Boolean(table && table.hostId !== selfId)}
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
        {table && !catalog && (
          <div className="activity-table-surface" data-activity-surface="tablet">
            {table.kind === 'fleet' ? (
              <ActivityFleet
                key={table.id}
                table={table}
                selfId={selfId}
                participants={participants}
                send={(action) => onAction?.(action)}
              />
            ) : table.phase === 'lobby' ? (
              <ActivityTableLobby
                key={table.id}
                table={table}
                selfId={selfId}
                participants={participants}
                send={(action) => onAction?.(action)}
              />
            ) : table.kind === 'chess' ? (
              <ActivityChess
                key={table.id}
                table={table}
                selfId={selfId}
                participants={participants}
                send={(action) => onAction?.(action)}
              />
            ) : table.kind === 'millionaire' ? (
              <ActivityMillionaire
                key={table.id}
                table={table}
                selfId={selfId}
                participants={participants}
                send={(action) => onAction?.(action)}
              />
            ) : table.kind === 'poker' ? (
              <ActivityPoker
                key={table.id}
                table={table}
                selfId={selfId}
                participants={participants}
                send={(action) => onAction?.(action)}
              />
            ) : (
              <ActivityProperty
                key={table.id}
                table={table}
                selfId={selfId}
                participants={participants}
                send={(action) => onAction?.(action)}
              />
            )}
          </div>
        )}
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
              <button
                type="button"
                disabled={!onAction || Boolean(table && table.hostId !== selfId)}
                onClick={() => play(game.kind)}
              >
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
      <ActivityPointers
        root={surface}
        surfaceId={table?.id ?? 'catalog'}
        selfId={selfId}
        participants={participants}
        disabled={Boolean(table && ['fleet', 'poker'].includes(table.kind))}
      />
      <footer className="activity-dock">
        <span>{!catalog && activeKind ? t(games[activeKind]) : t('Игры')}</span>
        <div>
          {(Object.keys(games) as (ActivityGame | TableKind)[]).map((kind) => {
            const Icon = gameIcons[kind];
            return (
              <button
                type="button"
                key={kind}
                aria-label={`${t('Открыть')} ${t(games[kind])}`}
                aria-pressed={!catalog && activeKind === kind}
                disabled={!onAction || Boolean(table && table.hostId !== selfId)}
                onClick={() => {
                  if (activeKind === kind) setCatalog(false);
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

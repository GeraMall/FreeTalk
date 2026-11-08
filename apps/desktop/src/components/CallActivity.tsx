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
  Mic,
  Headphones,
} from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { ActivityGame, RoomActivity, RoomActivityAction, TableKind } from '@freetalk/protocol';
import { t } from '../lib/app-language';
import './call-activity.css';
import './activity-tables.css';
import { ActivityTableLobby } from './ActivityTableLobby';
import { ActivityChess } from './ActivityChess';
import { ActivityFleet } from './ActivityFleet';
import { ActivityMillionaire } from './ActivityMillionaire';
import { ActivityPoker } from './ActivityPoker';
import { PokerLobby } from './PokerLobby';
import { PropertyLobby, PropertyViewport } from './PropertyLobby';
import { PokerViewport } from './PokerViewport';
import type { TableParticipant } from './activity-table-ui';
import { ActivityProperty } from './ActivityProperty';
import { TableBotControls } from './TableBotControls';
import { ActivityPointers } from './ActivityPointers';
import { DeviceControlIcon } from './CallDock';
import { CachedMediaImage } from './CachedMedia';
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
  participants: humanParticipants = [],
  onAction,
  onClose,
  onEnd,
  muted = false,
  deafened = false,
  onMute,
  onDeafen,
}: {
  activity: RoomActivity;
  selfId?: string;
  participants?: TableParticipant[];
  onAction?(action: RoomActivityAction): void;
  onClose?(): void;
  onEnd?(): void;
  muted?: boolean;
  deafened?: boolean;
  onMute?(): void;
  onDeafen?(): void;
}) {
  const [flagging, setFlagging] = useState(false);
  const game = activity.game;
  const table = activity.table;
  const participants: TableParticipant[] = [
    ...humanParticipants,
    ...(table?.bots ?? []).map((b) => ({ ...b, bot: true })),
  ];
  const activeKind = table?.kind ?? game?.kind;
  const TableFrame =
    table?.kind === 'poker'
      ? PokerViewport
      : table?.kind === 'monopoly'
        ? PropertyViewport
        : Fragment;
  const mobileGames: (ActivityGame | TableKind)[] = ['chess', 'mines', 'fleet', 'poker'];
  if (activity.canPlayPoker === false) mobileGames[3] = 'millionaire';
  if (activeKind && !mobileGames.includes(activeKind)) mobileGames[3] = activeKind;
  const surface = useRef<HTMLElement>(null);
  const actionRef = useRef(onAction);
  actionRef.current = onAction;
  const pointerAt = useRef(0);
  useEffect(() => {
    actionRef.current?.({ kind: 'tablet-join', joined: true });
    return () => actionRef.current?.({ kind: 'tablet-join', joined: false });
  }, [activity.sessionId]);
  const [catalog, setCatalog] = useState(!activeKind && !activity.restrictedGame);
  const gameKind = activeKind;
  useEffect(() => {
    if (gameKind) setCatalog(false);
  }, [gameKind, table?.id]);
  const play = (next: ActivityGame | TableKind) => {
    if (next === 'poker' && activity.canPlayPoker === false) return;
    if (next === activeKind) {
      setCatalog(false);
      return;
    }
    if (table || game) {
      onAction?.({ kind: 'game-propose', game: next });
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
            edition: 3,
            ...(next === 'monopoly' ? { propertyRules: 2 as const } : {}),
            ...(next === 'poker'
              ? { pokerRules: 2 as const, pokerSeats: 8 as const, pokerFlow: 2 as const }
              : {}),
          },
    );
  };
  return (
    <section ref={surface} className="call-activity" aria-label={t('Общий планшет')}>
      <header className="activity-heading">
        <div>
          {!catalog && activeKind ? (
            <button
              type="button"
              className="tablet-back-control"
              aria-label={t('К играм')}
              onClick={() => setCatalog(true)}
            >
              <ArrowLeft size={17} />
            </button>
          ) : (
            <Gamepad2 size={17} />
          )}
          <h2>{!catalog && activeKind ? t(games[activeKind]) : t('Общий планшет')}</h2>
          <div className="tablet-viewers" aria-label={t('Участники планшета')}>
            {(activity.viewers ?? []).slice(0, 3).map((id) => {
              const participant = participants.find((p) => p.id === id);
              return participant ? (
                <span key={id} title={participant.name}>
                  <span aria-hidden="true">{participant.name.slice(0, 1)}</span>
                  {participant.avatar && (
                    <CachedMediaImage
                      src={participant.avatar}
                      alt={participant.name}
                      onError={(event) => {
                        event.currentTarget.style.visibility = 'hidden';
                      }}
                    />
                  )}
                </span>
              ) : null;
            })}
            {(activity.viewers?.length ?? 0) > 3 && <small>+{activity.viewers!.length - 3}</small>}
          </div>
        </div>
        <div>
          {onEnd && !activity.restrictedGame && (!table || table.hostId === selfId) && (
            <button
              type="button"
              className="tablet-end-session"
              aria-label={t('Завершить для всех')}
              title={t('Завершить для всех')}
              onClick={onEnd}
            >
              <svg
                className="tablet-power-icon"
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path className="tablet-power-ring" d="M7.2 5.8a8 8 0 1 0 9.6 0" />
                <path className="tablet-power-stem" d="M12 3v8" />
              </svg>
              <span>{t('Завершить для всех')}</span>
            </button>
          )}
          <button
            type="button"
            className="tablet-close-control"
            aria-label={t('Свернуть планшет')}
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
      </header>
      <div
        data-activity-surface="catalog"
        onPointerMove={(event) => {
          if ((event.target as HTMLElement).closest('.mono-dice-tray.is-held')) return;
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
        className={`activity-content ${catalog || (!activeKind && !activity.restrictedGame) ? 'activity-catalog' : 'activity-playing'} ${!catalog && table?.kind === 'poker' ? 'activity-poker-fit' : !catalog && table?.kind === 'monopoly' ? 'activity-monopoly-fit' : ''}`}
      >
        {catalog || (!activeKind && !activity.restrictedGame) ? (
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
              {activity.canPlayPoker === false && (
                <div className="activity-age-catalog">
                  <strong>{t('Покер · 18+')}</strong>
                  <p>
                    {t(
                      'Доступ определяется датой рождения в аккаунте. Если дата не указана, отправьте её боту TRLKA: ДД.ММ.ГГГГ.',
                    )}
                  </p>
                  <button type="button" onClick={() => onAction?.({ kind: 'game-access' })}>
                    {t('Обновить доступ')}
                  </button>
                </div>
              )}
              <div className="activity-tiles">
                {(Object.keys(games) as (ActivityGame | TableKind)[]).map((kind) => {
                  const Icon = gameIcons[kind];
                  return (
                    <button
                      type="button"
                      className="activity-tile"
                      key={kind}
                      disabled={!onAction || (kind === 'poker' && activity.canPlayPoker === false)}
                      onClick={() => play(kind)}
                    >
                      <span className={`activity-game-mark game-mark-${kind}`}>
                        <Icon size={27} />
                      </span>
                      {t(games[kind])}
                      {kind === 'poker' && activity.canPlayPoker === false && <small>18+</small>}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}
        {activity.restrictedGame === 'poker' && !catalog && (
          <div className="activity-age-lock">
            <strong>18+</strong>
            <h3>{t('Покер доступен только с 18 лет')}</h3>
            <p>
              {t(
                'Участие и просмотр стола закрыты. Если дата рождения не указана, отправьте её боту TRLKA в формате ДД.ММ.ГГГГ.',
              )}
            </p>
            <button type="button" onClick={() => onAction?.({ kind: 'game-access' })}>
              {t('Обновить доступ')}
            </button>
            <button type="button" onClick={() => setCatalog(true)}>
              {t('К другим играм')}
            </button>
          </div>
        )}
        {table && !catalog && (
          <div className="activity-table-surface" data-activity-surface="tablet">
            <TableFrame>
              {table.training && table.kind !== 'poker' && table.kind !== 'monopoly' && (
                <div className="table-training-banner">
                  {t('Тренировка с ботами · статистика не учитывается')}
                </div>
              )}
              {table.phase === 'lobby' && table.kind !== 'poker' && table.kind !== 'monopoly' && (
                <TableBotControls
                  table={table}
                  selfId={selfId}
                  send={(action) => onAction?.(action)}
                />
              )}
              {table.kind === 'fleet' ? (
                <ActivityFleet
                  key={table.id}
                  table={table}
                  selfId={selfId}
                  participants={participants}
                  send={(action) => onAction?.(action)}
                />
              ) : table.phase === 'lobby' && table.kind === 'poker' ? (
                <PokerLobby
                  table={table}
                  selfId={selfId}
                  participants={participants}
                  send={(action) => onAction?.(action)}
                />
              ) : table.phase === 'lobby' && table.kind === 'monopoly' ? (
                <PropertyLobby
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
                  onExit={() => setCatalog(true)}
                  key={table.id}
                  table={table}
                  selfId={selfId}
                  participants={participants}
                  send={(action) => onAction?.(action)}
                />
              )}
            </TableFrame>
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
      <ActivityPointers
        root={surface}
        surfaceId={table?.id ?? 'catalog'}
        selfId={selfId}
        participants={participants}
        disabled={Boolean(table && ['fleet', 'poker'].includes(table.kind))}
      />
      <footer className="activity-dock">
        <div className="tablet-audio-controls" aria-label={t('Звук звонка')}>
          <button
            type="button"
            aria-label={t(muted ? 'Включить микрофон' : 'Выключить микрофон')}
            aria-pressed={!muted}
            className={muted ? 'tablet-device-off' : 'tablet-device-on'}
            disabled={!onMute}
            onClick={onMute}
          >
            <DeviceControlIcon icon={Mic} off={muted} />
          </button>
          <button
            type="button"
            aria-label={t(deafened ? 'Включить звук' : 'Выключить звук')}
            aria-pressed={!deafened}
            className={deafened ? 'tablet-device-off' : 'tablet-device-on'}
            disabled={!onDeafen}
            onClick={onDeafen}
          >
            <DeviceControlIcon icon={Headphones} off={deafened} />
          </button>
        </div>
        <div className="tablet-game-shortcuts">
          {(Object.keys(games) as (ActivityGame | TableKind)[]).map((kind) => {
            const Icon = gameIcons[kind];
            return (
              <button
                type="button"
                key={kind}
                className={
                  mobileGames.includes(kind)
                    ? 'tablet-mobile-recommendation'
                    : 'tablet-desktop-game'
                }
                aria-label={`${t('Открыть')} ${t(games[kind])}`}
                title={t(games[kind])}
                aria-pressed={!catalog && activeKind === kind}
                disabled={!onAction || (kind === 'poker' && activity.canPlayPoker === false)}
                onClick={() => {
                  if (activeKind === kind) setCatalog(false);
                  else play(kind);
                }}
              >
                <span className={`activity-game-mark game-mark-${kind}`}>
                  <Icon size={15} />
                </span>
              </button>
            );
          })}
        </div>
      </footer>
    </section>
  );
}

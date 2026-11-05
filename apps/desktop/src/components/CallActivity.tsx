import { invoke, isTauri } from '@tauri-apps/api/core';
import { ArrowUpRight, Bomb, Flag, Gamepad2, RotateCcw, Ship, X } from 'lucide-react';
import { useState } from 'react';
import type {
  ActivityGame,
  ActivityRegion,
  RoomActivity,
  RoomActivityAction,
} from '@freetalk/protocol';
import glovoLogo from '../assets/food/glovo.png';
import samokatLogo from '../assets/food/samokat.png';
import woltLogo from '../assets/food/wolt.png';
import yandexLogo from '../assets/food/yandex.png';
import { t } from '../lib/app-language';
import vendors from '../lib/food-vendors.json';
import { PrivateFoodBrowser } from './PrivateFoodBrowser';
import './call-activity.css';

const vendorLogos: Partial<Record<string, string>> = {
  glovo: glovoLogo,
  samokat: samokatLogo,
  wolt: woltLogo,
  yandex: yandexLogo,
};

const games = { chess: 'Шахматы', mines: 'Сапёр', fleet: 'Морской бой' } as const;
const regions = { RU: 'Россия', KZ: 'Казахстан', GB: 'Великобритания' } as const;
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
}: {
  activity: RoomActivity;
  onAction?(action: RoomActivityAction): void;
}) {
  const [flagging, setFlagging] = useState(false);
  const [deliveryError, setDeliveryError] = useState(false);
  const [privateVendor, setPrivateVendor] = useState<(typeof vendors)[number]>();
  const catalog = vendors.filter((entry) => entry.region === activity.region);
  const selected = catalog.find((entry) => entry.id === activity.service);
  const game = activity.game;
  const play = (next: ActivityGame) => {
    setFlagging(false);
    onAction?.({ kind: 'game', game: next });
  };

  if (privateVendor)
    return (
      <PrivateFoodBrowser vendor={privateVendor} onClose={() => setPrivateVendor(undefined)} />
    );

  return (
    <section className="call-activity" aria-label={t('Общий планшет')}>
      <header className="activity-heading">
        <h2>{t('Общий планшет')}</h2>
        <div>
          <select
            aria-label={t('Страна')}
            value={activity.region}
            disabled={!onAction}
            onChange={(event) =>
              onAction?.({ kind: 'region', region: event.target.value as ActivityRegion })
            }
          >
            {Object.entries(regions).map(([code, label]) => (
              <option key={code} value={code}>
                {t(label)}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={t('Закрыть для всех')}
            disabled={!onAction}
            onClick={() => onAction?.({ kind: 'close' })}
          >
            <X size={17} />
          </button>
        </div>
      </header>
      <div className="activity-content">
        <h3>{t('Сервисы доставки')}</h3>
        <div className="activity-services">
          {catalog.map((service) => (
            <button
              type="button"
              key={service.id}
              disabled={!onAction}
              aria-pressed={selected?.id === service.id && !game}
              onClick={() => {
                setDeliveryError(false);
                onAction?.({ kind: 'service', service: service.id });
              }}
            >
              <span className={`food-vendor-mark food-vendor-${service.tone}`} aria-hidden="true">
                {vendorLogos[service.id] ? (
                  <img src={vendorLogos[service.id]} alt="" />
                ) : (
                  service.mark
                )}
              </span>
              {service.name}
            </button>
          ))}
        </div>
        {selected && !game && (
          <div className="activity-delivery">
            <span>{t('Адрес, корзина и оплата открываются только у вас.')}</span>
            {isTauri() ? (
              <button
                type="button"
                onClick={() => {
                  setDeliveryError(false);
                  if (/Windows|Macintosh/i.test(navigator.userAgent)) {
                    setPrivateVendor(selected);
                    return;
                  }
                  void invoke('food_vendor_open_browser', { vendor: selected.id }).catch(() =>
                    setDeliveryError(true),
                  );
                }}
              >
                {t('Открыть у себя')} <ArrowUpRight size={14} />
              </button>
            ) : (
              <a href={selected.url} target="_blank" rel="noopener noreferrer">
                {t('Открыть у себя')} <ArrowUpRight size={14} />
              </a>
            )}
            {deliveryError && <span role="alert">{t('Не удалось открыть браузер.')}</span>}
          </div>
        )}
        <h3>
          <Gamepad2 size={16} /> {t('Игры')}
        </h3>
        <div className="activity-games">
          {(Object.keys(games) as ActivityGame[]).map((kind) => (
            <button
              type="button"
              key={kind}
              aria-pressed={game?.kind === kind}
              disabled={!onAction}
              onClick={() => {
                if (game?.kind !== kind) play(kind);
              }}
            >
              {t(games[kind])}
            </button>
          ))}
        </div>
        {game && (
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
    </section>
  );
}

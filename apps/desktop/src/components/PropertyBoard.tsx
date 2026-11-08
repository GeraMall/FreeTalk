import type { TableOf } from '@freetalk/protocol';
import { useId, useRef, type CSSProperties, type ReactNode } from 'react';
import { usePropertyTypography } from '../lib/use-property-typography';
import {
  propertyBoard,
  propertyBoardLabels,
  propertyColors,
  playerColors,
  tokenIcons,
  propertyPosition,
} from '../lib/monopoly-layout';
import { t } from '../lib/app-language';
import { PropertyStreetName } from './PropertyStreetName';
import { PropertyArtwork } from './PropertyArtwork';
import { playerName, type TableParticipant } from './activity-table-ui';
export function PropertyBoard({
  table,
  positions,
  motion,
  participants,
  onSelect,
  children,
}: {
  table: TableOf<'monopoly'>;
  positions: number[];
  motion?: { seat: number; sequence: number; step: number };
  participants: TableParticipant[];
  onSelect(index: number): void;
  children: ReactNode;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const metalId = `mono-metal-${useId().replace(/:/g, '')}`;
  usePropertyTypography(boardRef);
  return (
    <div
      ref={boardRef}
      className="mono-board"
      role="group"
      aria-label={t('Поле Монополии')}
      data-activity-surface="property"
    >
      <svg
        className="mono-token-material"
        width="0"
        height="0"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={metalId} x1="0%" y1="0%" x2="90%" y2="100%">
            <stop offset="0%" stopColor="#9ba8b4" />
            <stop offset="24%" stopColor="#52616e" />
            <stop offset="46%" stopColor="#26323d" />
            <stop offset="61%" stopColor="#71808c" />
            <stop offset="82%" stopColor="#34414d" />
            <stop offset="100%" stopColor="#18232c" />
          </linearGradient>
        </defs>
      </svg>
      <div className="mono-board-center">{children}</div>
      {propertyBoard.map(([name, price, group], i) => {
        const p = propertyPosition(i),
          owner = table.owners[i]!,
          h = table.houses[i]!,
          special = group < 0,
          illustrated = special || group === 8 || group === 9;
        return (
          <button
            key={i}
            type="button"
            className={`mono-cell ${special ? 'is-special' : ''} ${illustrated ? 'is-illustrated' : ''} tile-${i} ${table.mortgaged.includes(i) ? 'is-mortgaged' : ''} side-${p.col === 0 ? 'left' : p.col === 10 ? 'right' : p.row === 0 ? 'top' : 'bottom'}`}
            style={
              {
                gridRow: p.row + 1,
                gridColumn: p.col + 1,
                '--group-color': propertyColors[group] ?? '#a6b6b2',
                '--owner-color': playerColors[owner] ?? 'transparent',
                '--cell-name-size':
                  name.length > 10 && !/[\s-]/.test(name) ? 'clamp(7px,.9cqw,10.5px)' : undefined,
              } as CSSProperties
            }
            onClick={() => onSelect(i)}
            aria-label={`${t(name)}${price ? ` · ${price}` : ''}${owner >= 0 ? ` · ${playerName(table.seats[owner], participants)}` : ''}`}
          >
            <span className="mono-cell-band" />
            <PropertyArtwork index={i} />
            {group >= 0 && group < 8 ? (
              <PropertyStreetName text={propertyBoardLabels[i] ?? name} />
            ) : (
              <span className="mono-cell-name">{t(name)}</span>
            )}
            <small>
              {price ? `${price} ¤` : i === 0 ? '+200' : i === 20 ? 'P' : i === 10 ? '↗' : '◇'}
            </small>
            {h > 0 && (
              <span
                className="mono-buildings"
                aria-label={h === 5 ? t('Один отель') : `${h} ${t('дома')}`}
              >
                {Array.from({ length: h === 5 ? 1 : h }, (_, n) => (
                  <i key={n} className={h === 5 ? 'mono-hotel' : 'mono-house'} />
                ))}
              </span>
            )}
            {owner >= 0 && <span className="mono-cell-owner" />}
            {motion && positions[motion.seat] === i && (
              <span className="mono-step-wave" key={`${motion.sequence}:${motion.step}`} />
            )}
          </button>
        );
      })}
      <div className="mono-token-layer" aria-hidden="true">
        {table.seats.map((id, i) => {
          if (!id || table.bankrupt.includes(i)) return null;
          const pos = positions[i] ?? 0,
            p = propertyPosition(pos),
            others = positions
              .slice(0, i)
              .filter((n, j) => n === pos && !table.bankrupt.includes(j)).length,
            Icon = tokenIcons[i % tokenIcons.length]!;
          return (
            <span
              key={id}
              className={`mono-token ${table.turn === i ? 'is-turn' : ''}`}
              title={playerName(id, participants)}
              style={
                {
                  left: `${((p.col + 0.5) * 100) / 11}%`,
                  top: `${((p.row + 0.5) * 100) / 11}%`,
                  '--seat-color': playerColors[i],
                  '--token-n': others,
                } as CSSProperties
              }
            >
              <span
                key={motion?.seat === i ? `${motion.sequence}:${motion.step}` : 'rest'}
                className={`mono-token-piece ${motion?.seat === i ? 'is-hopping' : ''}`}
              >
                <Icon style={{ fill: `url(#${metalId})` }} />
                <i />
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

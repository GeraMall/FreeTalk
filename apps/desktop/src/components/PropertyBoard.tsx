import { propertyBoard, type TableOf } from '@freetalk/protocol';
import type { CSSProperties, ReactNode } from 'react';
import { propertyColors, playerColors, tokenIcons, propertyPosition } from '../lib/monopoly-layout';
import { t } from '../lib/app-language';
import { playerName, type TableParticipant } from './activity-table-ui';
export function PropertyBoard({
  table,
  positions,
  participants,
  onSelect,
  children,
}: {
  table: TableOf<'monopoly'>;
  positions: number[];
  participants: TableParticipant[];
  onSelect(index: number): void;
  children: ReactNode;
}) {
  return (
    <div
      className="mono-board"
      role="group"
      aria-label={t('Поле Монополии')}
      data-activity-surface="property"
    >
      <div className="mono-board-center">{children}</div>
      {propertyBoard.map(([name, price, group], i) => {
        const p = propertyPosition(i),
          owner = table.owners[i]!,
          h = table.houses[i]!,
          special = group < 0;
        return (
          <button
            key={i}
            type="button"
            className={`mono-cell ${special ? 'is-special' : ''} ${table.mortgaged.includes(i) ? 'is-mortgaged' : ''} side-${p.col === 0 ? 'left' : p.col === 10 ? 'right' : p.row === 0 ? 'top' : 'bottom'}`}
            style={
              {
                gridRow: p.row + 1,
                gridColumn: p.col + 1,
                '--group-color': propertyColors[group] ?? '#a6b6b2',
                '--owner-color': playerColors[owner] ?? 'transparent',
              } as CSSProperties
            }
            onClick={() => onSelect(i)}
            aria-label={`${t(name)}${price ? ` · ${price}` : ''}${owner >= 0 ? ` · ${playerName(table.seats[owner], participants)}` : ''}`}
          >
            <span className="mono-cell-band" />
            <span className="mono-cell-name">{t(name)}</span>
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
              <Icon />
              <i />
            </span>
          );
        })}
      </div>
    </div>
  );
}

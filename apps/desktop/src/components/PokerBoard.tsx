import type { TableOf } from '@freetalk/protocol';
import { pokerVisibleBoard, pokerRevealing } from '../lib/poker-board';
import { Spade } from 'lucide-react';
import { PokerCard } from './PokerVisuals';
import { t } from '../lib/app-language';

export function PokerBoard({
  table,
  now,
  best,
  dealing,
}: {
  table: TableOf<'poker'>;
  now: number;
  best: string[];
  dealing: boolean;
}) {
  const visible = pokerVisibleBoard(table, now);
  return (
    <div className={`pkr-board-frame ${dealing ? 'pkr-pile-wait' : ''}`}>
      {table.edition === 3 && (
        <div className="pkr-draw-pile" aria-label={t('Колода')}>
          <i />
          <i />
          <PokerCard />
        </div>
      )}
      <div className="pkr-board" aria-label={t('Общие карты')}>
        {Array.from({ length: 5 }, (_, i) =>
          visible[i] ? (
            <PokerCard
              key={`${table.id}:${table.handNumber}:${i}:${visible[i]}`}
              value={visible[i]}
              highlight={best.includes(visible[i]!)}
              animate={
                table.edition === 3
                  ? pokerRevealing(table, now)
                  : Boolean(table.lastAction && now - table.lastAction.at < 1800)
              }
              fromDeck={table.edition === 3 ? i : undefined}
            />
          ) : (
            <span className="pkr-card-slot" key={`empty:${i}`}>
              <Spade size={17} />
            </span>
          ),
        )}
      </div>
    </div>
  );
}

import type { ActivityTable, RoomActivityAction } from '@freetalk/protocol';
import { Bot, Plus, X } from 'lucide-react';
import { t } from '../lib/app-language';

export function TableBotControls({
  table,
  selfId,
  send,
}: {
  table: ActivityTable;
  selfId?: string;
  send: (action: RoomActivityAction) => void;
}) {
  if (
    table.edition !== 3 ||
    table.hostId !== selfId ||
    !['chess', 'fleet', 'monopoly', 'poker'].includes(table.kind) ||
    (table.phase !== 'lobby' && !(table.kind === 'poker' && table.stage === 'showdown'))
  )
    return null;
  const maximum = table.kind === 'poker' ? 8 : table.kind === 'monopoly' ? 6 : 2;
  const available = table.seats.findIndex((id) => !id);
  const next = available >= 0 ? available : table.seats.length < maximum ? table.seats.length : -1;
  return (
    <section className="table-bot-controls" aria-label={t('Тренировочные боты')}>
      <div>
        <Bot size={19} />
        <span>
          <strong>{t('Потренироваться с ботами')}</strong>
          <small>
            {t('С ботом вся партия, включая игру с друзьями, проходит без статистики.')}
          </small>
        </span>
      </div>
      <div className="table-bot-actions">
        {next >= 0 && (
          <button type="button" onClick={() => send({ kind: 'table-bot', seat: next })}>
            <Plus size={15} />
            {t('Добавить бота')}
          </button>
        )}
        {table.bots?.map((bot) => (
          <button
            type="button"
            key={bot.id}
            aria-label={`${t('Убрать')} ${bot.name}`}
            onClick={() =>
              send({ kind: 'table-bot', seat: table.seats.indexOf(bot.id), remove: true })
            }
          >
            {bot.name}
            <X size={13} />
          </button>
        ))}
      </div>
    </section>
  );
}

import { playerName, tableNames, clockModes, type TableUiProps } from './activity-table-ui';
import { Crown, Eye, UserPlus, Users } from 'lucide-react';
import { t } from '../lib/app-language';
export function ActivityTableLobby({
  table,
  selfId,
  participants,
  send,
  children,
}: { children?: React.ReactNode } & TableUiProps) {
  const host = table.hostId === selfId,
    seated = table.seats.includes(selfId ?? '');
  return (
    <div className="table-lobby">
      <div className="table-section-label">
        <Users size={16} />
        {t('Подготовка партии')}
      </div>
      <h3>{t(tableNames[table.kind])}</h3>
      <p className="table-muted">
        {table.kind === 'chess'
          ? t('Выберите цвет и контроль времени. Остальные участники могут смотреть партию.')
          : table.kind === 'fleet'
            ? t('Два капитана, два поля. Зрители видят оба поля после начала боя.')
            : table.kind === 'poker'
              ? t(
                  table.pokerRules === 2
                    ? '1000 фишек · блайнды 10 / 20 · ход 30 секунд · 3 докупки'
                    : 'Техасский холдем · 1000 виртуальных фишек · блайнды 10 / 20',
                )
              : table.kind === 'millionaire'
                ? t('Один игрок отвечает, остальные помогают голосом и голосуют в помощи зала.')
                : t(
                    'Покупайте участки, стройте дома и договаривайтесь об обмене. От 2 до 6 игроков.',
                  )}
      </p>
      <div className={`table-seats table-seats-${table.seats.length}`}>
        {table.seats.map((id, index) => (
          <button
            key={index}
            type="button"
            className={`table-seat ${id === selfId ? 'is-self' : ''}`}
            disabled={Boolean(id) || !selfId}
            onClick={() => send({ kind: 'table-seat', seat: index })}
          >
            <span className="table-seat-symbol">
              {table.kind === 'chess' ? index === 0 ? '♔' : '♚' : <UserPlus size={22} />}
            </span>
            <span>
              <small>
                {table.kind === 'chess'
                  ? t(index === 0 ? 'Белые' : 'Чёрные')
                  : `${t('Игрок')} ${index + 1}`}
              </small>
              <strong>{playerName(id, participants)}</strong>
            </span>
            {id === table.hostId && <Crown size={14} />}
          </button>
        ))}
      </div>
      {seated && (
        <button
          type="button"
          className="table-text-button"
          onClick={() => send({ kind: 'table-seat', seat: null })}
        >
          <Eye size={15} />
          {t('Стать зрителем')}
        </button>
      )}
      {table.kind === 'chess' && (
        <div className="table-clock-modes" role="group" aria-label={t('Контроль времени')}>
          {clockModes.map(([preset, label, description]) => (
            <button
              type="button"
              disabled={!host}
              className={table.preset === preset ? 'selected' : ''}
              key={preset}
              aria-pressed={table.preset === preset}
              onClick={() => send({ kind: 'table-config', preset })}
            >
              <strong>{label}</strong>
              <small>{t(description)}</small>
            </button>
          ))}
        </div>
      )}
      {table.kind === 'millionaire' && (
        <div className="table-inline-controls">
          {(['ru', 'en'] as const).map((preset) => (
            <button
              type="button"
              key={preset}
              disabled={!host}
              aria-pressed={table.preset === preset}
              onClick={() => send({ kind: 'table-config', preset })}
            >
              {preset === 'ru' ? 'Русский' : 'English'}
            </button>
          ))}
        </div>
      )}
      {table.kind !== 'fleet' && (
        <button
          type="button"
          className="table-primary"
          disabled={
            !host || table.seats.filter(Boolean).length < (table.kind === 'millionaire' ? 1 : 2)
          }
          onClick={() => send({ kind: 'table-start' })}
        >
          {host ? t('Начать игру') : t('Ведущий запустит игру')}
        </button>
      )}
      {!host && (
        <p className="table-muted">
          {t('Ведущий')}: {playerName(table.hostId, participants)}
        </p>
      )}
      {children}
    </div>
  );
}

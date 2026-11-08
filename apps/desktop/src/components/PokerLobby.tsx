import { Crown, Eye, Spade, UserPlus, Users, Play, Coins } from 'lucide-react';
import type { TableOf } from '@freetalk/protocol';
import { t } from '../lib/app-language';
import { type TableUiProps, playerName } from './activity-table-ui';
import { PokerAvatar } from './PokerVisuals';
import { PokerRulesPicker } from './PokerRulesPicker';
import { TableBotControls } from './TableBotControls';

export function PokerLobby({ table, selfId, participants, send }: TableUiProps<TableOf<'poker'>>) {
  const host = table.hostId === selfId,
    seated = table.seats.includes(selfId ?? ''),
    count = table.seats.filter(Boolean).length;
  return (
    <section className="poker-lobby" aria-label={t('Подготовка покерного стола')}>
      <header className="poker-lobby-heading">
        <span className="poker-lobby-symbol">
          <Spade size={27} />
        </span>
        <div>
          <small>TRLKA POKER</small>
          <h3>{t('Ваш стол, ваши правила')}</h3>
          <p>{t('Выберите режим и займите места. Дальше раздачи продолжатся автоматически.')}</p>
        </div>
        <span className="poker-lobby-meta">
          <Users size={15} />
          {count} / 8 <Coins size={15} /> 1 000
        </span>
      </header>
      <div className="poker-lobby-columns">
        <section className="poker-lobby-settings">
          <h4>{t('Настройки партии')}</h4>
          <PokerRulesPicker table={table} host={host} send={send} />
        </section>
        <section className="poker-lobby-players">
          <header>
            <h4>{t('Места за столом')}</h4>
            {seated && (
              <button
                type="button"
                className="poker-lobby-spectate"
                onClick={() => send({ kind: 'table-seat', seat: null })}
              >
                <Eye size={14} />
                {t('Наблюдать')}
              </button>
            )}
          </header>
          <div className="poker-lobby-seats">
            {table.seats.map((id, index) => (
              <button
                type="button"
                className={`poker-lobby-seat ${id ? 'is-occupied' : ''} ${id === selfId ? 'is-self' : ''}`}
                key={index}
                disabled={Boolean(id) || !selfId}
                onClick={() => send({ kind: 'table-seat', seat: index })}
              >
                <span className="poker-lobby-seat-number">{index + 1}</span>
                {id ? (
                  <PokerAvatar
                    person={participants.find((p) => p.id === id)}
                    moving={false}
                    self={id === selfId}
                  />
                ) : (
                  <span className="poker-lobby-empty">
                    <UserPlus size={20} />
                  </span>
                )}
                <span>
                  <small>
                    {t(id === selfId ? 'Ваше место' : id ? 'За столом' : 'Свободное место')}
                  </small>
                  <strong>{id ? playerName(id, participants) : t('Присоединиться')}</strong>
                </span>
                {id === table.hostId && <Crown size={13} />}
              </button>
            ))}
          </div>
          <TableBotControls table={table} selfId={selfId} send={send} />
        </section>
      </div>
      <footer className="poker-lobby-start">
        <span>
          <strong>{t('Всё готово?')}</strong>
          <small>
            {host
              ? t(
                  count < 2
                    ? 'Нужны минимум два игрока. Можно добавить бота.'
                    : !table.ageConfirmed
                      ? 'Подтвердите возраст участников перед стартом.'
                      : 'Участники на местах. Можно начинать.',
                )
              : `${t('Стол запускает')} ${playerName(table.hostId, participants)}`}
          </small>
        </span>
        <button
          type="button"
          disabled={!host || !table.ageConfirmed || count < 2}
          onClick={() => send({ kind: 'table-start' })}
        >
          <Play size={17} />
          {t(host ? 'Начать игру' : 'Ожидаем ведущего')}
        </button>
      </footer>
    </section>
  );
}

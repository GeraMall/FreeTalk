import type { ReactNode } from 'react';
import { Landmark, Users, Play, Eye, Crown, UserPlus, X } from 'lucide-react';
import type { TableOf } from '@freetalk/protocol';
import { t } from '../lib/app-language';
import { playerName, type TableUiProps } from './activity-table-ui';
import { PokerAvatar } from './PokerVisuals';
import { TableBotControls } from './TableBotControls';
import './monopoly.css';
export function PropertyViewport({ children }: { children: ReactNode }) {
  return <div className="mono-viewport">{children}</div>;
}
export function PropertyLobby({
  table,
  selfId,
  participants,
  send,
}: TableUiProps<TableOf<'monopoly'>>) {
  const host = table.hostId === selfId,
    seated = table.seats.includes(selfId ?? '');
  return (
    <section className="mono-lobby">
      <header className="mono-lobby-heading">
        <span className="mono-brand">
          <Landmark />
        </span>
        <div>
          <small>TRLKA · {t('Монополия')}</small>
          <h3>{t('Город начинается с вас')}</h3>
          <p>{t('Покупайте улицы, собирайте цветовые группы и стройте свою империю.')}</p>
        </div>
        <b>
          <Users size={17} />
          {table.seats.filter(Boolean).length} / 6
        </b>
      </header>
      <div className="mono-lobby-body">
        <section>
          <h4>{t('Начальный капитал')}</h4>
          <div className="mono-modes">
            {[
              ['standard', 'Классический старт', '1 500 ¤'],
              ['quick', 'Быстрый старт', '1 000 ¤'],
            ].map(([preset, title, cash]) => (
              <button
                type="button"
                key={preset}
                disabled={!host}
                aria-pressed={table.preset === preset}
                onClick={() =>
                  send({ kind: 'table-config', preset: preset as 'standard' | 'quick' })
                }
              >
                <Landmark size={21} />
                <strong>{t(title!)}</strong>
                <b>{cash}</b>
              </button>
            ))}
          </div>
          <div className="mono-rule-note">
            <strong>{t('Дома, отели и банк')}</strong>
            <p>
              {t(
                'До четырёх домов на улице, затем один отель. В банке 32 дома и 12 отелей. Строим равномерно по цветовой группе.',
              )}
            </p>
            <small>
              {t('Деньги виртуальные. Побеждает последний участник, который не обанкротился.')}
            </small>
          </div>
          <TableBotControls table={table} selfId={selfId} send={send} />
        </section>
        <section>
          <div className="mono-seat-title">
            <h4>{t('Места за столом')}</h4>
            {seated && (
              <button type="button" onClick={() => send({ kind: 'table-seat', seat: null })}>
                <Eye size={15} />
                {t('Наблюдать')}
              </button>
            )}
          </div>
          <div className="mono-lobby-seats">
            {table.seats.map((id, i) => (
              <button
                type="button"
                key={i}
                disabled={(!!id && !(host && table.bots?.some((b) => b.id === id))) || !selfId}
                className={id === selfId ? 'is-self' : ''}
                aria-label={
                  id && host && table.bots?.some((b) => b.id === id)
                    ? `${t('Убрать')} ${playerName(id, participants)}`
                    : undefined
                }
                onClick={() =>
                  id && host && table.bots?.some((b) => b.id === id)
                    ? send({ kind: 'table-bot', seat: i, remove: true })
                    : send({ kind: 'table-seat', seat: i })
                }
              >
                <small className="mono-seat-number">{i + 1}</small>
                {id ? (
                  <PokerAvatar
                    person={participants.find((p) => p.id === id)}
                    moving={false}
                    self={id === selfId}
                  />
                ) : (
                  <UserPlus size={26} />
                )}
                <span>
                  <small>{t(id ? 'За столом' : 'Свободное место')}</small>
                  <strong>{id ? playerName(id, participants) : t('Присоединиться')}</strong>
                </span>
                {id === table.hostId && <Crown size={15} />}{' '}
                {id && host && table.bots?.some((b) => b.id === id) && <X size={13} />}
              </button>
            ))}
          </div>
        </section>
      </div>
      <footer className="mono-lobby-start">
        <p>
          {t(
            table.seats.filter(Boolean).length < 2
              ? 'Нужны минимум два игрока. Можно добавить бота.'
              : 'Все на местах. Можно начинать.',
          )}
        </p>
        <button
          type="button"
          className="mono-primary"
          disabled={!host || table.seats.filter(Boolean).length < 2}
          onClick={() => send({ kind: 'table-start' })}
        >
          <Play size={18} />
          {t(host ? 'Начать игру' : 'Ожидаем ведущего')}
        </button>
      </footer>
    </section>
  );
}

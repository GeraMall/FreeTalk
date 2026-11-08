import {
  housePrice,
  propertyBoard,
  propertyRentSchedule,
  propertyGroup,
  propertyBuildingStock,
  type TableOf,
} from '@freetalk/protocol';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { X, House, Landmark } from 'lucide-react';
import { t } from '../lib/app-language';
import { playerName, type TableUiProps } from './activity-table-ui';
import { propertyColors } from '../lib/monopoly-layout';
export function PropertyModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      className="mono-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        className="mono-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
          if (e.key === 'Tab') {
            const controls = Array.from(
              dialog.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]',
              ) ?? [],
            ).filter((el) => el.getClientRects().length);
            const first = controls[0],
              last = controls.at(-1);
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header>
          <h3>{title}</h3>
          <button type="button" autoFocus aria-label={t('Закрыть')} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function PropertyDeed({
  table,
  selfId,
  participants,
  send,
  index,
  onClose,
}: TableUiProps<TableOf<'monopoly'>> & { index: number; onClose(): void }) {
  const [manage, setManage] = useState(false);
  const [name, price, group] = propertyBoard[index]!,
    owner = table.owners[index]!,
    seat = table.seats.indexOf(selfId ?? ''),
    mine = owner === seat && seat >= 0,
    level = table.houses[index]!,
    mortgaged = table.mortgaged.includes(index),
    rents = propertyRentSchedule(index),
    stock = propertyBuildingStock(table),
    active = table.phase === 'playing',
    busy = Date.now() < (table.lastMove?.until ?? 0);
  const siblings = propertyGroup(index),
    complete = siblings.every((i) => table.owners[i] === seat && !table.mortgaged.includes(i)),
    canBuild = complete && level === Math.min(...siblings.map((i) => table.houses[i]!)),
    canSell = level === Math.max(...siblings.map((i) => table.houses[i]!)),
    canMortgage = mortgaged
      ? table.money[seat]! >= Math.ceil(price * 0.55)
      : siblings.every((i) => table.houses[i] === 0);
  const rules =
    index === 0
      ? 'За прохождение старта получите 200 ¤.'
      : index === 10
        ? 'В гостях можно просто остановиться. В тюрьме выбросьте дубль или заплатите залог 50 ¤. После трёх неудачных бросков залог обязателен.'
        : index === 20
          ? 'Бесплатная стоянка. Никаких дополнительных сборов или выплат.'
          : index === 30
            ? 'Переместитесь в тюрьму. Выплаты за прохождение старта нет.'
            : index === 4 || index === 38
              ? `Оплатите в банк ${price} ¤.`
              : 'Возьмите карточку и выполните её указание. Последнюю выпавшую карточку можно прочитать в центре поля.';
  return (
    <PropertyModal title={t(name)} onClose={onClose}>
      {mine && active && (
        <div className="mono-deed-tabs">
          <button type="button" aria-pressed={!manage} onClick={() => setManage(false)}>
            {t('Карточка')}
          </button>
          <button type="button" aria-pressed={manage} onClick={() => setManage(true)}>
            {t('Управление')}
          </button>
        </div>
      )}
      <article
        className={`mono-deed ${manage ? 'mono-deed-hidden' : ''}`}
        style={{ '--group-color': propertyColors[group] ?? '#b8a16a' } as CSSProperties}
      >
        <div className="mono-deed-title">
          <small>{t(group >= 0 ? 'Свидетельство собственности' : 'Правила клетки')}</small>
          <h2>{t(name)}</h2>
        </div>
        {group < 0 ? (
          <p className="mono-card-copy">{t(rules)}</p>
        ) : (
          <>
            <p className="mono-deed-owner">
              {t('Владелец')}:{' '}
              <strong>
                {owner < 0 ? t('Банк') : playerName(table.seats[owner], participants)}
              </strong>
              {mortgaged && <b>{t('В залоге')}</b>}
            </p>
            <dl>
              {group === 8 ? (
                <>
                  <div>
                    <dt>{t('Один вокзал')}</dt>
                    <dd>25 ¤</dd>
                  </div>
                  <div>
                    <dt>{t('Два вокзала')}</dt>
                    <dd>50 ¤</dd>
                  </div>
                  <div>
                    <dt>{t('Три вокзала')}</dt>
                    <dd>100 ¤</dd>
                  </div>
                  <div>
                    <dt>{t('Четыре вокзала')}</dt>
                    <dd>200 ¤</dd>
                  </div>
                </>
              ) : group === 9 ? (
                <>
                  <div>
                    <dt>{t('Одна станция')}</dt>
                    <dd>{t('Кубики × 4')}</dd>
                  </div>
                  <div>
                    <dt>{t('Обе станции')}</dt>
                    <dd>{t('Кубики × 10')}</dd>
                  </div>
                </>
              ) : (
                rents.map((rent, i) => (
                  <div key={i} className={level === i ? 'is-current' : ''}>
                    <dt>
                      {t(
                        i === 0
                          ? 'Аренда без построек'
                          : i === 5
                            ? 'С отелем'
                            : `${i} ${i === 1 ? 'дом' : i === 4 ? 'дома' : 'дома'}`,
                      )}
                    </dt>
                    <dd>{rent} ¤</dd>
                  </div>
                ))
              )}
            </dl>
            {group < 8 && (
              <small className="mono-deed-note">
                {t('Без построек аренда удваивается, если вся цветовая группа у одного владельца.')}
              </small>
            )}
            <div className="mono-deed-facts">
              <span>
                {t('Цена')}
                <b>{price} ¤</b>
              </span>
              <span>
                {t('Залог')}
                <b>{price / 2} ¤</b>
              </span>
              <span>
                {t('Выкуп залога')}
                <b>{Math.ceil(price * 0.55)} ¤</b>
              </span>
              {group < 8 && (
                <span>
                  {t('Дом / отель')}
                  <b>{housePrice(index)} ¤</b>
                </span>
              )}
            </div>
          </>
        )}
      </article>
      {mine && active && (
        <footer className={`mono-deed-controls ${manage ? 'is-open' : ''}`}>
          {group < 8 && (
            <>
              <button
                type="button"
                disabled={
                  busy ||
                  !canBuild ||
                  level === 5 ||
                  mortgaged ||
                  table.money[seat]! < housePrice(index) ||
                  (level === 4 ? stock.hotels < 1 : stock.houses < 1)
                }
                onClick={() => send({ kind: 'property', action: 'build', index })}
              >
                <House size={16} />
                {t(level === 4 ? 'Построить отель' : 'Построить дом')}
              </button>
              <button
                type="button"
                disabled={busy || !canSell || !level || (level === 5 && stock.houses < 4)}
                onClick={() => send({ kind: 'property', action: 'sell-house', index })}
              >
                {t('Продать постройку')}
              </button>
              {level > 0 && table.propertyRules === 2 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => send({ kind: 'property', action: 'liquidate-group', index })}
                >
                  {t('Продать постройки группы')}
                </button>
              )}
            </>
          )}
          <button
            type="button"
            disabled={busy || !canMortgage}
            onClick={() => send({ kind: 'property', action: 'mortgage', index })}
          >
            <Landmark size={16} />
            {t(mortgaged ? 'Выкупить залог' : 'Заложить')}
          </button>
        </footer>
      )}
    </PropertyModal>
  );
}
function TradeChoices({
  title,
  indices,
  values,
  onChange,
}: {
  title: string;
  indices: number[];
  values: number[];
  onChange(values: number[]): void;
}) {
  const [page, setPage] = useState(0),
    last = Math.max(0, Math.ceil(indices.length / 4) - 1),
    safe = Math.min(page, last);
  return (
    <section className="mono-trade-choices">
      <header>
        <strong>{t(title)}</strong>
        <span>
          <button type="button" disabled={safe === 0} onClick={() => setPage(safe - 1)}>
            ‹
          </button>
          {safe + 1}/{last + 1}
          <button type="button" disabled={safe === last} onClick={() => setPage(safe + 1)}>
            ›
          </button>
        </span>
      </header>
      <div>
        {indices.slice(safe * 4, safe * 4 + 4).map((i) => (
          <label key={i}>
            <input
              type="checkbox"
              checked={values.includes(i)}
              onChange={() =>
                onChange(values.includes(i) ? values.filter((x) => x !== i) : [...values, i])
              }
            />
            {t(propertyBoard[i]![0])}
          </label>
        ))}
        {!indices.length && <p>{t('Пока нет собственности')}</p>}
      </div>
    </section>
  );
}
export function PropertyTrade({
  table,
  selfId,
  participants,
  send,
  onClose,
}: TableUiProps<TableOf<'monopoly'>> & { onClose(): void }) {
  const seat = table.seats.indexOf(selfId ?? ''),
    targets = table.seats.flatMap((id, i) =>
      id && i !== seat && !table.bankrupt.includes(i) ? [i] : [],
    );
  const [to, setTo] = useState(targets[0] ?? -1),
    [give, setGive] = useState<number[]>([]),
    [want, setWant] = useState<number[]>([]),
    [cash, setCash] = useState('0');
  const pending = table.trade;
  return (
    <PropertyModal
      title={t(pending ? 'Предложение обмена' : 'Обмен собственностью')}
      onClose={onClose}
    >
      {pending ? (
        <div className="mono-trade-review">
          <h4>
            {playerName(table.seats[pending.from], participants)} →{' '}
            {playerName(table.seats[pending.to], participants)}
          </h4>
          <p>
            {t('Отдаёт')}: {pending.give.map((i) => t(propertyBoard[i]![0])).join(', ') || '—'}
          </p>
          <p>
            {t('Просит')}: {pending.want.map((i) => t(propertyBoard[i]![0])).join(', ') || '—'}
          </p>
          <strong>
            {t('Доплата')}: {pending.cash} ¤
          </strong>
          {pending.to === seat && (
            <div className="mono-buttons">
              <button
                type="button"
                className="mono-primary"
                onClick={() => {
                  send({ kind: 'property-trade-answer', accept: true });
                  onClose();
                }}
              >
                {t('Принять')}
              </button>
              <button
                type="button"
                onClick={() => {
                  send({ kind: 'property-trade-answer', accept: false });
                  onClose();
                }}
              >
                {t('Отклонить')}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="mono-trade-form">
          <label>
            {t('Кому предложить обмен')}
            <select
              value={to}
              onChange={(e) => {
                setTo(Number(e.target.value));
                setWant([]);
              }}
            >
              {targets.map((i) => (
                <option key={i} value={i}>
                  {playerName(table.seats[i], participants)}
                </option>
              ))}
            </select>
          </label>
          <TradeChoices
            title="Вы отдаёте"
            indices={table.owners.flatMap((o, i) =>
              o === seat && propertyGroup(i).every((j) => table.houses[j] === 0) ? [i] : [],
            )}
            values={give}
            onChange={setGive}
          />
          <TradeChoices
            title="Вы получаете"
            indices={table.owners.flatMap((o, i) =>
              o === to && propertyGroup(i).every((j) => table.houses[j] === 0) ? [i] : [],
            )}
            values={want}
            onChange={setWant}
          />
          <label>
            {t('Доплата от вас / вам')}
            <input
              type="number"
              min={-10000}
              max={10000}
              value={cash}
              onChange={(e) => setCash(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="mono-primary"
            disabled={
              to < 0 ||
              !Number.isSafeInteger(Number(cash)) ||
              Math.abs(Number(cash)) > 10000 ||
              cash.trim() === ''
            }
            onClick={() => {
              send({ kind: 'property-trade', to, give, want, cash: Number(cash) });
              onClose();
            }}
          >
            {t('Отправить предложение')}
          </button>
        </div>
      )}
    </PropertyModal>
  );
}

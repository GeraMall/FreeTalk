import type { TableOf, RoomActivityAction } from '@freetalk/protocol';
import { t } from '../lib/app-language';
const modes = [
  ['classic', 'Обычный стол', 'Блайнды 10 / 20. Три докупки по 1000.'],
  ['tournament', 'Турнир с повышением', 'Блайнды удваиваются каждые 15 минут. Без докупок.'],
  ['tournament-fixed', 'Турнир без повышения', 'Постоянные блайнды 10 / 20. Без докупок.'],
] as const;
export function PokerRulesPicker({
  table,
  host,
  send,
}: {
  table: TableOf<'poker'>;
  host: boolean;
  send: (action: RoomActivityAction) => void;
}) {
  if (table.edition !== 3) return null;
  const config = (
    mode: NonNullable<typeof table.pokerMode>,
    ante: boolean,
    ageConfirmed = table.ageConfirmed,
  ) => send({ kind: 'poker-config', mode, ante, ageConfirmed });
  return (
    <div className="poker-rules-picker">
      <div className="poker-modes" role="group" aria-label={t('Режим покера')}>
        {modes.map(([mode, title, text]) => (
          <button
            type="button"
            disabled={!host}
            key={mode}
            aria-pressed={(table.pokerMode ?? 'classic') === mode}
            onClick={() => config(mode, Boolean(table.pokerAnte))}
          >
            <strong>{t(title)}</strong>
            <small>{t(text)}</small>
          </button>
        ))}
      </div>
      <label className="poker-rule-check">
        <input
          type="checkbox"
          disabled={!host}
          checked={Boolean(table.pokerAnte)}
          onChange={(e) => config(table.pokerMode ?? 'classic', e.target.checked)}
        />
        <span>
          <strong>{t('Играть с анте')}</strong>
          <small>
            {t(
              'Каждый игрок вносит 10% большого блайнда в банк перед раздачей. Эта сумма не заменяет блайнд.',
            )}
          </small>
        </span>
      </label>
      <label className="poker-rule-check poker-age-check">
        <input
          type="checkbox"
          disabled={!host}
          checked={Boolean(table.ageConfirmed)}
          onChange={(e) =>
            config(table.pokerMode ?? 'classic', Boolean(table.pokerAnte), e.target.checked)
          }
        />
        <span>
          <strong>{t('Подтверждаю: всем людям за столом исполнилось 18 лет.')}</strong>
          <small>
            {t(
              'Как организатор подтверждаю возраст участников. Используем только виртуальные фишки, без денег и призов. Сервер отдельно проверяет возраст по данным аккаунтов.',
            )}
          </small>
        </span>
      </label>
    </div>
  );
}

import type { TableOf, RoomActivityAction } from '@freetalk/protocol';
import type { Ref } from 'react';
import { t } from '../lib/app-language';
const modes = [
  ['classic', 'Обычный стол', 'Блайнды 10 / 20. Три докупки по 1000.'],
  [
    'tournament',
    'Турнир с повышением',
    '15 минут игры, 5 минут перерыва, затем блайнды ×2. Без докупок.',
  ],
  ['tournament-fixed', 'Турнир без повышения', 'Постоянные блайнды 10 / 20. Без докупок.'],
] as const;
export function PokerRulesPicker({
  table,
  host,
  send,
  ageError = false,
  ageInputRef,
  ageErrorId,
}: {
  table: TableOf<'poker'>;
  host: boolean;
  send: (action: RoomActivityAction) => void;
  ageError?: boolean;
  ageInputRef?: Ref<HTMLInputElement>;
  ageErrorId?: string;
}) {
  if (table.edition !== 3) return null;
  const description = (mode: string, text: string) =>
    mode === 'tournament' && table.pokerFlow !== 2
      ? 'Блайнды удваиваются каждые 15 минут. Без докупок.'
      : text;
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
            <small>{t(description(mode, text))}</small>
          </button>
        ))}
      </div>
      <p className="poker-selected-mode">
        {t(
          description(
            table.pokerMode ?? 'classic',
            modes.find(([mode]) => mode === (table.pokerMode ?? 'classic'))![2],
          ),
        )}
      </p>
      <label className="poker-rule-check">
        <input
          type="checkbox"
          disabled={!host}
          checked={Boolean(table.pokerAnte)}
          onChange={(e) => config(table.pokerMode ?? 'classic', e.target.checked)}
        />
        <span>
          <strong>{t('Играть с анте')}</strong>
          <small>{t('10% большого блайнда с каждого перед раздачей, сверх блайндов.')}</small>
        </span>
      </label>
      <label className={`poker-rule-check poker-age-check ${ageError ? 'has-error' : ''}`}>
        <input
          ref={ageInputRef}
          type="checkbox"
          aria-invalid={ageError || undefined}
          aria-describedby={ageError ? ageErrorId : undefined}
          disabled={!host}
          checked={Boolean(table.ageConfirmed)}
          onChange={(e) =>
            config(table.pokerMode ?? 'classic', Boolean(table.pokerAnte), e.target.checked)
          }
        />
        <span>
          <strong>{t('Подтверждаю: всем участникам исполнилось 18 лет.')}</strong>
          <small>
            {t(
              'Только виртуальные фишки, без денег и призов. Сервер проверит возраст по аккаунтам.',
            )}
          </small>
        </span>
      </label>
    </div>
  );
}

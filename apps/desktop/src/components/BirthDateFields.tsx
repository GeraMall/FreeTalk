import { useState } from 'react';
import { BirthDatePicker } from './BirthDatePicker';
import { appLanguage, t } from '../lib/app-language';

export function RequiredMark() {
  return <span className="auth-required-mark" aria-hidden="true" />;
}

const months = Array.from({ length: 12 }, (_, index) => index + 1);
const days = Array.from({ length: 31 }, (_, index) => ({
  value: String(index + 1),
  label: String(index + 1),
}));
const pad = (value: string) => value.padStart(2, '0');

function birthDateValue(
  { day, month, year }: { day: string; month: string; year: string },
  today: string,
) {
  if (!day || !month || !year) return '';
  const candidate = `${year}-${pad(month)}-${pad(day)}`;
  const parsed = new Date(candidate);
  return candidate <= today &&
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === candidate
    ? candidate
    : '';
}

export function BirthDateFields({ onChange }: { onChange(value: string): void }) {
  const [date, setDate] = useState({ day: '', month: '', year: '' });
  const today = new Date().toISOString().slice(0, 10);
  const year = Number(today.slice(0, 4));
  const monthName = new Intl.DateTimeFormat(appLanguage(), { month: 'long', timeZone: 'UTC' });
  const invalid = date.day && date.month && date.year && !birthDateValue(date, today);

  function update(field: keyof typeof date, selected: string) {
    const next = { ...date, [field]: selected };
    setDate(next);
    onChange(birthDateValue(next, today));
  }

  return (
    <fieldset className="birth-date-fields">
      <legend>
        {t('Дата рождения')} <RequiredMark />
      </legend>
      <div className="birth-date-selects">
        <BirthDatePicker
          label={t('День')}
          value={date.day}
          options={days}
          onChange={(value) => update('day', value)}
        />
        <BirthDatePicker
          label={t('Месяц')}
          value={date.month}
          options={months.map((month) => ({
            value: String(month),
            label: monthName.format(new Date(Date.UTC(2000, month - 1, 1))),
          }))}
          onChange={(value) => update('month', value)}
        />
        <BirthDatePicker
          label={t('Год')}
          value={date.year}
          options={Array.from({ length: year - 1899 }, (_, index) => {
            const value = String(year - index);
            return { value, label: value };
          })}
          onChange={(value) => update('year', value)}
        />
      </div>
      {invalid && <small className="validation-error">{t('Проверьте дату рождения')}</small>}
    </fieldset>
  );
}

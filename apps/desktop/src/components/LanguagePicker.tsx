import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  appLanguage,
  appLanguages,
  changeAppLanguage,
  isAppLanguage,
  t,
} from '../lib/app-language';

export function LanguagePicker({ compact = false }: { compact?: boolean }) {
  const [languageChanging, setLanguageChanging] = useState(false);
  const [languageError, setLanguageError] = useState(false);
  const languageInUse = appLanguage();

  return (
    <div className={compact ? 'welcome-language-picker' : undefined}>
      <details
        className="history-period-menu language-menu"
        onBlur={(event) => {
          if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
            event.currentTarget.open = false;
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && event.currentTarget.open) {
            event.currentTarget.open = false;
            event.currentTarget.querySelector('summary')?.focus();
          }
        }}
      >
        <summary aria-label={t('Язык программы')}>
          <span lang={languageInUse}>
            {compact ? languageInUse.toUpperCase() : appLanguages[languageInUse]}
          </span>
          <ChevronDown size={15} aria-hidden="true" />
        </summary>
        <div className="history-period-options" role="group" aria-label={t('Язык программы')}>
          {Object.entries(appLanguages).map(([language, label]) => (
            <button
              key={language}
              type="button"
              lang={language}
              aria-pressed={languageInUse === language}
              disabled={languageChanging}
              onClick={(event) => {
                const menu = event.currentTarget.closest('details');
                if (menu) {
                  menu.open = false;
                  menu.querySelector('summary')?.focus();
                }
                if (!isAppLanguage(language) || language === languageInUse) return;
                setLanguageChanging(true);
                setLanguageError(false);
                void changeAppLanguage(language).catch(() => {
                  setLanguageChanging(false);
                  setLanguageError(true);
                  menu?.querySelector('summary')?.focus();
                });
              }}
            >
              {label}
              {languageInUse === language && <Check size={15} aria-hidden="true" />}
            </button>
          ))}
        </div>
      </details>
      {languageChanging && <p role="status">{t('Перезапускаем приложение…')}</p>}
      {languageError && <p role="alert">{t('Не удалось изменить язык программы.')}</p>}
    </div>
  );
}

import { useSyncExternalStore } from 'react';
import { Check, Palette, Cloud } from 'lucide-react';
import { interfaceTheme, interfaceThemes } from '../lib/interface-theme';
import { t } from '../lib/app-language';
const names = { default: 'Космическая', light: 'Светлая', black: 'Чёрная' } as const;
export function InterfaceAppearance() {
  const state = useSyncExternalStore(interfaceTheme.subscribe, interfaceTheme.snapshot);
  return (
    <div className="chat-settings-group interface-appearance">
      <div className="video-section-heading">
        <span className="profile-zone-icon">
          <Palette />
        </span>
        <div>
          <h3>{t('Цветовая тема')}</h3>
          <p className="settings-section-description">
            {t('Выберите оформление для этого устройства.')}
          </p>
        </div>
      </div>
      <div className="interface-theme-options" role="group" aria-label={t('Цветовая тема')}>
        {interfaceThemes.map((theme) => (
          <button
            type="button"
            className="interface-theme-option"
            aria-pressed={state.theme === theme}
            key={theme}
            onClick={() => interfaceTheme.choose(theme)}
          >
            <span className={`interface-theme-swatch theme-swatch-${theme}`} aria-hidden="true">
              <i />
              <span>
                <b />
                <b />
                <em />
              </span>
            </span>
            <span>
              {t(names[theme])}
              {state.theme === theme && <Check size={16} />}
            </span>
          </button>
        ))}
      </div>
      <label className="theme-sync-control">
        <Cloud size={20} />
        <span>
          <strong>{t('Синхронизировать темы')}</strong>
          <small>{t('При входе на другом устройстве применится тема из аккаунта.')}</small>
        </span>
        <input
          type="checkbox"
          checked={state.syncEnabled}
          disabled={!state.account || !state.ready || !state.available || state.busy}
          onChange={(event) => interfaceTheme.toggleSync(event.target.checked)}
        />
      </label>
      <p className="theme-storage-note" role="status">
        {state.busy
          ? t('Сохраняем тему…')
          : !state.available && state.ready && state.account
            ? t('Синхронизация пока недоступна. Тема сохраняется на этом устройстве.')
            : state.error
              ? t('Не удалось синхронизировать тему. Локальный выбор сохранён.')
              : state.syncEnabled
                ? t('Тема синхронизируется с вашим аккаунтом.')
                : t('Тема сохраняется только на этом устройстве.')}
      </p>
    </div>
  );
}

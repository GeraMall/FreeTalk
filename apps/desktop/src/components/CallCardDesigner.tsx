import { t } from '../lib/app-language';
import { Crown, Sparkles } from 'lucide-react';

export function CallCardDesigner({
  name,
  avatar,
  glass,
  onGlass,
}: {
  name: string;
  avatar: string;
  glass: boolean;
  onGlass(value: boolean): void;
}) {
  return (
    <section className="profile-zone profile-card-design call-card-designer">
      <div className="profile-card-design-heading">
        <span>
          <strong>{t('Ваша карточка в звонке')}</strong>
          <small>
            {t('Так выглядит карточка участника. Эффект сохранится по кнопке «Готово».')}
          </small>
        </span>
        <Sparkles aria-hidden="true" />
      </div>
      <div className="call-card-stage">
        <div
          className={`profile-card-preview participant-card audio-tile call-card-tilt ${glass && avatar ? 'avatar-glass' : ''}`}
        >
          {glass && avatar ? (
            <span className="participant-card-ambient" aria-hidden="true">
              <img src={avatar} alt="" draggable={false} />
            </span>
          ) : null}
          <div className="participant-card-top media-overlay-top">
            <span className="creator-badge">
              <Crown size={13} /> {t('Создатель комнаты')}
            </span>
          </div>
          <div className="participant-avatar" data-variant="1">
            {avatar ? (
              <img src={avatar} alt="" draggable={false} />
            ) : (
              <span>{name.trim().charAt(0).toUpperCase() || '?'}</span>
            )}
            <i aria-label={t('В сети')} />
          </div>
          <div className="participant-info">
            <div className="participant-name-row">
              <div className="participant-name">
                <strong>{name.trim() || 'Ваше имя'}</strong>
                <span>{t('вы')}</span>
              </div>
            </div>
            <div className="participant-status">
              <i /> {t('Слушает')}
            </div>
          </div>
        </div>
      </div>
      <div className="call-card-glass-control">
        <span>
          <strong>{t('Жидкое стекло')}</strong>
          <small>
            {avatar
              ? t('Мягкое размытие и оттенки вашей аватарки')
              : t('Добавьте аватарку, чтобы включить эффект')}
          </small>
        </span>
        <span className="call-card-toggle-label">{glass ? t('С эффектом') : t('Без эффекта')}</span>
        <button
          type="button"
          className={`switch ${glass ? 'on' : ''}`}
          role="switch"
          aria-label={t('Жидкое стекло')}
          aria-checked={glass}
          disabled={!avatar}
          onClick={() => onGlass(!glass)}
        >
          <span />
        </button>
      </div>
    </section>
  );
}

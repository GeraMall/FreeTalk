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
          <strong>Ваша карточка в звонке</strong>
          <small>Так выглядит карточка участника. Эффект сохранится по кнопке «Готово».</small>
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
              <Crown size={13} /> Создатель комнаты
            </span>
          </div>
          <div className="participant-avatar" data-variant="1">
            {avatar ? (
              <img src={avatar} alt="" draggable={false} />
            ) : (
              <span>{name.trim().charAt(0).toUpperCase() || '?'}</span>
            )}
            <i aria-label="В сети" />
          </div>
          <div className="participant-info">
            <div className="participant-name-row">
              <div className="participant-name">
                <strong>{name.trim() || 'Ваше имя'}</strong>
                <span>вы</span>
              </div>
            </div>
            <div className="participant-status">
              <i /> Слушает
            </div>
          </div>
        </div>
      </div>
      <div className="call-card-glass-control">
        <span>
          <strong>Жидкое стекло</strong>
          <small>
            {avatar
              ? 'Мягкое размытие и оттенки вашей аватарки'
              : 'Добавьте аватарку, чтобы включить эффект'}
          </small>
        </span>
        <span className="call-card-toggle-label">{glass ? 'С эффектом' : 'Без эффекта'}</span>
        <button
          type="button"
          className={`switch ${glass ? 'on' : ''}`}
          role="switch"
          aria-label="Жидкое стекло"
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

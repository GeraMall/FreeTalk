import { ChevronDown, Crown, ImagePlus, Sparkles } from 'lucide-react';
import type { ParticipantCardDecoration } from '@freetalk/protocol';

const decorations: Array<{
  id: ParticipantCardDecoration;
  label: string;
  image?: string;
}> = [
  { id: 'none', label: 'Без узора' },
  { id: 'japan', label: 'Япония', image: '/card-decorations/japan.png' },
  { id: 'china', label: 'Китай', image: '/card-decorations/china.png' },
  { id: 'britain', label: 'Британия', image: '/card-decorations/britain.png' },
  { id: 'kazakhstan', label: 'Казахстан', image: '/card-decorations/kazakhstan.png' },
  { id: 'russia', label: 'Россия', image: '/card-decorations/russia.png' },
];

export function CallCardDesigner({
  name,
  avatar,
  glass,
  decoration,
  onGlass,
  onDecoration,
}: {
  name: string;
  avatar: string;
  glass: boolean;
  decoration: ParticipantCardDecoration;
  onGlass(value: boolean): void;
  onDecoration(value: ParticipantCardDecoration): void;
}) {
  return (
    <section className="profile-zone profile-card-design call-card-designer">
      <div className="profile-card-design-heading">
        <span>
          <strong>Ваша карточка в звонке</strong>
          <small>Так выглядит карточка участника. Оформление сохранится по кнопке «Готово».</small>
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
          {decoration !== 'none' ? (
            <img
              className="participant-card-decoration"
              src={`/card-decorations/${decoration}.png`}
              alt=""
              draggable={false}
            />
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
      <details className="call-card-decoration-options">
        <summary>
          <span>
            <ImagePlus size={18} /> Элементы оформления
          </span>
          <ChevronDown size={16} />
        </summary>
        <div>
          <strong>Узоры и украшения</strong>
          <p>Выберите узор, который увидят остальные участники звонка.</p>
          <div className="call-card-decoration-grid" role="radiogroup" aria-label="Узор карточки">
            {decorations.map((item) => (
              <button
                key={item.id}
                type="button"
                className={decoration === item.id ? 'selected' : ''}
                role="radio"
                aria-checked={decoration === item.id}
                onClick={() => onDecoration(item.id)}
              >
                <span className="call-card-decoration-thumb">
                  {item.image ? <img src={item.image} alt="" loading="lazy" /> : <i />}
                </span>
                <strong>{item.label}</strong>
              </button>
            ))}
          </div>
        </div>
      </details>
    </section>
  );
}

import { useRef, type PointerEvent } from 'react';
import { ChevronDown, Crown, ImagePlus, Sparkles } from 'lucide-react';

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
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (
      event.pointerType !== 'mouse' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const held = drag.current;
    const x = held
      ? (event.clientX - held.x) / 9
      : ((event.clientX - bounds.left) / bounds.width - 0.5) * 14;
    const y = held
      ? (event.clientY - held.y) / 9
      : ((event.clientY - bounds.top) / bounds.height - 0.5) * 10;
    surface.current?.style.setProperty('--card-rx', `${Math.max(-20, Math.min(20, -y))}deg`);
    surface.current?.style.setProperty('--card-ry', `${Math.max(-26, Math.min(26, x))}deg`);
  };
  const reset = () => {
    drag.current = null;
    surface.current?.style.setProperty('--card-rx', '0deg');
    surface.current?.style.setProperty('--card-ry', '0deg');
    surface.current?.removeAttribute('data-dragging');
  };
  return (
    <section className="profile-zone profile-card-design call-card-designer">
      <div className="profile-card-design-heading">
        <span>
          <strong>Ваша карточка в звонке</strong>
          <small>Так выглядит карточка участника. Оформление сохранится по кнопке «Готово».</small>
        </span>
        <Sparkles aria-hidden="true" />
      </div>
      <div
        className="call-card-stage"
        onPointerMove={move}
        onPointerDown={(event) => {
          if (event.button !== 0 || event.pointerType !== 'mouse') return;
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
          surface.current?.setAttribute('data-dragging', 'true');
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          reset();
        }}
        onLostPointerCapture={reset}
        onPointerCancel={reset}
        onPointerLeave={() => {
          if (!drag.current) reset();
        }}
      >
        <div
          ref={surface}
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
      <p className="call-card-motion-hint">
        Наведите мышь, чтобы наклонить · Зажмите и двигайте, чтобы покрутить
      </p>
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
          <p>
            Здесь появится выбор PNG-узоров для карточки, когда они будут добавлены в коллекцию.
          </p>
        </div>
      </details>
    </section>
  );
}

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { t } from '../lib/app-language';
import {
  diceLimits,
  diceRotations,
  restDice,
  settleDice,
  stepDice,
  throwDice,
  type DiceBody,
  type DiceBounds,
} from '../lib/monopoly-dice';
const faces = [[4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];
export function PropertyDice({
  dice,
  rolling,
  sequence,
  startAt,
  canRoll,
  onRoll,
  onShake,
  onImpact,
}: {
  dice: [number, number];
  rolling: boolean;
  sequence: number;
  startAt?: number;
  canRoll: boolean;
  onRoll(): void;
  onShake(): void;
  onImpact?(): void;
}) {
  const root = useRef<HTMLButtonElement>(null),
    wrappers = useRef<(HTMLSpanElement | null)[]>([]),
    cubes = useRef<(HTMLSpanElement | null)[]>([]),
    shadows = useRef<(HTMLSpanElement | null)[]>([]);
  const bounds = useRef<DiceBounds>({ width: 260, height: 180, size: 42 }),
    bodies = useRef(restDice(bounds.current));
  const grab = useRef<
      | {
          id: number;
          clientX: number;
          clientY: number;
          positions: DiceBody[];
          lastX: number;
          lastY: number;
          at: number;
        }
      | undefined
    >(undefined),
    velocity = useRef({ x: 0, y: 0, at: 0 });
  const callbacks = useRef({ onRoll, onShake, onImpact });
  callbacks.current = { onRoll, onShake, onImpact };
  const values = useRef(dice);
  values.current = dice;
  const flight = useRef<
      { sequence: number; at: number; last: number; settling?: DiceBody[] } | undefined
    >(undefined),
    wasRolling = useRef(false),
    [held, setHeld] = useState(false);
  const paint = useCallback(() => {
    bodies.current.forEach((b, i) => {
      const wrapper = wrappers.current[i],
        cube = cubes.current[i],
        shadow = shadows.current[i];
      if (wrapper) wrapper.style.transform = `translate3d(${b.x}px,${b.y}px,0)`;
      if (cube)
        cube.style.transform = `translateY(${-Math.min(b.z, Math.max(0, b.y - bounds.current.size * 0.9 - 3))}px) rotateX(${b.rx}deg) rotateY(${b.ry}deg)`;
      if (shadow) {
        shadow.style.transform = `scale(${Math.max(0.45, 1 - b.z / 150)})`;
        shadow.style.opacity = String(Math.max(0.12, 0.36 - b.z / 260));
      }
    });
  }, []);
  const alignFaces = useCallback(() => {
    bodies.current = bodies.current.map((b, i) => {
      const r = diceRotations[Math.max(0, values.current[i]! - 1)] ?? diceRotations[0];
      return { ...b, z: 0, rx: r[0] - 18, ry: r[1] + 22 };
    });
    paint();
  }, [paint]);
  // Size is read from the entire felt; positions are clamped again after a resize.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let initial = true;
    const measure = () => {
      const old = bounds.current,
        later = {
          width: el.clientWidth || 260,
          height: el.clientHeight || 180,
          size: parseFloat(getComputedStyle(el).getPropertyValue('--die-size')) || 42,
        };
      bounds.current = later;
      const limits = diceLimits(later);
      bodies.current = initial
        ? restDice(later)
        : bodies.current.map((b) => ({
            ...b,
            x: Math.max(limits.left, Math.min(limits.right, (b.x * later.width) / old.width)),
            y: Math.max(limits.top, Math.min(limits.bottom, (b.y * later.height) / old.height)),
          }));
      initial = false;
      paint();
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [paint]);
  useEffect(() => {
    const reduce =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!rolling) {
      wasRolling.current = false;
      flight.current = undefined;
      if (!grab.current) alignFaces();
      return;
    }
    const at = startAt ?? Date.now();
    if (!wasRolling.current || !flight.current) {
      bodies.current = throwDice(bodies.current, sequence, velocity.current);
      flight.current = { sequence, at, last: at };
    } else if (flight.current.sequence !== sequence) {
      flight.current.sequence = sequence;
      flight.current.at = at;
      flight.current.last = Math.max(flight.current.last, at);
    }
    wasRolling.current = true;
    let raf = 0;
    const animate = () => {
      const f = flight.current;
      if (!f) return;
      const now = Date.now(),
        elapsed = now - f.at;
      if (reduce || elapsed >= 890) {
        alignFaces();
        return;
      }
      if (elapsed < 630) {
        let dt = Math.max(0, Math.min(0.06, (now - f.last) / 1000));
        while (dt > 0) {
          const step = Math.min(dt, 1 / 120);
          if (stepDice(bodies.current, bounds.current, step)) callbacks.current.onImpact?.();
          dt -= step;
        }
      } else {
        f.settling ??= bodies.current.map((b) => ({ ...b }));
        bodies.current = settleDice(f.settling, values.current, (elapsed - 630) / 250);
      }
      f.last = now;
      paint();
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [rolling, sequence, startAt, alignFaces, paint]);
  const release = (cancelled = false) => {
    if (!grab.current) return;
    grab.current = undefined;
    setHeld(false);
    if (cancelled || !canRoll) {
      bodies.current = restDice(bounds.current);
      alignFaces();
      return;
    }
    if (Date.now() - velocity.current.at > 100) velocity.current = { x: 0, y: 0, at: Date.now() };
    callbacks.current.onRoll();
  };
  return (
    <button
      ref={root}
      type="button"
      className={`mono-dice-tray ${held ? 'is-held' : ''} ${rolling ? 'is-rolling' : ''}`}
      aria-label={t('Кубики: зажмите, встряхните и отпустите')}
      aria-disabled={!canRoll}
      onPointerDown={(e) => {
        if (!canRoll || e.button !== 0 || grab.current) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        grab.current = {
          id: e.pointerId,
          clientX: e.clientX,
          clientY: e.clientY,
          positions: bodies.current.map((b) => ({ ...b })),
          lastX: e.clientX,
          lastY: e.clientY,
          at: Date.now(),
        };
        velocity.current = { x: 0, y: 0, at: Date.now() };
        setHeld(true);
      }}
      onPointerMove={(e) => {
        const g = grab.current;
        if (!g || g.id !== e.pointerId) return;
        const now = Date.now(),
          dt = Math.max(8, now - g.at),
          dx = e.clientX - g.clientX,
          dy = e.clientY - g.clientY,
          l = diceLimits(bounds.current);
        velocity.current = {
          x: ((e.clientX - g.lastX) / dt) * 1000,
          y: ((e.clientY - g.lastY) / dt) * 1000,
          at: now,
        };
        bodies.current = g.positions.map((b, i) => ({
          ...b,
          x: Math.max(l.left, Math.min(l.right, b.x + dx)),
          y: Math.max(l.top, Math.min(l.bottom, b.y + dy)),
          z: 6,
          rx: b.rx + dy * 3 + (i ? 10 : 0),
          ry: b.ry + dx * 3,
        }));
        g.lastX = e.clientX;
        g.lastY = e.clientY;
        g.at = now;
        paint();
        callbacks.current.onShake();
      }}
      onPointerUp={(e) => {
        if (e.pointerId === grab.current?.id) release();
      }}
      onPointerCancel={(e) => {
        if (e.pointerId === grab.current?.id) release(true);
      }}
      onLostPointerCapture={(e) => {
        if (e.pointerId === grab.current?.id) release(true);
      }}
      onClick={(e) => {
        if (e.detail === 0 && canRoll && !grab.current) {
          velocity.current = { x: 0, y: 0, at: Date.now() };
          callbacks.current.onRoll();
        }
      }}
    >
      <span className="mono-dice-stage" aria-hidden="true">
        {dice.map((value, i) => {
          const r = diceRotations[Math.max(0, value - 1)] ?? diceRotations[0];
          return (
            <span
              key={i}
              ref={(el) => {
                wrappers.current[i] = el;
              }}
              className={`mono-die-body die-body-${i}`}
            >
              <span
                ref={(el) => {
                  shadows.current[i] = el;
                }}
                className="mono-die-shadow"
              />
              <span
                ref={(el) => {
                  cubes.current[i] = el;
                }}
                className={`mono-die die-${i}`}
                style={{ '--rx': `${r[0]}deg`, '--ry': `${r[1]}deg` } as CSSProperties}
              >
                {faces.map((pips, n) => (
                  <span key={n} className={`mono-die-face face-${n + 1}`}>
                    {Array.from({ length: 9 }, (_, j) => (
                      <i key={j} className={pips.includes(j) ? 'is-pip' : ''} />
                    ))}
                  </span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
      <span className="mono-dice-help">
        {t(
          held
            ? 'Отпустите, чтобы бросить'
            : rolling
              ? 'Кубики катятся…'
              : canRoll
                ? 'Зажмите кубики и перемещайте по полю'
                : 'Ожидаем ход игрока',
        )}
      </span>
      <span className="mono-dice-result">
        {dice[0] > 0 ? `${dice[0]} + ${dice[1]} = ${dice[0] + dice[1]}` : '—'}
      </span>
    </button>
  );
}

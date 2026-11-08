import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from 'react';
import type { DiceGesture, DiceMotion } from '@freetalk/protocol';
import { t } from '../lib/app-language';
import {
  diceLimits,
  diceRotations,
  restDice,
  diceRollFrames,
  sampleDiceRoll,
  DICE_ROLL_MS,
  DICE_SHAKE_MS,
  type DiceBody,
  type DiceBounds,
} from '../lib/monopoly-dice';
const faces = [[4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export interface PropertyDiceControls {
  roll(): void;
}
export function PropertyDice({
  controls,
  dice,
  rolling,
  sequence,
  startAt,
  durationMs = DICE_ROLL_MS,
  motion,
  remote,
  actorName,
  onGesture,
  canRoll,
  onRoll,
  onShake,
  onThrowSound,
  onStopped,
}: {
  controls?: Ref<PropertyDiceControls>;
  dice: [number, number];
  rolling: boolean;
  sequence: number;
  startAt?: number;
  durationMs?: number;
  motion?: DiceMotion;
  remote?: DiceGesture;
  actorName?: string;
  onGesture?(gesture: DiceGesture): void;
  canRoll: boolean;
  onRoll(): void;
  onShake(): void;
  onThrowSound?(elapsed: number): void;
  onStopped?(): void;
}) {
  const root = useRef<HTMLButtonElement>(null),
    wrappers = useRef<(HTMLSpanElement | null)[]>([]),
    cubes = useRef<(HTMLSpanElement | null)[]>([]),
    shadows = useRef<(HTMLSpanElement | null)[]>([]);
  const bounds = useRef<DiceBounds>({ width: 260, height: 180, size: 42 }),
    bodies = useRef(restDice(bounds.current));
  const grab = useRef<
      | {
          pointerId: number;
          id: string;
          seq: number;
          sentAt: number;
          clientX: number;
          clientY: number;
          positions: DiceBody[];
          lastX: number;
          lastY: number;
          at: number;
          moved: boolean;
        }
      | undefined
    >(undefined),
    velocity = useRef({ x: 0, y: 0, at: 0 });
  const callbacks = useRef({ onRoll, onShake, onThrowSound, onStopped, onGesture });
  callbacks.current = { onRoll, onShake, onThrowSound, onStopped, onGesture };
  const values = useRef(dice),
    rollMotion = useRef(motion),
    mirror = useRef(remote);
  values.current = dice;
  rollMotion.current = motion;
  mirror.current = remote;
  const lastRemote = useRef<DiceGesture>(undefined),
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
        shadow.style.transform = `scale(${Math.max(0.6, 1 - b.z / 150)})`;
        shadow.style.opacity = String(Math.max(0.15, 0.32 - b.z / 260));
      }
    });
  }, []);
  const align = useCallback(() => {
    bodies.current = bodies.current.map((b, i) => {
      const r = diceRotations[Math.max(0, values.current[i]! - 1)] ?? diceRotations[0];
      return { ...b, z: 0, rx: r[0], ry: r[1] };
    });
    paint();
  }, [paint]);
  const publish = useCallback((phase: DiceGesture['phase'], force = false) => {
    const g = grab.current;
    if (!g) return;
    const now = Date.now();
    if (!force && now - g.sentAt < 110) return;
    g.sentAt = now;
    const poses = bodies.current.map((b) => ({
      x: clamp(b.x / bounds.current.width, 0, 1),
      y: clamp(b.y / bounds.current.height, 0, 1),
      rx: ((b.rx % 720) + 720) % 720,
      ry: ((b.ry % 720) + 720) % 720,
    })) as DiceMotion['poses'];
    callbacks.current.onGesture?.({
      id: g.id,
      seq: ++g.seq,
      phase,
      automatic: phase === 'release' && !g.moved ? true : undefined,
      poses,
      vx: clamp(velocity.current.x / bounds.current.width, -3, 3),
      vy: clamp(velocity.current.y / bounds.current.height, -3, 3),
    });
  }, []);
  const automaticRoll = () => {
    if (!canRoll || rolling || grab.current) return;
    const id = crypto.randomUUID();
    const poses = bodies.current.map((b) => ({
      x: clamp(b.x / bounds.current.width, 0, 1),
      y: clamp(b.y / bounds.current.height, 0, 1),
      rx: ((b.rx % 720) + 720) % 720,
      ry: ((b.ry % 720) + 720) % 720,
    })) as DiceMotion['poses'];
    const packet = { id, poses, vx: 0, vy: 0, automatic: true as const };
    callbacks.current.onGesture?.({ ...packet, phase: 'hold', seq: 1 });
    callbacks.current.onGesture?.({ ...packet, phase: 'release', seq: 2 });
    callbacks.current.onRoll();
  };
  useImperativeHandle(controls, () => ({ roll: automaticRoll }));
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let initial = true;
    const measure = () => {
      const old = bounds.current,
        next = {
          width: el.clientWidth || 260,
          height: el.clientHeight || 180,
          size: parseFloat(getComputedStyle(el).getPropertyValue('--die-size')) || 42,
        };
      bounds.current = next;
      const l = diceLimits(next);
      bodies.current = initial
        ? restDice(next)
        : bodies.current.map((b) => ({
            ...b,
            x: clamp((b.x * next.width) / old.width, l.left, l.right),
            y: clamp((b.y * next.height) / old.height, l.top, l.bottom),
          }));
      initial = false;
      paint();
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [paint]);
  useEffect(() => {
    if (!held) return;
    const timer = setInterval(() => publish('move'), 250);
    return () => clearInterval(timer);
  }, [held, publish]);
  useEffect(
    () => () => {
      if (grab.current) publish('cancel', true);
      callbacks.current.onStopped?.();
    },
    [publish],
  );
  useEffect(() => {
    if (!rolling) {
      if (!grab.current && !mirror.current) align();
      callbacks.current.onStopped?.();
      return;
    }
    if (startAt === undefined) return;
    const initial = bodies.current.map((b) => ({ ...b })),
      frames = diceRollFrames(values.current, sequence, rollMotion.current, durationMs),
      reduce =
        typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const elapsed = Math.max(0, Date.now() - startAt);
    if (elapsed < durationMs && !reduce) callbacks.current.onThrowSound?.(elapsed);
    let raf = 0;
    const animate = () => {
      const elapsed = reduce ? durationMs : Math.max(0, Date.now() - startAt);
      bodies.current = sampleDiceRoll(frames, elapsed, bounds.current);
      if (!rollMotion.current && elapsed < DICE_SHAKE_MS && !reduce) {
        const p = elapsed / DICE_SHAKE_MS,
          s = p * p * p * (10 - 15 * p + 6 * p * p);
        bodies.current = bodies.current.map((b, i) => ({
          ...b,
          x: initial[i]!.x + (b.x - initial[i]!.x) * s,
          y: initial[i]!.y + (b.y - initial[i]!.y) * s,
          rx: initial[i]!.rx + (((((b.rx - initial[i]!.rx + 180) % 360) + 360) % 360) - 180) * s,
          ry: initial[i]!.ry + (((((b.ry - initial[i]!.ry + 180) % 360) + 360) % 360) - 180) * s,
        }));
      }
      paint();
      if (elapsed < durationMs) raf = requestAnimationFrame(animate);
      else callbacks.current.onStopped?.();
    };
    animate();
    return () => cancelAnimationFrame(raf);
    // Each accepted throw has its own server sequence; gesture packets never restart it.
  }, [rolling, sequence, startAt, durationMs, align, paint]);
  useEffect(() => {
    const previous = lastRemote.current;
    lastRemote.current = remote;
    if (rolling || grab.current) return;
    if (!remote) {
      if (previous) {
        bodies.current = restDice(bounds.current);
        align();
        callbacks.current.onStopped?.();
      }
      return;
    }
    const from = bodies.current.map((b) => ({ ...b })),
      l = diceLimits(bounds.current),
      target = remote.poses.map((p, i) => ({
        ...from[i]!,
        x: clamp(p.x * bounds.current.width, l.left, l.right),
        y: clamp(p.y * bounds.current.height, l.top, l.bottom),
        z: 2,
        rx: p.rx,
        ry: p.ry,
      }));
    if (
      remote.phase !== 'release' &&
      previous &&
      remote.poses.some(
        (p, i) =>
          Math.abs(p.x - previous.poses[i]!.x) + Math.abs(p.y - previous.poses[i]!.y) > 0.003 ||
          Math.abs(p.rx - previous.poses[i]!.rx) + Math.abs(p.ry - previous.poses[i]!.ry) > 4,
      )
    )
      callbacks.current.onShake();
    const at = performance.now();
    let raf = 0;
    const animate = () => {
      const p = clamp((performance.now() - at) / 100, 0, 1),
        s = p * p * (3 - 2 * p);
      bodies.current = target.map((b, i) => ({
        ...b,
        x: from[i]!.x + (b.x - from[i]!.x) * s,
        y: from[i]!.y + (b.y - from[i]!.y) * s,
        rx: from[i]!.rx + (((((b.rx - from[i]!.rx + 180) % 360) + 360) % 360) - 180) * s,
        ry: from[i]!.ry + (((((b.ry - from[i]!.ry + 180) % 360) + 360) % 360) - 180) * s,
      }));
      paint();
      if (p < 1) raf = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(raf);
  }, [remote, rolling, align, paint]);
  const release = (cancelled = false) => {
    if (!grab.current) return;
    if (Date.now() - velocity.current.at > 100) velocity.current = { x: 0, y: 0, at: Date.now() };
    publish(cancelled || !canRoll ? 'cancel' : 'release', true);
    grab.current = undefined;
    setHeld(false);
    callbacks.current.onStopped?.();
    if (cancelled || !canRoll) {
      bodies.current = restDice(bounds.current);
      align();
      return;
    }
    callbacks.current.onRoll();
  };
  const shaking = held || (!!remote && remote.phase !== 'release'),
    throwing = rolling || remote?.phase === 'release';
  return (
    <button
      ref={root}
      type="button"
      className={`mono-dice-tray ${shaking ? 'is-held' : ''} ${throwing ? 'is-rolling' : ''}`}
      aria-label={t('Кубики: зажмите, встряхните и отпустите')}
      aria-disabled={!canRoll}
      onPointerDown={(e) => {
        if (!canRoll || e.button !== 0 || grab.current) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        grab.current = {
          pointerId: e.pointerId,
          id: crypto.randomUUID(),
          seq: 0,
          sentAt: 0,
          clientX: e.clientX,
          clientY: e.clientY,
          positions: bodies.current.map((b) => ({ ...b })),
          lastX: e.clientX,
          lastY: e.clientY,
          at: Date.now(),
          moved: false,
        };
        velocity.current = { x: 0, y: 0, at: Date.now() };
        setHeld(true);
        publish('hold', true);
      }}
      onPointerMove={(e) => {
        const g = grab.current;
        if (!g || g.pointerId !== e.pointerId) return;
        const now = Date.now(),
          dt = Math.max(8, now - g.at),
          dx = e.clientX - g.clientX,
          dy = e.clientY - g.clientY,
          l = diceLimits(bounds.current),
          changed = Math.abs(e.clientX - g.lastX) + Math.abs(e.clientY - g.lastY) > 0.5;
        velocity.current = {
          x: ((e.clientX - g.lastX) / dt) * 1000,
          y: ((e.clientY - g.lastY) / dt) * 1000,
          at: now,
        };
        bodies.current = g.positions.map((b, i) => ({
          ...b,
          x: clamp(b.x + dx, l.left, l.right),
          y: clamp(b.y + dy, l.top, l.bottom),
          z: 3,
          rx: b.rx + dy * (i ? -1.2 : 1.35) + dx * 0.3,
          ry: b.ry + dx * (i ? 1.35 : -1.2) + dy * 0.25,
        }));
        g.lastX = e.clientX;
        g.lastY = e.clientY;
        g.at = now;
        if (Math.hypot(dx, dy) > 4) g.moved = true;
        paint();
        if (changed) callbacks.current.onShake();
        publish('move');
      }}
      onPointerUp={(e) => {
        if (e.pointerId === grab.current?.pointerId) release();
      }}
      onPointerCancel={(e) => {
        if (e.pointerId === grab.current?.pointerId) release(true);
      }}
      onLostPointerCapture={(e) => {
        if (e.pointerId === grab.current?.pointerId) release(true);
      }}
      onClick={(e) => {
        if (e.detail === 0) automaticRoll();
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
      <span className="mono-dice-help" role="status">
        {shaking
          ? `${actorName ?? t('Игрок')} ${t('встряхивает кубики')}`
          : throwing
            ? `${actorName ?? t('Игрок')} ${t('бросает кубики')}`
            : t(canRoll ? 'Зажмите кубики и перемещайте по полю' : 'Ожидаем ход игрока')}
      </span>
      <span className="mono-dice-result" aria-hidden={shaking || throwing}>
        {dice[0] > 0 ? `${dice[0]} + ${dice[1]} = ${dice[0] + dice[1]}` : '—'}
      </span>
    </button>
  );
}

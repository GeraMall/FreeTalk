import { useRef, useState, type CSSProperties } from 'react';
import { t } from '../lib/app-language';
const faces = [[4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];
const rotations = [
  [0, 0],
  [0, -90],
  [90, 0],
  [-90, 0],
  [0, 90],
  [0, 180],
];
export function PropertyDice({
  dice,
  rolling,
  sequence,
  canRoll,
  onRoll,
  onShake,
}: {
  dice: [number, number];
  rolling: boolean;
  sequence: number;
  canRoll: boolean;
  onRoll(): void;
  onShake(): void;
}) {
  const [held, setHeld] = useState(false),
    [shake, setShake] = useState({ x: 0, y: 0 });
  const origin = useRef<{ x: number; y: number; id: number } | undefined>(undefined);
  const release = (cancelled = false) => {
    if (!origin.current) return;
    origin.current = undefined;
    setHeld(false);
    if (!cancelled && canRoll) onRoll();
  };
  return (
    <button
      type="button"
      className={`mono-dice-tray ${held ? 'is-held' : ''} ${rolling ? 'is-rolling' : ''}`}
      aria-label={t('Кубики: зажмите, встряхните и отпустите')}
      aria-disabled={!canRoll}
      onPointerDown={(e) => {
        if (!canRoll || e.button !== 0 || origin.current) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        origin.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        setHeld(true);
      }}
      onPointerMove={(e) => {
        if (!origin.current || origin.current.id !== e.pointerId) return;
        setShake({
          x: Math.max(-24, Math.min(24, (e.clientX - origin.current.x) / 3)),
          y: Math.max(-24, Math.min(24, (e.clientY - origin.current.y) / 3)),
        });
        onShake();
      }}
      onPointerUp={(e) => {
        if (e.pointerId === origin.current?.id) release();
      }}
      onPointerCancel={(e) => {
        if (e.pointerId === origin.current?.id) release(true);
      }}
      onLostPointerCapture={(e) => {
        if (e.pointerId === origin.current?.id) release(true);
      }}
      onClick={(e) => {
        if (e.detail === 0 && canRoll) onRoll();
      }}
    >
      <span className="mono-dice-stage" aria-hidden="true">
        {dice.map((value, i) => {
          const rotation = rotations[Math.max(0, value - 1)] ?? rotations[0]!;
          return (
            <span
              key={`${sequence}:${i}`}
              className={`mono-die die-${i}`}
              style={
                {
                  '--rx': `${rotation[0]}deg`,
                  '--ry': `${rotation[1]}deg`,
                  '--shake-x': `${shake.y * 6}deg`,
                  '--shake-y': `${shake.x * 6}deg`,
                  '--tray-x': `${shake.x * (i ? -0.5 : 0.5)}px`,
                  '--tray-y': `${shake.y * 0.5}px`,
                } as CSSProperties
              }
            >
              {faces.map((pips, n) => (
                <span key={n} className={`mono-die-face face-${n + 1}`}>
                  {Array.from({ length: 9 }, (_, j) => (
                    <i key={j} className={pips.includes(j) ? 'is-pip' : ''} />
                  ))}
                </span>
              ))}
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
                ? 'Зажмите, встряхните и отпустите'
                : 'Ожидаем ход игрока',
        )}
      </span>
      <span className="mono-dice-result">
        {dice[0] > 0 ? `${dice[0]} + ${dice[1]} = ${dice[0] + dice[1]}` : '—'}
      </span>
    </button>
  );
}

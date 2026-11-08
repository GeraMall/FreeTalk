import type { DiceMotion } from '@freetalk/protocol';
export type DiceBody = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  z: number;
  vz: number;
  rx: number;
  ry: number;
  sx: number;
  sy: number;
};
export type DiceBounds = { width: number; height: number; size: number };
export const diceRotations = [
  [0, 0],
  [0, -90],
  [90, 0],
  [-90, 0],
  [0, 90],
  [0, 180],
] as const;
export function diceLimits({ width, height, size }: DiceBounds) {
  const pad = size * 0.85;
  return {
    left: pad,
    right: Math.max(pad, width - pad),
    top: pad + 10,
    bottom: Math.max(pad + 10, height - pad - 34),
  };
}
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export function restDice(bounds: DiceBounds): DiceBody[] {
  const l = diceLimits(bounds);
  return [0, 1].map((i) => ({
    x: clamp(bounds.width / 2 + (i ? 1 : -1) * bounds.size * 1.05, l.left, l.right),
    y: clamp(bounds.height / 2 + (i ? 5 : -5), l.top, l.bottom),
    vx: 0,
    vy: 0,
    z: 0,
    vz: 0,
    rx: -18,
    ry: 22,
    sx: 0,
    sy: 0,
  }));
}
export function throwDice(bodies: DiceBody[], seed: number, velocity: { x: number; y: number }) {
  const magnitude = Math.hypot(velocity.x, velocity.y),
    angle = magnitude > 30 ? Math.atan2(velocity.y, velocity.x) : (seed * 2.399963) % (Math.PI * 2),
    speed = clamp(145 + magnitude * 0.08, 145, 235),
    dx = Math.cos(angle),
    dy = Math.sin(angle);
  return bodies.map((b, i) => ({
    ...b,
    vx: dx * speed - dy * (i ? 1 : -1) * (18 + (seed % 9)),
    vy: dy * speed + dx * (i ? 1 : -1) * (18 + (seed % 9)),
    z: 2 + i * 2,
    vz: 100 + i * 12,
    rx: b.rx,
    ry: b.ry,
    sx: (i ? -1 : 1) * (35 + (seed % 7) * 5),
    sy: (i ? -1 : 1) * (30 + (seed % 3) * 8),
  }));
}
/** Semi-implicit 2D motion with height, wall restitution and equal-mass die collisions. */
export function stepDice(bodies: DiceBody[], bounds: DiceBounds, dt: number) {
  const l = diceLimits(bounds);
  let impact = false;
  const first = bodies[0],
    second = bodies[1];
  if (first && second) {
    const dx = second.x - first.x,
      dy = second.y - first.y,
      d = Math.hypot(dx, dy),
      reach = bounds.size * 3.2;
    if (d > reach) {
      const nx = dx / d,
        ny = dy / d,
        away = (second.vx - first.vx) * nx + (second.vy - first.vy) * ny;
      const impulse = Math.max(0, (d - reach) * 12 + away * 2.5) * dt;
      first.vx += nx * impulse;
      first.vy += ny * impulse;
      second.vx -= nx * impulse;
      second.vy -= ny * impulse;
    }
  }
  for (const b of bodies) {
    b.vz -= 950 * dt;
    b.z += b.vz * dt;
    if (b.z < 0) {
      if (b.vz < -55) {
        b.vz = -b.vz * 0.44;
        impact = true;
      } else b.vz = 0;
      b.z = 0;
    }
    const friction = Math.exp(-(b.z > 2 ? 0.9 : 1.65) * dt);
    b.vx *= friction;
    b.vy *= friction;
    const ox = b.x,
      oy = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < l.left) {
      b.x = l.left;
      b.vx = Math.abs(b.vx) * 0.64;
      impact = true;
    }
    if (b.x > l.right) {
      b.x = l.right;
      b.vx = -Math.abs(b.vx) * 0.64;
      impact = true;
    }
    if (b.y < l.top) {
      b.y = l.top;
      b.vy = Math.abs(b.vy) * 0.64;
      impact = true;
    }
    if (b.y > l.bottom) {
      b.y = l.bottom;
      b.vy = -Math.abs(b.vy) * 0.64;
      impact = true;
    }
    b.rx -= (((b.y - oy) / (bounds.size * 0.5)) * 180) / Math.PI;
    b.ry += (((b.x - ox) / (bounds.size * 0.5)) * 180) / Math.PI;
    if (b.z > 2) {
      b.rx += b.sx * dt;
      b.ry += b.sy * dt;
    }
    b.sx *= Math.exp(-2.8 * dt);
    b.sy *= Math.exp(-2.8 * dt);
  }
  const [a, b] = bodies;
  if (a && b && Math.abs(a.z - b.z) < bounds.size) {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      d = Math.hypot(dx, dy),
      min = bounds.size * 1.45;
    if (d < min) {
      const nx = d > 0.001 ? dx / d : 1,
        ny = d > 0.001 ? dy / d : 0,
        overlap = (min - d) / 2;
      a.x = clamp(a.x - nx * overlap, l.left, l.right);
      a.y = clamp(a.y - ny * overlap, l.top, l.bottom);
      b.x = clamp(b.x + nx * overlap, l.left, l.right);
      b.y = clamp(b.y + ny * overlap, l.top, l.bottom);
      const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (relative < 0) {
        const impulse = -relative * 0.83;
        a.vx -= impulse * nx;
        a.vy -= impulse * ny;
        b.vx += impulse * nx;
        b.vy += impulse * ny;
        a.sy *= -0.7;
        b.sx *= -0.7;
        impact = true;
      }
    }
  }
  return impact;
}
export function settleDice(bodies: DiceBody[], values: [number, number], progress: number) {
  const p = 1 - (1 - clamp(progress, 0, 1)) ** 3;
  return bodies.map((b, i) => {
    const r = diceRotations[Math.max(0, values[i]! - 1)] ?? diceRotations[0];
    const rx = r[0] + 360 * Math.round((b.rx - r[0]) / 360),
      ry = r[1] + 360 * Math.round((b.ry - r[1]) / 360);
    return { ...b, z: b.z * (1 - p), rx: b.rx + (rx - b.rx) * p, ry: b.ry + (ry - b.ry) * p };
  });
}

export const DICE_ROLL_MS = 2200;
export const DICE_SHAKE_MS = 300;
const canonical: DiceBounds = { width: 800, height: 500, size: 44 };
export function diceRollFrames(
  values: [number, number],
  sequence: number,
  motion?: DiceMotion,
  durationMs = DICE_ROLL_MS,
) {
  let bodies = restDice(canonical);
  if (motion)
    bodies = bodies.map((b, i) => ({
      ...b,
      x: motion.poses[i]!.x * canonical.width,
      y: motion.poses[i]!.y * canonical.height,
      rx: motion.poses[i]!.rx,
      ry: motion.poses[i]!.ry,
    }));
  const frames: DiceBody[][] = [bodies.map((b) => ({ ...b }))];
  const ticks = Math.round(durationMs * 0.12),
    shakeTicks = !motion || motion.automatic ? Math.min(36, Math.floor(ticks / 4)) : 0,
    settleAt = Math.max(shakeTicks + 1, ticks - 72);
  for (let i = 1; i <= ticks; i++) {
    if (i <= shakeTicks) {
      const p = i / shakeTicks,
        envelope = Math.sin(Math.PI * p) ** 2;
      frames.push(
        bodies.map((b, j) => ({
          ...b,
          x: b.x + Math.sin(p * Math.PI * 4) * 7 * envelope,
          y: b.y + Math.cos(p * Math.PI * 4) * 5 * envelope,
          z: 3 * envelope,
          rx: b.rx + Math.sin(p * Math.PI * 4 + (j ? 1 : 0)) * 18 * envelope,
          ry: b.ry + Math.cos(p * Math.PI * 4 + (j ? 1 : 0)) * 16 * envelope,
        })),
      );
      continue;
    }
    if (i === shakeTicks + 1)
      bodies = throwDice(bodies, sequence * 37 + values[0] * 7 + values[1], {
        x: (motion?.vx ?? 0) * canonical.width,
        y: (motion?.vy ?? 0) * canonical.height,
      });
    stepDice(bodies, canonical, 1 / 120);
    frames.push(bodies.map((b) => ({ ...b })));
  }
  const end = frames.at(-1)!;
  for (let frame = settleAt; frame < frames.length; frame++) {
    const p = (frame - settleAt) / (ticks - settleAt),
      ease = p * p * p * (10 - 15 * p + 6 * p * p);
    frames[frame] = frames[frame]!.map((b, i) => {
      const r = diceRotations[values[i]! - 1] ?? diceRotations[0],
        targetX = r[0] + 360 * Math.round((end[i]!.rx - r[0]) / 360),
        targetY = r[1] + 360 * Math.round((end[i]!.ry - r[1]) / 360);
      return {
        ...b,
        z: b.z * (1 - ease),
        rx: b.rx + (targetX - b.rx) * ease,
        ry: b.ry + (targetY - b.ry) * ease,
      };
    });
  }
  return frames;
}
export function sampleDiceRoll(frames: DiceBody[][], elapsed: number, bounds: DiceBounds) {
  const tick = clamp(elapsed * 0.12, 0, frames.length - 1),
    index = Math.min(frames.length - 2, Math.floor(tick)),
    p = tick - index,
    l = diceLimits(bounds);
  const result = frames[index]!.map((a, i) => {
    const b = frames[index + 1]![i]!,
      mix = (a: number, b: number) => a + (b - a) * p;
    return {
      ...a,
      x: clamp((mix(a.x, b.x) / canonical.width) * bounds.width, l.left, l.right),
      y: clamp((mix(a.y, b.y) / canonical.height) * bounds.height, l.top, l.bottom),
      z: mix(a.z, b.z) * Math.min(1, bounds.size / canonical.size),
      rx: mix(a.rx, b.rx),
      ry: mix(a.ry, b.ry),
    };
  });
  const [a, b] = result;
  if (a && b) {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      d = Math.hypot(dx, dy),
      min = bounds.size * 1.4;
    if (d < min) {
      const nx = d > 0.01 ? dx / d : 1,
        ny = d > 0.01 ? dy / d : 0,
        n = (min - d) / 2;
      a.x = clamp(a.x - nx * n, l.left, l.right);
      a.y = clamp(a.y - ny * n, l.top, l.bottom);
      b.x = clamp(b.x + nx * n, l.left, l.right);
      b.y = clamp(b.y + ny * n, l.top, l.bottom);
    }
  }
  return result;
}

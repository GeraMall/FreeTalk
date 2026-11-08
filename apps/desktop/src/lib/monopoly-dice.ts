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
  return bodies.map((b, i) => ({
    ...b,
    vx: clamp(velocity.x * 0.5 + (i ? -1 : 1) * (240 + (seed % 5) * 18), -850, 850),
    vy: clamp(velocity.y * 0.5 + (i ? 120 : -100), -700, 700),
    z: 8 + i * 4,
    vz: 290 + i * 50,
    rx: b.rx,
    ry: b.ry,
    sx: 620 + (seed % 7) * 60 + i * 170,
    sy: (i ? -1 : 1) * (750 + (seed % 3) * 100),
  }));
}
/** Semi-implicit 2D motion with height, wall restitution and equal-mass die collisions. */
export function stepDice(bodies: DiceBody[], bounds: DiceBounds, dt: number) {
  const l = diceLimits(bounds);
  let impact = false;
  for (const b of bodies) {
    b.vz -= 1650 * dt;
    b.z += b.vz * dt;
    if (b.z < 0) {
      if (b.vz < -55) {
        b.vz = -b.vz * 0.44;
        impact = true;
      } else b.vz = 0;
      b.z = 0;
    }
    const friction = Math.exp(-(b.z > 2 ? 1.6 : 6.5) * dt);
    b.vx *= friction;
    b.vy *= friction;
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
    b.rx += b.sx * dt;
    b.ry += b.sy * dt;
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
    const rx = r[0] - 18 + 360 * Math.round((b.rx - (r[0] - 18)) / 360),
      ry = r[1] + 22 + 360 * Math.round((b.ry - (r[1] + 22)) / 360);
    return { ...b, z: b.z * (1 - p), rx: b.rx + (rx - b.rx) * p, ry: b.ry + (ry - b.ry) * p };
  });
}

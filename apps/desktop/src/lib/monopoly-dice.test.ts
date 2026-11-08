import { describe, expect, it } from 'vitest';
import {
  diceLimits,
  diceRotations,
  restDice,
  settleDice,
  stepDice,
  throwDice,
} from './monopoly-dice';
import { propertyBoard, propertyLog } from './monopoly-layout';
describe('local Monopoly dice motion', () => {
  it('bounces dice off each other and retains the authoritative faces after settling', () => {
    const bounds = { width: 700, height: 400, size: 42 },
      bodies = restDice(bounds);
    bodies[0]!.x = 320;
    bodies[1]!.x = 376;
    bodies[0]!.y = bodies[1]!.y = 200;
    bodies[0]!.vx = 300;
    bodies[1]!.vx = -300;
    expect(stepDice(bodies, bounds, 1 / 120)).toBe(true);
    expect(bodies[0]!.vx).toBeLessThan(0);
    expect(bodies[1]!.vx).toBeGreaterThan(0);
    const settled = settleDice(bodies, [4, 6], 1);
    expect(settled.map((b) => b.z)).toEqual([0, 0]);
    expect((settled[0]!.rx + 18) % 360).toBe(diceRotations[3]![0]);
    expect((settled[1]!.ry - 22) % 360).toBe(diceRotations[5]![1]);
  });
  it.each([
    [700, 400, 42],
    [230, 250, 30],
    [180, 145, 26],
  ])('keeps extreme throws within %i×%i felt bounds', (width, height, size) => {
    const bounds = { width, height, size },
      l = diceLimits(bounds),
      bodies = throwDice(restDice(bounds), 4, { x: 9000, y: -9000 });
    let impacts = 0;
    for (let i = 0; i < 76; i++) {
      if (stepDice(bodies, bounds, 1 / 120)) impacts++;
      for (const b of bodies) {
        expect(b.x).toBeGreaterThanOrEqual(l.left);
        expect(b.x).toBeLessThanOrEqual(l.right);
        expect(b.y).toBeGreaterThanOrEqual(l.top);
        expect(b.y).toBeLessThanOrEqual(l.bottom);
        expect(b.z).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(b.rx)).toBe(true);
      }
    }
    expect(impacts).toBeGreaterThan(0);
  });
  it('renames the same property indices without changing price/group or old server logs', () => {
    expect(propertyBoard[39]).toEqual(['Арбат', 400, 7]);
    expect(propertyBoard[37]?.[0]).toBe('Тверская улица');
    expect(propertyLog('Игрок 1: 3 + 2 → Звёздная')).toBe('Игрок 1: 3 + 2 → Первая Парковая улица');
  });
});

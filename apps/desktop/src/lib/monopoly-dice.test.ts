import { describe, expect, it } from 'vitest';
import {
  diceRollFrames,
  DICE_ROLL_MS,
  sampleDiceRoll,
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
    expect((((settled[0]!.rx + 18) % 360) + 360) % 360).toBe((diceRotations[3]![0] + 360) % 360);
    expect((((settled[1]!.ry - 22) % 360) + 360) % 360).toBe(diceRotations[5]![1]);
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

it('replays the same continuous roll for every viewer and settles on the server result', () => {
  const frames = diceRollFrames([2, 6], 17),
    copy = diceRollFrames([2, 6], 17),
    bounds = { width: 800, height: 500, size: 44 };
  expect(copy).toEqual(frames);
  let previous = sampleDiceRoll(frames, 0, bounds);
  for (let time = 1; time <= DICE_ROLL_MS; time++) {
    const next = sampleDiceRoll(frames, time, bounds);
    for (let i = 0; i < 2; i++) {
      expect(Math.hypot(next[i]!.x - previous[i]!.x, next[i]!.y - previous[i]!.y)).toBeLessThan(4);
      expect(
        Math.abs(next[i]!.rx - previous[i]!.rx) + Math.abs(next[i]!.ry - previous[i]!.ry),
      ).toBeLessThan(15);
    }
    previous = next;
  }
  expect((((previous[0]!.ry - 22) % 360) + 360) % 360).toBeCloseTo(270);
  expect((((previous[1]!.ry - 22) % 360) + 360) % 360).toBeCloseTo(180);
  expect(previous.every((p) => p.z === 0)).toBe(true);
  const middle = sampleDiceRoll(frames, 450, bounds);
  expect(
    Math.abs(middle[0]!.rx - frames[0]![0]!.rx) + Math.abs(middle[0]!.ry - frames[0]![0]!.ry),
  ).toBeGreaterThan(180);
  expect(Math.hypot(middle[0]!.x - middle[1]!.x, middle[0]!.y - middle[1]!.y)).toBeGreaterThan(160);
});

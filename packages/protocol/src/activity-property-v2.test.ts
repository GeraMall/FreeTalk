import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTable, reduceTable } from './activity-table-session.js';
import { tableSchema, type TableOf } from './activity-table.js';
import {
  propertyBuildingStock,
  propertyLiquidation,
  propertyRentSchedule,
} from './activity-property.js';
const ids = Array.from(
  { length: 6 },
  (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
);
const context = (seat = 0, now = 10000) => ({ actorId: ids[seat]!, members: ids, now });
function started(count = 2) {
  let s = createTable('monopoly', context(), undefined, undefined, 3, undefined, 2);
  for (let i = 1; i < count; i++) s = reduceTable(s, { kind: 'table-seat', seat: i }, context(i));
  return reduceTable(s, { kind: 'table-start' }, context());
}
const view = (s: ReturnType<typeof started>) => s.view as TableOf<'monopoly'>;
function dice(a: number, b: number) {
  const values = [a - 1, b - 1];
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
    if (array instanceof Uint32Array) array[0] = values.shift() ?? 0;
    return array;
  });
}
afterEach(() => vi.restoreAllMocks());
describe('new monopoly rules, stock and insolvency', () => {
  it('negotiates the longer throw without changing old client timing or dice outcomes', () => {
    const s = started();
    dice(2, 3);
    const legacy = reduceTable(s, { kind: 'property', action: 'roll' }, context());
    dice(2, 3);
    const modern = reduceTable(
      s,
      { kind: 'property', action: 'roll' },
      { ...context(), propertyRoll: 2 },
    );
    expect(view(legacy).lastMove?.rollMs).toBe(900);
    expect(view(modern).lastMove?.rollMs).toBe(2200);
    expect(view(modern).lastMove!.until - view(legacy).lastMove!.until).toBe(1300);
    expect(view(modern).dice).toEqual(view(legacy).dice);
    expect(view(modern).positions).toEqual(view(legacy).positions);
    expect(view(modern).money).toEqual(view(legacy).money);
  });
  it('keeps rules on reset while legacy tables retain their original behavior', () => {
    const s = started();
    expect(view(s).propertyRules).toBe(2);
    expect(view(reduceTable(s, { kind: 'table-reset' }, context())).propertyRules).toBe(2);
    expect(createTable('monopoly', context()).view).not.toHaveProperty('propertyRules', 2);
    expect(tableSchema.safeParse(s.view).success).toBe(true);
  });
  it('automatically declares an unpayable tax bankrupt and clears returned mortgages', () => {
    const s = started(),
      v = view(s);
    v.positions[0] = 1;
    v.money[0] = 10;
    v.owners[3] = 0;
    v.mortgaged = [3];
    dice(1, 2);
    const n = reduceTable(s, { kind: 'property', action: 'roll' }, context());
    expect(n.view).toMatchObject({
      phase: 'finished',
      winner: ids[1],
      bankrupt: [0],
      money: [0, 1500],
      mortgaged: [],
    });
    expect(view(n).owners[3]).toBe(-1);
    expect(view(n).lastMove?.path).toEqual([2, 3, 4]);
  });
  it('does not bankrupt a debtor whose mortgage proceeds can exactly cover the bill', () => {
    const s = started(),
      v = view(s);
    v.positions[0] = 1;
    v.money[0] = 170;
    v.owners[3] = 0;
    dice(1, 2);
    const n = reduceTable(s, { kind: 'property', action: 'roll' }, context());
    expect(n.view).toMatchObject({
      phase: 'playing',
      step: 'debt',
      money: [-30, 1500],
      bankrupt: [],
    });
    expect(propertyLiquidation(view(n), 0)).toBe(30);
    const paid = reduceTable(
      n,
      { kind: 'property', action: 'mortgage', index: 3 },
      context(0, 20000),
    );
    expect(paid.view).toMatchObject({
      step: 'end',
      money: [0, 1500],
      mortgaged: [3],
      bankrupt: [],
    });
  });
  it('credits only realizable cash to a creditor and transfers the remaining properties', () => {
    const s = started(),
      v = view(s);
    v.positions[0] = 37;
    v.money[0] = 100;
    v.owners[1] = 0;
    v.owners[3] = 0;
    v.houses[1] = 4;
    v.houses[3] = 4;
    v.owners[39] = 1;
    v.houses[39] = 5;
    dice(1, 1);
    const n = reduceTable(s, { kind: 'property', action: 'roll' }, context());
    expect(n.view).toMatchObject({
      phase: 'finished',
      money: [0, 1800],
      winner: ids[1],
      bankrupt: [0],
    });
    expect(view(n).owners[1]).toBe(1);
    expect(view(n).owners[3]).toBe(1);
    expect(view(n).houses[1]).toBe(0);
  });
  it('advances past an eliminated player in a three-person game', () => {
    const s = started(3),
      v = view(s);
    v.positions[0] = 1;
    v.money[0] = 0;
    dice(1, 2);
    const n = reduceTable(s, { kind: 'property', action: 'roll' }, context());
    expect(n.view).toMatchObject({ phase: 'playing', turn: 1, step: 'roll', bankrupt: [0] });
  });
  it('enforces the 32-house pool and returns four houses when upgrading to one hotel', () => {
    const s = started(),
      v = view(s);
    v.owners.fill(0);
    for (const i of [1, 3, 6, 8, 9, 11, 13, 14]) v.houses[i] = 4;
    expect(propertyBuildingStock(v)).toEqual({ houses: 0, hotels: 12 });
    expect(reduceTable(s, { kind: 'property', action: 'build', index: 16 }, context())).toBe(s);
    const n = reduceTable(s, { kind: 'property', action: 'build', index: 1 }, context());
    expect(view(n).houses[1]).toBe(5);
    expect(propertyBuildingStock(view(n))).toEqual({ houses: 4, hotels: 11 });
    expect(reduceTable(n, { kind: 'property', action: 'build', index: 1 }, context())).toBe(n);
  });
  it('enforces twelve hotels and supports selling a whole group when replacement houses are unavailable', () => {
    const s = started(),
      v = view(s);
    v.owners.fill(0);
    for (const i of [1, 3, 6, 8, 9, 11, 13, 14, 16, 18, 19, 21]) v.houses[i] = 5;
    v.houses[23] = 4;
    v.houses[24] = 4;
    expect(propertyBuildingStock(v).hotels).toBe(0);
    expect(reduceTable(s, { kind: 'property', action: 'build', index: 23 }, context())).toBe(s);
    for (const i of [26, 27, 29, 31, 32, 34]) v.houses[i] = 4;
    expect(propertyBuildingStock(v).houses).toBe(0);
    expect(reduceTable(s, { kind: 'property', action: 'sell-house', index: 1 }, context())).toBe(s);
    const cash = v.money[0]!;
    const n = reduceTable(s, { kind: 'property', action: 'liquidate-group', index: 1 }, context());
    expect(view(n).houses.slice(1, 4)).toEqual([0, 0, 0]);
    expect(view(n).money[0]).toBe(cash + 250);
  });
  it('waits for the dice and movement before accepting a second action', () => {
    const s = started();
    dice(1, 2);
    const n = reduceTable(s, { kind: 'property', action: 'roll' }, context());
    expect(reduceTable(n, { kind: 'property', action: 'end' }, context(0, 10001))).toBe(n);
    expect(view(n).lastMove).toMatchObject({ from: 0, path: [1, 2, 3], at: 10000 });
    expect(tableSchema.safeParse(n.view).success).toBe(true);
  });
  it('does not move out of jail before a mandatory fee is paid, then resumes the saved dice without rerolling', () => {
    const s = started(),
      v = view(s);
    v.positions[0] = 10;
    v.jail[0] = 1;
    v.money[0] = 0;
    v.owners[6] = 0;
    dice(1, 2);
    const n = reduceTable(s, { kind: 'property', action: 'roll' }, context());
    expect(n.view).toMatchObject({ step: 'debt', positions: [10, 0], pendingJailDice: [1, 2] });
    expect(view(n).lastMove?.path).toEqual([]);
    const paid = reduceTable(
      n,
      { kind: 'property', action: 'mortgage', index: 6 },
      context(0, 20000),
    );
    expect(paid.view).toMatchObject({ positions: [13, 0], money: [0, 1500], step: 'buy' });
    expect(view(paid).pendingJailDice).toBeUndefined();
    expect(view(paid).lastMove).toMatchObject({ roll: false, path: [11, 12, 13], at: 20000 });
  });
  it('shows readable event cards and their authoritative effect', () => {
    const s = started();
    dice(1, 1);
    const n = reduceTable(s, { kind: 'property', action: 'roll' }, context());
    expect(view(n).lastCard).toMatchObject({ kind: 'event', title: 'Научная премия', at: 10000 });
    expect(view(n).lastCard?.text).toContain('150');
    expect(view(n).money[0]).toBe(1650);
  });
  it('prevents trading an empty street from a group with buildings and provides the distinct second brown rent', () => {
    const s = started(),
      v = view(s);
    v.owners[1] = 0;
    v.owners[3] = 0;
    v.houses[1] = 1;
    expect(
      reduceTable(s, { kind: 'property-trade', to: 1, give: [3], want: [], cash: 0 }, context()),
    ).toBe(s);
    expect(propertyRentSchedule(1)).toEqual([2, 10, 30, 90, 160, 250]);
    expect(propertyRentSchedule(3)).toEqual([4, 20, 60, 180, 320, 450]);
  });
});

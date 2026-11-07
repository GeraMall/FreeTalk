import { describe, expect, it } from 'vitest';
import { createTable, reduceTable } from './activity-table-session.js';
import { tableSchema, type TableAction, type TableOf } from './activity-table.js';
import type { TableSession } from './activity-table-internal.js';
import { canRaisePoker, dealPoker } from './activity-poker.js';

const members = Array.from(
  { length: 4 },
  (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
);
const act = (s: TableSession, seat: number, action: TableAction) =>
  reduceTable(s, action, { actorId: members[seat]!, members, now: 1000 });
function fourPlayers() {
  let s = createTable('poker', { actorId: members[0]!, members, now: 0 });
  for (let i = 1; i < 4; i++) s = act(s, i, { kind: 'table-seat', seat: i });
  s = act(s, 0, { kind: 'table-start' });
  if (s.view.kind !== 'poker') throw Error('Expected poker');
  return s as TableSession & { view: TableOf<'poker'> };
}
function street() {
  const s = fourPlayers();
  Object.assign(s.view, {
    stage: 'flop',
    turn: 0,
    bet: 0,
    minRaise: 20,
    bets: [0, 0, 0, 0],
    stacks: [500, 10, 500, 500],
    folded: [],
    allIn: [],
    acted: [],
    actedBets: [null, null, null, null],
  });
  return s;
}
const bet = (s: TableSession, seat: number, action: 'check' | 'call' | 'raise', amount?: number) =>
  act(s, seat, { kind: 'poker-bet', action, amount });
const poker = (s: TableSession): TableOf<'poker'> => {
  if (s.view.kind !== 'poker') throw Error('Expected poker');
  return s.view;
};

describe('four-player poker betting', () => {
  it('lets an earlier checker raise a short opening all-in after both other players call', () => {
    let s: TableSession = street();
    s = bet(s, 0, 'check');
    s = bet(s, 1, 'raise', 10);
    s = bet(s, 2, 'call');
    s = bet(s, 3, 'call');
    expect(poker(s).turn).toBe(0);
    expect(canRaisePoker(poker(s), 0)).toBe(true);
    s = bet(s, 0, 'raise', 30);
    expect(poker(s)).toMatchObject({ bet: 30, turn: 2, minRaise: 20 });
  });
  it('reopens a previous caller only after cumulative short all-ins reach a full raise', () => {
    let s: TableSession = street();
    Object.assign(s.view, {
      bet: 100,
      minRaise: 100,
      bets: [100, 0, 0, 0],
      stacks: [500, 150, 200, 500],
    });
    s = bet(s, 0, 'check');
    s = bet(s, 1, 'raise', 150);
    expect(canRaisePoker(poker(s), 0)).toBe(false);
    s = bet(s, 2, 'raise', 200);
    s = bet(s, 3, 'call');
    expect(poker(s).turn).toBe(0);
    expect(canRaisePoker(poker(s), 0)).toBe(true);
    s = bet(s, 0, 'raise', 300);
    expect(poker(s).bet).toBe(300);
  });
  it('does not reopen raising after just one incomplete all-in but still permits a call', () => {
    let s: TableSession = street();
    Object.assign(s.view, {
      bet: 100,
      minRaise: 100,
      bets: [100, 0, 0, 0],
      stacks: [500, 150, 500, 500],
    });
    s = bet(s, 0, 'check');
    s = bet(s, 1, 'raise', 150);
    s = bet(s, 2, 'call');
    s = bet(s, 3, 'call');
    expect(canRaisePoker(poker(s), 0)).toBe(false);
    expect(bet(s, 0, 'raise', 250)).toBe(s);
    const called = bet(s, 0, 'call');
    expect(called).not.toBe(s);
    expect(poker(called).stage).toBe('turn');
  });
  it('keeps the wire snapshot valid when both blinds are all-in on the next deal', () => {
    const s = fourPlayers();
    s.view.stacks = [10, 10, 0, 0];
    const next = dealPoker(s, 1000);
    expect(poker(next).stage).toBe('showdown');
    expect(tableSchema.safeParse(next.view).success).toBe(true);
    expect(poker(next).stacks.reduce((a, b) => a + b, 0)).toBe(20);
  });
});

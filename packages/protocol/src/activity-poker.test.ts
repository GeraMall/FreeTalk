import { describe, expect, it } from 'vitest';
import { createTable, reduceTable, tableView } from './activity-table-session.js';
import { tableSchema, type TableAction, type TableOf } from './activity-table.js';
import type { TableSession } from './activity-table-internal.js';
import { canRaisePoker, dealPoker, tickPoker } from './activity-poker.js';

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
  it('keeps a folded player own cards visible after settlement without showing them to spectators', () => {
    let s: TableSession = fourPlayers();
    const folded = poker(s).turn,
      owner = poker(s).seats[folded]!;
    while (poker(s).stage !== 'showdown')
      s = act(s, poker(s).turn, { kind: 'poker-bet', action: 'fold' });
    const own = tableView(s, owner),
      watcher = tableView(s, 'spectator');
    if (own.kind !== 'poker' || watcher.kind !== 'poker') throw Error();
    expect(own.hands).toMatchObject([{ ownerId: owner, cards: expect.any(Array) }]);
    expect(own.hands[0]!.cards).toHaveLength(2);
    expect(watcher.hands).toEqual([]);
  });
  it('starts advanced tables with 1000 chips, gives each turn 30 seconds and folds on the server deadline', () => {
    let s = createTable('poker', { actorId: members[0]!, members, now: 0 }, 2);
    for (let i = 1; i < 4; i++) s = act(s, i, { kind: 'table-seat', seat: i });
    s = act(s, 0, { kind: 'table-start' });
    const v = poker(s);
    expect(v.stacks.reduce((a, b) => a + b, 0) + v.pot).toBe(4000);
    expect(v.turnDeadline! - v.turnAt!).toBe(30000);
    const actor = v.turn;
    expect(tickPoker(s, v.turnDeadline! - 1)).toBe(s);
    const next = tickPoker(s, v.turnDeadline!);
    expect(poker(next).folded).toContain(actor);
    expect(poker(next).lastAction?.kind).toBe('timeout');
    expect(poker(next).turnDeadline).toBe(v.turnDeadline! + 30000);
    expect(tableSchema.safeParse(next.view).success).toBe(true);
  });
  it('settles current-table net winnings once, permits only three exact rebuys and preserves them across hands', () => {
    let s = fourPlayers();
    s.view.pokerRules = 2;
    s = dealPoker(s, 1000) as typeof s;
    let clock = 4000;
    while (poker(s).stage !== 'showdown') {
      const v = poker(s);
      s = reduceTable(
        s,
        { kind: 'poker-bet', action: 'fold' },
        { actorId: v.seats[v.turn]!, members, now: clock++ },
      ) as typeof s;
    }
    const v = poker(s);
    expect(v.stats!.every((x) => x.hands === 1)).toBe(true);
    expect(v.stats!.reduce((n, x) => n + x.won - x.lost, 0)).toBe(0);
    const stats = structuredClone(v.stats);
    expect(tickPoker(s, 100000)).toBe(s);
    expect(s.view.stats).toEqual(stats);
    const seat = 0;
    for (let n = 0; n < 3; n++) {
      s.view.stacks[seat] = 0;
      s = act(s, seat, { kind: 'poker-rebuy' }) as typeof s;
      expect(s.view.stacks[seat]).toBe(1000);
      expect(s.view.rebuys?.[seat]).toBe(n + 1);
    }
    s.view.stacks[seat] = 0;
    expect(act(s, seat, { kind: 'poker-rebuy' })).toBe(s);
    expect(act(s, 3, { kind: 'poker-rebuy' })).toBe(s);
    expect(s.view.stats).toEqual(stats);
    s = dealPoker(s, 100000) as typeof s;
    expect(s.view.rebuys?.[seat]).toBe(3);
    expect(
      reduceTable(s, { kind: 'poker-rebuy' }, { actorId: members[seat]!, members, now: 103000 }),
    ).toBe(s);
  });
  it('does not add timeouts or rebuys to an existing legacy poker table', () => {
    const s = fourPlayers();
    expect(s.view.pokerRules).toBeUndefined();
    expect(tickPoker(s, Number.MAX_SAFE_INTEGER)).toBe(s);
    expect(act(s, 0, { kind: 'poker-rebuy' })).toBe(s);
  });
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

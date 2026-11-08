import { describe, it, expect } from 'vitest';
import {
  createTable,
  reduceTable,
  tickTable,
  tableView,
  type TableSession,
} from './activity-table-session.js';
import { tableSchema, type TableAction } from './activity-table.js';
import { roomActivityView, emptyRoomActivity, applyRoomActivity } from './room-activity-session.js';
const ids = Array.from(
  { length: 4 },
  (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
);
const ctx = (actorId = ids[0]!, now = 1000) => ({
  actorId,
  now,
  members: ids,
  adultIds: ids,
  pokerFlow: 2 as const,
});
function start(
  mode: 'classic' | 'tournament' | 'tournament-fixed' = 'classic',
  flow: 2 | null = 2,
) {
  let s = createTable('poker', ctx(), 2, 8, 3, flow ?? undefined);
  for (let i = 1; i < 3; i++) s = reduceTable(s, { kind: 'table-seat', seat: i }, ctx(ids[i]));
  s = reduceTable(s, { kind: 'poker-config', mode, ante: false, ageConfirmed: true }, ctx());
  return reduceTable(s, { kind: 'table-start' }, ctx());
}
function finish(input: TableSession, now = 4000) {
  if (input.view.kind !== 'poker') throw Error();
  let s = {
    ...input,
    view: { ...input.view, turnAt: now - 1, turnDeadline: now + 30000 },
  } as TableSession;
  for (let n = 0; n < 8 && s.view.kind === 'poker' && s.view.stage !== 'showdown'; n++)
    s = reduceTable(s, { kind: 'poker-bet', action: 'fold' }, ctx(s.view.seats[s.view.turn]!, now));
  if (s.view.kind !== 'poker' || s.view.stage !== 'showdown') throw Error('Did not finish');
  return s;
}
const poker = (s: TableSession) => {
  if (s.view.kind !== 'poker') throw Error();
  return s.view;
};
describe('automatic poker hands and level breaks', () => {
  it('never counts bots or spectators in the break skip quorum', () => {
    let s = createTable('poker', ctx(), 2, 8, 3, 2);
    s = reduceTable(s, { kind: 'table-seat', seat: 1 }, ctx(ids[1]));
    s = reduceTable(s, { kind: 'table-bot', seat: 2 }, ctx());
    const bot = poker(s).bots![0]!;
    s = reduceTable(
      s,
      { kind: 'poker-config', mode: 'tournament', ante: false, ageConfirmed: true },
      ctx(),
    );
    s = reduceTable(s, { kind: 'table-start' }, ctx());
    s = finish(s, 902000);
    s = tickTable(s, poker(s).nextHandAt!);
    expect(poker(s).pokerBreak?.electorate).toEqual([ids[0], ids[1]]);
    const action: TableAction = { kind: 'poker-break-vote', breakId: poker(s).pokerBreak!.id };
    expect(reduceTable(s, action, { ...ctx(bot.id, 910000), members: [...ids, bot.id] })).toBe(s);
    const one = reduceTable(s, action, ctx(ids[0], 910000));
    expect(poker(one).pokerBreak).toBeDefined();
    expect(poker(reduceTable(one, action, ctx(ids[1], 910001))).pokerBreak).toBeUndefined();
  });
  it('shows the result before dealing once, preserves chips and private hands, and retains flow on reset', () => {
    const s = finish(start()),
      v = poker(s);
    expect(v.nextHandAt).toBe(10000);
    expect(tickTable(s, 9999)).toBe(s);
    const next = tickTable(s, 10000),
      n = poker(next);
    expect(n.handNumber).toBe(2);
    expect(n.stage).toBe('preflop');
    expect(n.nextHandAt).toBeUndefined();
    expect(poker(tickTable(next, 10001)).handNumber).toBe(2);
    expect(n.stacks.reduce((a, b) => a + b, 0) + n.pot).toBe(3000);
    expect(tableSchema.safeParse(tableView(next, ids[0])).success).toBe(true);
    expect((tableView(next, ids[0]) as typeof n).hands.map((h) => h.ownerId)).toEqual([ids[0]]);
    expect(poker(reduceTable(next, { kind: 'table-reset' }, ctx())).pokerFlow).toBe(2);
  });
  it('cannot be rushed with the old next-hand button and leaves legacy tables manual', () => {
    const s = finish(start());
    expect(reduceTable(s, { kind: 'poker-next' }, ctx(ids[0], 6000))).toBe(s);
    const old = finish(start('classic', null));
    expect(poker(old).nextHandAt).toBeUndefined();
    expect(tickTable(old, 10000)).toBe(old);
    expect(poker(reduceTable(old, { kind: 'poker-next' }, ctx(ids[0], 10000))).handNumber).toBe(2);
  });
  it('keeps a fifteen-second window for a bust player to rebuy without changing the other players chips', () => {
    let s = start();
    if (s.view.kind !== 'poker') throw Error();
    s = {
      ...s,
      secret: {
        ...s.secret,
        hands: [
          ['2s', '2h'],
          ['As', 'Ah'],
          ['Qs', 'Qh'],
        ],
        pokerStartingStacks: [500, 1000, 1500],
      },
      view: {
        ...s.view,
        stage: 'river',
        board: ['3s', '4h', '8d', '9c', 'Ks'],
        stacks: [0, 0, 500],
        pot: 2500,
        contributions: [500, 1000, 1000],
        bets: [0, 0, 0],
        bet: 0,
        allIn: [0, 1],
        turn: 2,
        turnAt: 3500,
        turnDeadline: 34000,
      },
    };
    s = reduceTable(s, { kind: 'poker-bet', action: 'check' }, ctx(ids[2], 4000));
    const v = poker(s);
    expect(v.stacks).toEqual([0, 2500, 500]);
    expect(v.nextHandAt).toBe(19000);
    expect(tickTable(s, 18000)).toBe(s);
    const rebought = reduceTable(s, { kind: 'poker-rebuy' }, ctx(ids[0], 18000));
    expect(poker(rebought).stacks).toEqual([1000, 2500, 500]);
    expect(poker(tickTable(rebought, 19000)).handNumber).toBe(v.handNumber + 1);
  });
  it('finishes a tournament rather than dealing or breaking with one funded player', () => {
    const s = finish(start('tournament'));
    const v = poker(s);
    const ended = {
      ...s,
      view: {
        ...v,
        stacks: [3000, 0, 0],
        phase: 'finished' as const,
        winner: ids[0],
        nextHandAt: 6000,
      },
    };
    expect(tickTable(ended, 999999)).toBe(ended);
  });
  it('does not interrupt a live hand, starts a full five-minute break between hands, then raises exactly one level', () => {
    let s = start('tournament');
    const first = poker(s);
    expect(first.levelEndsAt).toBe(901000);
    s = { ...s, view: { ...first, turnAt: 901100, turnDeadline: 940000 } };
    expect(tickTable(s, 902000)).toBe(s);
    s = finish(s, 902000);
    s = tickTable(s, poker(s).nextHandAt!);
    const pause = poker(s).pokerBreak!;
    expect(pause.endsAt - pause.startedAt).toBe(300000);
    expect(poker(s).handNumber).toBe(1);
    expect(tickTable(s, pause.endsAt - 1)).toBe(s);
    const next = tickTable(s, pause.endsAt),
      v = poker(next);
    expect(v).toMatchObject({
      handNumber: 2,
      blindLevel: 1,
      smallBlindAmount: 20,
      bigBlindAmount: 40,
      levelEndsAt: pause.endsAt + 900000,
    });
    expect(v.pokerBreak).toBeUndefined();
  });
  it('uses a majority of seated people, rejects spectators and duplicate votes, and restarts the playing clock after an early skip', () => {
    let s = finish(start('tournament'), 902000);
    s = tickTable(s, poker(s).nextHandAt!);
    const pause = poker(s).pokerBreak!;
    const action: TableAction = { kind: 'poker-break-vote', breakId: pause.id };
    expect(reduceTable(s, action, ctx(ids[3], 909000))).toBe(s);
    const one = reduceTable(s, action, ctx(ids[0], 909000));
    expect(poker(one).pokerBreak?.yes).toEqual([ids[0]]);
    expect(reduceTable(one, action, ctx(ids[0], 909001))).toBe(one);
    const done = reduceTable(one, action, ctx(ids[1], 909002));
    expect(poker(done)).toMatchObject({ handNumber: 2, blindLevel: 1, levelEndsAt: 1809002 });
    expect(poker(done).pokerBreak).toBeUndefined();
    expect(reduceTable(done, action, ctx(ids[2], 909003))).toBe(done);
  });
  it('accepts simultaneous votes by stable break ID while filtering the new table from older clients', () => {
    let table = finish(start('tournament'), 902000);
    table = tickTable(table, poker(table).nextHandAt!);
    let session = {
      ...emptyRoomActivity(),
      table,
      view: { open: true, revision: 10, region: 'RU' as const },
    };
    const action: TableAction = { kind: 'poker-break-vote', breakId: poker(table).pokerBreak!.id };
    session = applyRoomActivity(session, 10, action, ctx(ids[0], 910000)) as typeof session;
    session = applyRoomActivity(session, 10, action, ctx(ids[1], 910001)) as typeof session;
    expect(poker(session.table).handNumber).toBe(2);
    expect(roomActivityView(session, ids[0], true, true, true, true, false).table).toBeUndefined();
    expect(roomActivityView(session, ids[0], true, true, true, true, true).table).toBeDefined();
  });
});

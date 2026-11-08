import { describe, expect, it } from 'vitest';
import { createTable, reduceTable, tableView, tickTable } from './activity-table-session.js';
import { tableCountsForStatistics, tableSchema, type TableAction } from './activity-table.js';
import {
  applyRoomActivity,
  emptyRoomActivity,
  roomActivityView,
  tickRoomActivity,
} from './room-activity-session.js';
import { pokerBoardDuration } from './poker-timing.js';
import type { TableSession } from './activity-table-internal.js';
const ids = Array.from(
  { length: 4 },
  (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
);
const ctx = (actorId = ids[0]!, now = 10000) => ({
  actorId,
  members: ids,
  adultIds: ids.slice(0, 3),
  voters: ids,
  now,
});
const act = (s: TableSession, a: TableAction, seat = 0, now = 10000) =>
  reduceTable(s, a, ctx(s.view.seats[seat] ?? ids[0]!, now));
function poker(mode: 'classic' | 'tournament' | 'tournament-fixed' = 'classic', ante = false) {
  let s = createTable('poker', ctx(), 2, 8, 3);
  s = reduceTable(s, { kind: 'table-seat', seat: 1 }, ctx(ids[1]));
  s = act(s, { kind: 'poker-config', mode, ante, ageConfirmed: true });
  return act(s, { kind: 'table-start' });
}
describe('new poker rules and age eligibility', () => {
  it('requires the organizer acknowledgement and server adult eligibility, with no underage viewing', () => {
    let s = createTable('poker', ctx(), 2, 8, 3);
    expect(reduceTable(s, { kind: 'table-seat', seat: 1 }, ctx(ids[3]))).toBe(s);
    s = reduceTable(s, { kind: 'table-seat', seat: 1 }, ctx(ids[1]));
    expect(act(s, { kind: 'table-start' })).toBe(s);
    s = act(s, { kind: 'poker-config', mode: 'classic', ante: false, ageConfirmed: true });
    const begun = act(s, { kind: 'table-start' });
    expect(begun.view.phase).toBe('playing');
    const session = { ...emptyRoomActivity(), table: begun };
    expect(roomActivityView(session, ids[3], true, true, true, false)).toMatchObject({
      restrictedGame: 'poker',
      canPlayPoker: false,
      table: undefined,
    });
    expect(roomActivityView(session, ids[0], true, true, true, true).table?.kind).toBe('poker');
    expect(roomActivityView(session, ids[0], true, true, false, true).table).toBeUndefined();
  });
  it('collects antes as dead money and doubles tournament blinds only on the next hand after fifteen minutes', () => {
    const s = poker('tournament', true);
    if (s.view.kind !== 'poker') throw Error();
    expect(s.view.pot).toBe(34);
    expect(s.view.bets.reduce((a, b) => a + b, 0)).toBe(30);
    let end = s;
    while (end.view.kind === 'poker' && end.view.stage !== 'showdown')
      end = act(end, { kind: 'poker-bet', action: 'fold' }, end.view.turn, 14000);
    const next = act(end, { kind: 'poker-next' }, 0, 910000);
    if (next.view.kind !== 'poker') throw Error();
    expect(next.view).toMatchObject({
      smallBlindAmount: 20,
      bigBlindAmount: 40,
      anteAmount: 4,
      blindLevel: 1,
    });
    expect(next.view.pot).toBe(68);
    const fixed = poker('tournament-fixed', true);
    expect(fixed.view.kind === 'poker' && fixed.view.bigBlindAmount).toBe(20);
    const copy = structuredClone(s);
    if (copy.view.kind !== 'poker') throw Error();
    copy.view.stage = 'showdown';
    copy.view.stacks[1] = 0;
    expect(act(copy, { kind: 'poker-rebuy' }, 1, 20000)).toBe(copy);
  });
  it('keeps the board timestamp stable during bets and reserves the reveal time before a full turn', () => {
    let s = poker();
    while (s.view.kind === 'poker' && s.view.stage === 'preflop')
      s = act(
        s,
        { kind: 'poker-bet', action: s.view.bets[s.view.turn]! < s.view.bet ? 'call' : 'check' },
        s.view.turn,
        14000,
      );
    if (s.view.kind !== 'poker') throw Error();
    expect(s.view).toMatchObject({
      stage: 'flop',
      boardFrom: 0,
      boardAt: 14000,
      turnAt: 14000 + pokerBoardDuration(3),
    });
    expect(s.view.turnDeadline! - s.view.turnAt!).toBe(30000);
    expect(act(s, { kind: 'poker-bet', action: 'check' }, s.view.turn, 14500)).toBe(s);
    const after = act(s, { kind: 'poker-bet', action: 'check' }, s.view.turn, s.view.turnAt! + 1);
    expect(after.view.kind === 'poker' && after.view.boardAt).toBe(14000);
  });
});
describe('practice bots', () => {
  it('rejects an external actor using a synthetic bot identity', () => {
    let s = createTable('chess', ctx(), undefined, undefined, 3);
    s = act(s, { kind: 'table-bot', seat: 1 });
    s = act(s, { kind: 'table-start' });
    s = act(s, { kind: 'chess-move', from: 'e2', to: 'e4' });
    const bot = s.view.bots![0]!;
    expect(
      reduceTable(
        s,
        { kind: 'chess-move', from: 'e7', to: 'e5' },
        { ...ctx(bot.id), members: [...ids, bot.id] },
      ),
    ).toBe(s);
  });
  it('permanently excludes mixed human and bot games from statistics, even after removal and reset', () => {
    let s = createTable('poker', ctx(), 2, 8, 3);
    s = act(s, { kind: 'table-bot', seat: 1 });
    expect(s.view.training).toBe(true);
    expect(tableCountsForStatistics(s.view)).toBe(false);
    s = act(s, { kind: 'table-bot', seat: 1, remove: true });
    expect(s.view.bots).toHaveLength(0);
    expect(tableCountsForStatistics(s.view)).toBe(false);
    expect(tableCountsForStatistics(act(s, { kind: 'table-reset' }).view)).toBe(false);
    s = reduceTable(s, { kind: 'table-seat', seat: 1 }, ctx(ids[1]));
    s = act(s, { kind: 'poker-config', mode: 'classic', ante: false, ageConfirmed: true });
    s = act(s, { kind: 'table-start' });
    while (s.view.kind === 'poker' && s.view.stage !== 'showdown')
      s = act(s, { kind: 'poker-bet', action: 'fold' }, s.view.turn, 15000);
    expect(s.view.kind === 'poker' && s.view.stats).toBeUndefined();
  });
  it('makes a legal, throttled chess move without remote AI', () => {
    let s = createTable('chess', ctx(), undefined, undefined, 3);
    s = act(s, { kind: 'table-bot', seat: 1 });
    s = act(s, { kind: 'table-start' });
    s = act(s, { kind: 'chess-move', from: 'e2', to: 'e4' }, 0, 11000);
    expect(tickTable(s, 11000)).toBe(s);
    expect(tickTable(s, 11899)).toBe(s);
    const moved = tickTable(s, 11900);
    expect(moved.view.kind === 'chess' && moved.view.moves.length).toBe(2);
    expect(tableSchema.safeParse(tableView(moved, ids[0])).success).toBe(true);
  });
  it('prepares a private fleet and readies it without revealing either hidden layout', () => {
    let s = createTable('fleet', ctx(), undefined, undefined, 3);
    s = act(s, { kind: 'table-bot', seat: 1 });
    tickTable(s, 11000);
    s = tickTable(s, 11900);
    s = tickTable(s, 13100);
    if (s.view.kind !== 'fleet') throw Error();
    expect(s.secret.fleet?.[1]).toHaveLength(20);
    expect(s.view.ready).toContain(s.view.seats[1]);
    const spectator = tableView(s, ids[2]);
    expect('secret' in spectator).toBe(false);
    expect(
      spectator.kind === 'fleet' &&
        spectator.boards.every((b) => b.cells.every((cell) => cell === -1)),
    ).toBe(true);
  });
  it('makes a poker decision using only its own hand and marks the match as practice', () => {
    let s = createTable('poker', ctx(), 2, 8, 3);
    s = act(s, { kind: 'table-bot', seat: 1 });
    s = act(s, { kind: 'poker-config', mode: 'classic', ante: false, ageConfirmed: true });
    s = act(s, { kind: 'table-start' });
    if (s.view.kind !== 'poker') throw Error();
    s = act(s, { kind: 'poker-bet', action: 'call' }, 0, 14000);
    tickTable(s, 14000);
    s = tickTable(s, 14900);
    expect(s.view.kind === 'poker' && s.view.lastAction?.seat).toBe(1);
    expect(tableCountsForStatistics(s.view)).toBe(false);
    const own = tableView(s, ids[0]);
    expect(own.kind === 'poker' && own.hands.map((h) => h.ownerId)).toEqual([ids[0]]);
  });
  it('rolls for a monopoly bot and does not mutate another human turn', () => {
    let s = createTable('monopoly', ctx(), undefined, undefined, 3);
    s = act(s, { kind: 'table-bot', seat: 1 });
    s = act(s, { kind: 'table-start' });
    expect(tickTable(s, 11000)).toBe(s);
    if (s.view.kind !== 'monopoly') throw Error();
    s = { ...s, view: { ...s.view, turn: 1 } };
    tickTable(s, 12000);
    const next = tickTable(s, 12900);
    expect(next).not.toBe(s);
    expect(next.view.kind === 'monopoly' && next.view.dice.every((n) => n >= 1 && n <= 6)).toBe(
      true,
    );
  });
});
describe('shared game switch votes', () => {
  it('retains the game until a majority, accepts simultaneous votes by ID, and elects the requester as the new host', () => {
    let s = emptyRoomActivity();
    s = applyRoomActivity(s, s.view.revision, { kind: 'open' }, ctx());
    s = applyRoomActivity(
      s,
      s.view.revision,
      { kind: 'table-open', game: 'poker', pokerRules: 2, pokerSeats: 8, edition: 3 },
      ctx(),
    );
    const original = s.table!.view.id;
    s = applyRoomActivity(s, s.view.revision, { kind: 'game-propose', game: 'chess' }, ctx(ids[1]));
    expect(s.table!.view.id).toBe(original);
    const revision = s.view.revision,
      vote = s.view.switchVote!;
    s = applyRoomActivity(
      s,
      revision,
      { kind: 'game-vote', id: vote.id, accept: true },
      ctx(ids[2]),
    );
    expect(s.table!.view.id).toBe(original);
    s = applyRoomActivity(
      s,
      revision,
      { kind: 'game-vote', id: vote.id, accept: true },
      ctx(ids[0]),
    );
    expect(s.table!.view).toMatchObject({ kind: 'chess', hostId: ids[1], edition: 3 });
    expect(s.view.switchVote?.state).toBe('accepted');
  });
  it('expires without replacing the old game and rejects an underage poker proposal', () => {
    let s = emptyRoomActivity();
    s = applyRoomActivity(s, 0, { kind: 'open' }, ctx());
    expect(
      applyRoomActivity(s, s.view.revision, { kind: 'game-propose', game: 'poker' }, ctx(ids[3])),
    ).toBe(s);
    s = applyRoomActivity(s, s.view.revision, { kind: 'game-propose', game: 'monopoly' }, ctx());
    expect(tickRoomActivity(s, 30000).view.switchVote?.state).toBe('expired');
  });
});

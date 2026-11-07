import { describe, expect, it } from 'vitest';
import {
  createTable,
  randomFleet,
  validFleet,
  reduceTable,
  tableView,
  tickTable,
} from './activity-table-session.js';
import { tableSchema, type TableAction, type TableKind } from './activity-table.js';
import type { TableSession } from './activity-table-internal.js';
import { evaluatePoker, comparePoker } from './activity-poker.js';
const a = '11111111-1111-4111-8111-111111111111',
  b = '22222222-2222-4222-8222-222222222222',
  c = '33333333-3333-4333-8333-333333333333';
const members = [a, b, c];
const act = (state: TableSession, action: TableAction, actorId = a, now = 1000) =>
  reduceTable(state, action, { actorId, members, now });
function started(kind: TableKind, players = 2) {
  let s = createTable(kind, { actorId: a, members, now: 0 });
  if (players > 1) s = act(s, { kind: 'table-seat', seat: 1 }, b);
  if (players > 2) s = act(s, { kind: 'table-seat', seat: 2 }, c);
  return act(s, { kind: 'table-start' });
}
describe('shared multiplayer tables', () => {
  it('validates every lobby and binds seats to a single participant', () => {
    for (const kind of ['chess', 'fleet', 'monopoly', 'millionaire', 'poker'] as const) {
      const s = createTable(kind, { actorId: a, members, now: 0 });
      expect(tableSchema.safeParse(s.view).success).toBe(true);
      expect(act(s, { kind: 'table-start' }, b)).toBe(s);
      if (kind !== 'millionaire') expect(act(s, { kind: 'table-start' })).toBe(s);
    }
    let s = createTable('chess', { actorId: a, members, now: 0 });
    s = act(s, { kind: 'table-seat', seat: 1 }, b);
    expect(act(s, { kind: 'table-seat', seat: 1 }, c)).toBe(s);
    expect(act(s, { kind: 'table-seat', seat: 0 }, b)).toBe(s);
  });
  it('enforces chess ownership, legal moves, increments, checkmate and stale time', () => {
    let s = started('chess');
    expect(act(s, { kind: 'chess-move', from: 'e2', to: 'e4' }, b)).toBe(s);
    expect(act(s, { kind: 'chess-move', from: 'e2', to: 'e5' })).toBe(s);
    s = act(s, { kind: 'chess-move', from: 'f2', to: 'f3' }, a, 2000);
    expect(s.view).toMatchObject({ clocks: [604000, 600000] });
    s = act(s, { kind: 'chess-move', from: 'e7', to: 'e5' }, b, 3000);
    s = act(s, { kind: 'chess-move', from: 'g2', to: 'g4' }, a, 4000);
    s = act(s, { kind: 'chess-move', from: 'd8', to: 'h4' }, b, 5000);
    expect(s.view).toMatchObject({ phase: 'finished', winner: b, check: true });
    const expired = tickTable(started('chess'), 602000);
    expect(expired.view).toMatchObject({ phase: 'finished', winner: b });
  });
  it('agrees to a draw only between the actual two players', () => {
    let s = started('chess');
    expect(act(s, { kind: 'chess-draw' }, c)).toBe(s);
    s = act(s, { kind: 'chess-draw' });
    s = act(s, { kind: 'chess-draw' }, b);
    expect(s.view).toMatchObject({ phase: 'finished', winner: 'draw' });
  });
  it('starts two ready fleets, hides opponents from players and reveals both to spectators', () => {
    let s = createTable('fleet', { actorId: a, members, now: 0 });
    s = act(s, { kind: 'table-seat', seat: 1 }, b);
    const one = randomFleet(),
      two = randomFleet();
    expect(validFleet(one)).toBe(true);
    expect(validFleet([...one.slice(1), one[1]!])).toBe(false);
    s = act(s, { kind: 'fleet-place', cells: one });
    s = act(s, { kind: 'fleet-place', cells: two }, b);
    s = act(s, { kind: 'fleet-ready' });
    s = act(s, { kind: 'fleet-ready' }, b);
    expect(s.view.phase).toBe('playing');
    const av = tableView(s, a),
      cv = tableView(s, c);
    if (av.kind !== 'fleet' || cv.kind !== 'fleet') throw Error();
    expect(av.boards[0]!.cells.filter((x) => x === 2)).toHaveLength(20);
    expect(av.boards[1]!.cells.every((x) => x === -1)).toBe(true);
    expect(cv.boards.every((board) => board.cells.filter((x) => x === 2).length === 20)).toBe(true);
    const wrong = s.view.kind === 'fleet' && s.view.turn === 0 ? b : a;
    expect(act(s, { kind: 'fleet-shot', index: 0 }, wrong)).toBe(s);
    if (s.view.kind !== 'fleet') throw Error();
    const actor = s.view.turn === 0 ? a : b,
      target = s.view.turn === 0 ? two : one;
    for (const index of target) s = act(s, { kind: 'fleet-shot', index }, actor);
    expect(s.view).toMatchObject({ phase: 'finished', winner: actor });
  });
  it('keeps quiz answers secret, makes lifelines real and pays milestones', () => {
    let s = started('millionaire', 1);
    expect(JSON.parse(JSON.stringify(s.view))).not.toHaveProperty('correct');
    s = act(s, { kind: 'quiz-help', help: 'half' });
    if (s.view.kind !== 'millionaire') throw Error();
    expect(s.view.eliminated).toHaveLength(2);
    expect(s.view.eliminated).not.toContain(s.secret.quiz![0]!.correct);
    for (let level = 0; level < 5; level++) {
      s = act(s, { kind: 'quiz-answer', answer: s.secret.quiz![level]!.correct });
      s = act(s, { kind: 'quiz-next' });
    }
    const wrong = (s.secret.quiz![5]!.correct + 1) % 4;
    s = act(s, { kind: 'quiz-answer', answer: wrong });
    expect(s.view).toMatchObject({ phase: 'finished', earned: 1000, guaranteed: 1000 });
  });
  it('allows only actual audience participants to vote without exposing the correct answer', () => {
    let s = started('millionaire', 1);
    s = act(s, { kind: 'quiz-help', help: 'audience' });
    s = act(s, { kind: 'quiz-vote', answer: 2 }, b);
    expect(s.view).toMatchObject({ audience: [0, 0, 100, 0] });
    expect(JSON.parse(JSON.stringify(s.view))).not.toHaveProperty('correct');
  });
  it('ranks seven-card poker hands, wheel straights, kickers and full houses correctly', () => {
    const royal = evaluatePoker(['As', 'Ks', 'Qs', 'Js', 'Ts', '2d', '3c']);
    expect(royal[0]).toBe(8);
    const wheel = evaluatePoker(['As', '2h', '3d', '4c', '5s', 'Kh', 'Qh']);
    expect(wheel).toEqual([4, 5]);
    expect(evaluatePoker(['Ah', 'Ad', 'As', 'Kh', 'Kd', 'Kc', '2s'])).toEqual([6, 14, 13]);
    expect(
      comparePoker(
        evaluatePoker(['Ah', 'Ad', 'Ks', 'Qc', 'Jh']),
        evaluatePoker(['Ac', 'As', 'Kd', 'Qh', 'Tc']),
      ),
    ).toBeGreaterThan(0);
  });
  it('never exposes other hole cards and conserves all virtual chips through a complete hand', () => {
    let s = started('poker', 3);
    if (s.view.kind !== 'poker') throw Error();
    const privateView = tableView(s, a),
      spectator = tableView(s, '44444444-4444-4444-8444-444444444444');
    if (privateView.kind !== 'poker' || spectator.kind !== 'poker') throw Error();
    expect(privateView.hands).toHaveLength(1);
    expect(spectator.hands).toEqual([]);
    expect(new Set([...(s.secret.hands ?? []).flat(), ...(s.secret.deck ?? [])]).size).toBe(52);
    for (let n = 0; n < 40; n++) {
      if (s.view.kind !== 'poker' || s.view.stage === 'showdown') break;
      const actor = s.view.seats[s.view.turn]!;
      s = act(s, { kind: 'poker-bet', action: 'call' }, actor);
    }
    expect(s.view).toMatchObject({ stage: 'showdown' });
    if (s.view.kind !== 'poker') throw Error();
    expect(s.view.stacks.reduce((x, y) => x + y, 0)).toBe(3000);
    expect(s.view.payouts.reduce((x, y) => x + y, 0)).toBe(s.view.pot);
  });
  it('builds and mortgages only owned complete groups, and does not let spectators roll', () => {
    let s = started('monopoly');
    expect(act(s, { kind: 'property', action: 'roll' }, c)).toBe(s);
    if (s.view.kind !== 'monopoly') throw Error();
    s.view.owners[1] = 0;
    s.view.owners[3] = 0;
    s = act(s, { kind: 'property', action: 'build', index: 1 });
    expect(s.view.kind === 'monopoly' && s.view.houses[1]).toBe(1);
    expect(act(s, { kind: 'property', action: 'build', index: 1 })).toBe(s);
    expect(act(s, { kind: 'property', action: 'mortgage', index: 3 })).toBe(s);
    s = act(s, { kind: 'property', action: 'sell-house', index: 1 });
    s = act(s, { kind: 'property', action: 'mortgage', index: 1 });
    expect(s.view).toMatchObject({ mortgaged: [1] });
  });
});

import type { TableOf, TableAction } from './activity-table.js';
import {
  addLog,
  shuffled,
  type TableSession,
  type TableContext,
} from './activity-table-internal.js';

export function canRaisePoker(table: TableOf<'poker'>, seat: number): boolean {
  if (seat < 0 || !table.seats[seat] || table.folded.includes(seat) || table.allIn.includes(seat))
    return false;
  if ((table.bets[seat] ?? 0) + (table.stacks[seat] ?? 0) <= table.bet) return false;
  if (!table.acted.includes(seat)) return true;
  const lastBet = table.actedBets?.[seat];
  // A check does not surrender the right to raise an opening short all-in.
  // Multiple short all-ins can together reopen betting for an earlier caller.
  return lastBet === 0 || (lastBet != null && table.bet - lastBet >= table.minRaise);
}

// Lexicographic ranks: category, then five kickers. Evaluates exactly five cards.
function five(cards: string[]): number[] {
  const ranks = cards.map((c) => '23456789TJQKA'.indexOf(c[0]!) + 2).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const unique = [...new Set(ranks)];
  const straight =
    unique.length === 5
      ? unique[0]! - unique[4] === 4
        ? unique[0]!
        : unique.join(',') === '14,5,4,3,2'
          ? 5
          : 0
      : 0;
  const flush = cards.every((c) => c[1] === cards[0]![1]);
  if (straight && flush) return [8, straight];
  if (groups[0]![1] === 4) return [7, groups[0]![0], groups[1]![0]];
  if (groups[0]![1] === 3 && groups[1]![1] === 2) return [6, groups[0]![0], groups[1]![0]];
  if (flush) return [5, ...ranks];
  if (straight) return [4, straight];
  if (groups[0]![1] === 3) return [3, ...groups.map((g) => g[0])];
  if (groups[0]![1] === 2 && groups[1]![1] === 2) return [2, ...groups.map((g) => g[0])];
  if (groups[0]![1] === 2) return [1, ...groups.map((g) => g[0])];
  return [0, ...ranks];
}
export function comparePoker(a: number[], b: number[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
export function evaluatePoker(cards: string[]): number[] {
  let best: number[] = [];
  for (let a = 0; a < cards.length - 4; a++)
    for (let b = a + 1; b < cards.length - 3; b++)
      for (let c = b + 1; c < cards.length - 2; c++)
        for (let d = c + 1; d < cards.length - 1; d++)
          for (let e = d + 1; e < cards.length; e++) {
            const rank = five([cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!]);
            if (comparePoker(rank, best) > 0) best = rank;
          }
  return best;
}
const nextIndex = (v: TableOf<'poker'>, after: number, predicate: (i: number) => boolean) => {
  for (let step = 1; step <= v.seats.length; step++) {
    const i = (after + step) % v.seats.length;
    if (v.seats[i] && predicate(i)) return i;
  }
  return -1;
};
function pay(v: TableOf<'poker'>, seat: number, amount: number) {
  const value = Math.min(v.stacks[seat]!, amount);
  v.stacks[seat]! -= value;
  v.bets[seat]! += value;
  v.contributions[seat]! += value;
  v.pot += value;
  if (!v.stacks[seat] && !v.allIn.includes(seat)) v.allIn.push(seat);
}
export function dealPoker(session: TableSession, now: number): TableSession {
  void now;
  if (session.view.kind !== 'poker') return session;
  const v: TableOf<'poker'> = structuredClone(session.view);
  if (v.seats.filter((id, i) => id && v.stacks[i]! > 0).length < 2)
    return {
      ...session,
      view: {
        ...v,
        phase: 'finished',
        winner: v.seats[v.stacks.findIndex((s) => s > 0)] ?? 'draw',
      },
    };
  v.phase = 'playing';
  v.stage = 'preflop';
  v.board = [];
  v.pot = 0;
  v.bet = 20;
  v.minRaise = 20;
  v.bets = v.seats.map(() => 0);
  v.contributions = v.seats.map(() => 0);
  v.folded = v.seats.flatMap((id, i) => (!id || !v.stacks[i] ? [i] : []));
  v.allIn = [];
  v.acted = [];
  v.actedBets = v.seats.map(() => null);
  v.payouts = v.seats.map(() => 0);
  v.hands = [];
  v.winner = undefined;
  v.handNumber++;
  const deck = shuffled([...'23456789TJQKA'].flatMap((r) => [...'shdc'].map((s) => r + s)));
  const hands = v.seats.map((id, i) =>
    id && !v.folded.includes(i) ? [deck.pop()!, deck.pop()!] : [],
  );
  v.dealer = nextIndex(v, v.dealer, (i) => !v.folded.includes(i));
  const active = v.seats.length - v.folded.length;
  const small = active === 2 ? v.dealer : nextIndex(v, v.dealer, (i) => !v.folded.includes(i));
  const big = nextIndex(v, small, (i) => !v.folded.includes(i));
  pay(v, small, 10);
  pay(v, big, 20);
  v.turn = nextIndex(v, big, (i) => !v.folded.includes(i) && !v.allIn.includes(i));
  const result = {
    view: addLog(v, `Раздача ${v.handNumber} · блайнды 10 / 20`),
    secret: { ...session.secret, deck, hands },
  };
  return v.turn === -1 ? showdown(result) : result;
}
function showdown(session: TableSession): TableSession {
  if (session.view.kind !== 'poker') return session;
  const v = structuredClone(session.view),
    deck = [...(session.secret.deck ?? [])];
  while (v.board.length < 5) v.board.push(deck.pop()!);
  const levels = [...new Set(v.contributions.filter((x) => x > 0))].sort((a, b) => a - b);
  let previous = 0;
  v.payouts = v.seats.map(() => 0);
  for (const level of levels) {
    const contributors = v.contributions.flatMap((n, i) => (n >= level ? [i] : []));
    const amount = (level - previous) * contributors.length;
    previous = level;
    const eligible = contributors.filter((i) => !v.folded.includes(i));
    if (!eligible.length) continue;
    const scores = eligible.map((i) => ({
      i,
      score: evaluatePoker([...(session.secret.hands?.[i] ?? []), ...v.board]),
    }));
    scores.sort((a, b) => comparePoker(b.score, a.score));
    const winners = scores
      .filter((x) => comparePoker(x.score, scores[0]!.score) === 0)
      .map((x) => x.i);
    // Odd chips are assigned clockwise after the dealer.
    winners.sort(
      (a, b) =>
        ((a - v.dealer - 1 + v.seats.length) % v.seats.length) -
        ((b - v.dealer - 1 + v.seats.length) % v.seats.length),
    );
    winners.forEach((i, index) => {
      v.payouts[i]! +=
        Math.floor(amount / winners.length) + (index < amount % winners.length ? 1 : 0);
    });
  }
  v.stacks = v.stacks.map((n, i) => n + v.payouts[i]!);
  v.stage = 'showdown';
  v.turn = v.dealer;
  v.hands = v.seats.flatMap((id, i) =>
    id && !v.folded.includes(i) ? [{ ownerId: id, cards: session.secret.hands?.[i] ?? [] }] : [],
  );
  return { view: addLog(v, 'Вскрытие · банк распределён'), secret: { ...session.secret, deck } };
}
export function reducePoker(
  session: TableSession,
  action: TableAction,
  context: TableContext,
): TableSession {
  if (session.view.kind !== 'poker') return session;
  const old = session.view;
  if (action.kind === 'poker-next')
    return old.stage === 'showdown' && old.hostId === context.actorId
      ? dealPoker(session, context.now)
      : session;
  if (action.kind !== 'poker-bet' || old.phase !== 'playing' || old.stage === 'showdown')
    return session;
  const seat = old.seats.indexOf(context.actorId);
  if (seat !== old.turn || old.folded.includes(seat) || old.allIn.includes(seat)) return session;
  const v = structuredClone(old),
    owed = Math.max(0, v.bet - v.bets[seat]!);
  if (action.action === 'fold') v.folded.push(seat);
  else if (action.action === 'check') {
    if (owed) return session;
  } else if (action.action === 'call') pay(v, seat, owed);
  else {
    const target = action.amount ?? 0;
    if (!canRaisePoker(v, seat) || target <= v.bet || target > v.bets[seat]! + v.stacks[seat]!)
      return session;
    const raise = target - v.bet;
    if (raise < v.minRaise && target !== v.bets[seat]! + v.stacks[seat]!) return session;
    pay(v, seat, target - v.bets[seat]!);
    v.bet = target;
    if (raise >= v.minRaise) {
      v.minRaise = raise;
      v.acted = [];
    }
  }
  if (!v.acted.includes(seat)) v.acted.push(seat);
  v.actedBets ??= v.seats.map((_, i) => (old.acted.includes(i) ? old.bet : null));
  v.actedBets[seat] = v.bet;
  const alive = v.seats.flatMap((id, i) => (id && !v.folded.includes(i) ? [i] : []));
  if (alive.length === 1) {
    v.payouts = v.seats.map((_, i) => (i === alive[0] ? v.pot : 0));
    v.stacks[alive[0]!]! += v.pot;
    v.stage = 'showdown';
    return { ...session, view: addLog(v, 'Все соперники сбросили карты') };
  }
  const pending = (i: number) =>
    !v.folded.includes(i) && !v.allIn.includes(i) && (!v.acted.includes(i) || v.bets[i] !== v.bet);
  const turn = nextIndex(v, seat, pending);
  if (turn !== -1)
    return {
      ...session,
      view: addLog(
        { ...v, turn },
        `Игрок ${seat + 1}: ${action.action}${action.amount ? ' ' + action.amount : ''}`,
      ),
    };
  const active = alive.filter((i) => !v.allIn.includes(i));
  if (v.stage === 'river' || active.length <= 1) return showdown({ ...session, view: v });
  const deck = [...(session.secret.deck ?? [])];
  deck.pop();
  const count = v.stage === 'preflop' ? 3 : 1;
  for (let i = 0; i < count; i++) v.board.push(deck.pop()!);
  v.stage = v.stage === 'preflop' ? 'flop' : v.stage === 'flop' ? 'turn' : 'river';
  v.bet = 0;
  v.minRaise = 20;
  v.bets = v.seats.map(() => 0);
  v.acted = [];
  v.actedBets = v.seats.map(() => null);
  v.turn = nextIndex(v, v.dealer, (i) => active.includes(i));
  return { view: addLog(v, `Открыт ${v.stage}`), secret: { ...session.secret, deck } };
}

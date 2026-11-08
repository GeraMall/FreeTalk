import { Chess } from 'chess.js';
import type { TableAction } from './activity-table.js';
import type { TableContext, TableReducer, TableSession } from './activity-table-internal.js';
import { randomInt } from './activity-table-internal.js';
import { canRaisePoker, evaluatePoker } from './activity-poker.js';
import { propertyBoard } from './activity-property.js';

const names = ['Астра', 'Орион', 'Вега', 'Луна', 'Сириус', 'Нова', 'Альтаир', 'Комета'];
export function configureBot(
  session: TableSession,
  action: Extract<TableAction, { kind: 'table-bot' }>,
  context: TableContext,
): TableSession {
  const v = session.view;
  if (
    v.edition !== 3 ||
    v.hostId !== context.actorId ||
    !['chess', 'fleet', 'monopoly', 'poker'].includes(v.kind)
  )
    return session;
  const between = v.kind === 'poker' && v.stage === 'showdown';
  if (v.phase !== 'lobby' && !between) return session;
  const maximum = v.kind === 'poker' ? 8 : v.kind === 'monopoly' ? 6 : 2;
  if (action.seat >= maximum || action.seat > v.seats.length) return session;
  const oldId = v.seats[action.seat];
  if (action.remove ? !v.bots?.some((b) => b.id === oldId) : Boolean(oldId)) return session;
  const next = structuredClone(session);
  const n = next.view;
  if (action.remove) {
    n.seats[action.seat] = null;
    n.bots = n.bots?.filter((b) => b.id !== oldId);
    if (n.kind === 'fleet') n.ready = n.ready.filter((id) => id !== oldId);
    if (n.kind === 'poker') n.hands = n.hands.filter((h) => h.ownerId !== oldId);
  } else {
    const bot = { id: crypto.randomUUID(), name: `Бот ${names[action.seat]}` };
    n.seats[action.seat] = bot.id;
    n.bots = [...(n.bots ?? []), bot];
    n.training = true; // Latched: removing the bot cannot turn this into a ranked game.
    if (n.kind === 'poker') {
      n.stats = undefined;
      n.ageConfirmed = false;
      n.stacks[action.seat] = 1000;
      n.bets[action.seat] = n.contributions[action.seat] = n.payouts[action.seat] = 0;
      if (n.rebuys) n.rebuys[action.seat] = 0;
      if (n.actedBets) n.actedBets[action.seat] = null;
      if (between) {
        n.phase = 'playing';
        n.winner = undefined;
      }
    }
  }
  if (next.secret.hands) next.secret.hands[action.seat] = [];
  if (next.secret.fleet) next.secret.fleet[action.seat] = [];
  next.secret.botNextAt = 0;
  return next;
}

/** One bounded move per tick. No remote AI, database queries, or access to opponents' cards. */
export function tickBots(
  session: TableSession,
  now: number,
  reduce: TableReducer,
  fleet: () => number[],
): TableSession {
  const v = session.view;
  if (!v.bots?.length || v.phase === 'finished') return session;
  let seat = -1,
    action: TableAction | undefined;
  if (v.kind === 'fleet' && v.phase === 'lobby') {
    seat = v.seats.findIndex((id) => v.bots?.some((b) => b.id === id) && !v.ready.includes(id!));
    if (seat >= 0)
      action =
        (session.secret.fleet?.[seat]?.length ?? 0) === 20
          ? { kind: 'fleet-ready' }
          : { kind: 'fleet-place', cells: fleet() };
  } else if (v.phase !== 'playing') return session;
  else if (v.kind === 'chess') seat = v.fen.split(' ')[1] === 'w' ? 0 : 1;
  else if (v.kind === 'fleet') seat = v.turn;
  else if (v.kind === 'monopoly') seat = v.trade ? v.trade.to : (v.auction?.turn ?? v.turn);
  else if (v.kind === 'poker' && v.stage !== 'showdown' && now >= (v.turnAt ?? 0)) seat = v.turn;
  if (seat < 0 || !v.bots.some((b) => b.id === v.seats[seat])) return session;
  const signature = `${v.id}:${v.kind}:${seat}:${v.log.at(-1)}:${v.kind === 'poker' ? v.turnDeadline : v.kind === 'chess' ? v.moves.length : v.phase}`;
  if (session.secret.botSignature !== signature) {
    session.secret.botSignature = signature;
    session.secret.botNextAt = now + 900;
    return session;
  }
  if (!session.secret.botNextAt) {
    session.secret.botNextAt = now + 900;
    return session;
  }
  if (now < session.secret.botNextAt) return session;
  if (!action && v.kind === 'chess') {
    const chess = new Chess(v.fen),
      values: Record<string, number> = { p: 1, n: 3, b: 3.2, r: 5, q: 9, k: 0 };
    const moves = chess.moves({ verbose: true });
    const scored = moves
      .map((m) => ({
        m,
        score:
          (m.captured ? values[m.captured]! * 10 : 0) +
          (m.promotion ? 9 : 0) +
          (m.san.includes('+') ? 1 : 0) +
          (m.san.includes('#') ? 1000 : 0) +
          randomInt(12) / 10,
      }))
      .sort((a, b) => b.score - a.score);
    const move = scored[0]?.m;
    if (move) action = { kind: 'chess-move', from: move.from, to: move.to, promotion: 'q' };
  } else if (!action && v.kind === 'fleet') {
    const board = v.boards[1 - seat];
    const unknown = board?.cells.flatMap((cell, i) => (cell === -1 ? [i] : [])) ?? [];
    const near = unknown.filter((i) =>
      [i - 10, i + 10, ...(i % 10 ? [i - 1] : []), ...(i % 10 < 9 ? [i + 1] : [])].some(
        (n) => board?.cells[n] === 1,
      ),
    );
    const choices = near.length
      ? near
      : unknown.filter((i) => (Math.floor(i / 10) + (i % 10)) % 2 === 0);
    const cells = choices.length ? choices : unknown;
    if (cells.length) action = { kind: 'fleet-shot', index: cells[randomInt(cells.length)]! };
  } else if (!action && v.kind === 'poker') {
    const own = session.secret.hands?.[seat] ?? [],
      owed = Math.max(0, v.bet - v.bets[seat]!),
      stack = v.stacks[seat]!;
    const rank = v.board.length
      ? (evaluatePoker([...own, ...v.board])[0] ?? 0)
      : own[0]?.[0] === own[1]?.[0]
        ? 2
        : 0;
    const high = own.some((c) => 'AKQ'.includes(c[0]!));
    if (owed > stack * 0.35 && rank < 1 && !high) action = { kind: 'poker-bet', action: 'fold' };
    else if (rank >= 2 && canRaisePoker(v, seat) && randomInt(3) === 0) {
      const target = Math.min(v.bets[seat]! + stack, v.bet + v.minRaise);
      action = { kind: 'poker-bet', action: 'raise', amount: target };
    } else action = { kind: 'poker-bet', action: owed ? 'call' : 'check' };
  } else if (!action && v.kind === 'monopoly') {
    if (v.trade) action = { kind: 'property-trade-answer', accept: false };
    else if (v.auction)
      action = {
        kind: 'property',
        action:
          v.auction.bid + 10 < Math.min(v.money[seat]! - 100, propertyBoard[v.auction.index]![1])
            ? 'bid'
            : 'auction-pass',
      };
    else if (v.step === 'roll') action = { kind: 'property', action: 'roll' };
    else if (v.step === 'buy')
      action = {
        kind: 'property',
        action: v.money[seat]! >= propertyBoard[v.positions[seat]!]![1] + 80 ? 'buy' : 'pass',
      };
    else if (v.step === 'end') action = { kind: 'property', action: 'end' };
    else {
      const house =
        v.owners
          .map((owner, i) => ({ owner, i }))
          .filter(({ owner, i }) => owner === seat && v.houses[i]! > 0)
          .sort((a, b) => v.houses[b.i]! - v.houses[a.i]!)[0]?.i ?? -1;
      const mortgage = v.owners.findIndex(
        (owner, i) =>
          owner === seat &&
          !v.mortgaged.includes(i) &&
          v.houses[i] === 0 &&
          !propertyBoard.some((tile, j) => tile[2] === propertyBoard[i]![2] && v.houses[j]! > 0),
      );
      action =
        house >= 0
          ? { kind: 'property', action: 'sell-house', index: house }
          : mortgage >= 0
            ? { kind: 'property', action: 'mortgage', index: mortgage }
            : { kind: 'property', action: 'bankrupt' };
    }
  }
  session.secret.botNextAt = now + 1100;
  if (!action) return session;
  const input = { ...session, secret: { ...session.secret, botActing: true } };
  const result = reduce(input, action, {
    actorId: v.seats[seat]!,
    members: v.seats.filter((id): id is string => Boolean(id)),
    now,
  });
  if (result === input) return session;
  result.secret.botActing = false;
  result.secret.botNextAt = now + 1100;
  return result;
}

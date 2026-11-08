import { configureBot, tickBots } from './activity-bots.js';
import { Chess } from 'chess.js';
import type { ActivityTable, TableKind, TableAction } from './activity-table.js';
import {
  addLog,
  randomInt,
  type TableSession,
  type TableContext,
} from './activity-table-internal.js';
import { dealPoker, reducePoker, tickPoker } from './activity-poker.js';
import { reduceProperty } from './activity-property.js';
import { makeQuiz, quizQuestion, reduceQuiz } from './activity-quiz.js';
export type { TableSession, TableContext } from './activity-table-internal.js';
export const chessPresets: Record<string, [number, number]> = {
  bullet: [1, 0],
  bullet2: [2, 1],
  blitz3: [3, 0],
  blitz: [3, 2],
  blitz5: [5, 0],
  blitz5i: [5, 3],
  rapid10: [10, 0],
  rapid: [10, 5],
  classical: [15, 10],
  unlimited: [0, 0],
};
export const fleetShips = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];
export function validFleet(cells: number[]): boolean {
  const set = new Set(cells);
  if (
    cells.length !== 20 ||
    set.size !== 20 ||
    cells.some((i) => i < 0 || i >= 100 || !Number.isInteger(i))
  )
    return false;
  const groups: number[][] = [];
  for (const first of cells) {
    if (groups.some((g) => g.includes(first))) continue;
    const group = [first];
    for (const i of group)
      for (const n of [i - 10, i + 10, ...(i % 10 ? [i - 1] : []), ...(i % 10 < 9 ? [i + 1] : [])])
        if (set.has(n) && !group.includes(n)) group.push(n);
    groups.push(group);
  }
  for (const group of groups) {
    if (
      !group.every((i) => Math.floor(i / 10) === Math.floor(group[0]! / 10)) &&
      !group.every((i) => i % 10 === group[0]! % 10)
    )
      return false;
    for (const i of group)
      for (const dy of [-1, 1])
        for (const dx of [-1, 1]) {
          const x = (i % 10) + dx,
            y = Math.floor(i / 10) + dy;
          if (
            x >= 0 &&
            x < 10 &&
            y >= 0 &&
            y < 10 &&
            set.has(y * 10 + x) &&
            !group.includes(y * 10 + x)
          )
            return false;
        }
  }
  return (
    groups
      .map((g) => g.length)
      .sort((a, b) => b - a)
      .join(',') === fleetShips.join(',')
  );
}
export function randomFleet(): number[] {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const placed: number[] = [];
    let failed = false;
    for (const size of fleetShips) {
      const candidates: number[][] = [];
      for (let start = 0; start < 100; start++)
        for (const step of [1, 10]) {
          if ((step === 1 ? start % 10 : Math.floor(start / 10)) + size > 10) continue;
          const group = Array.from({ length: size }, (_, i) => start + i * step);
          if (
            group.every((i) =>
              placed.every(
                (p) =>
                  Math.abs((p % 10) - (i % 10)) > 1 ||
                  Math.abs(Math.floor(p / 10) - Math.floor(i / 10)) > 1,
              ),
            )
          )
            candidates.push(group);
        }
      if (!candidates.length) {
        failed = true;
        break;
      }
      placed.push(...candidates[randomInt(candidates.length)]!);
    }
    if (!failed) return placed;
  }
  throw new Error('Fleet placement failed');
}
export function createTable(
  kind: TableKind,
  context: TableContext,
  pokerRules?: 2,
  pokerSeats?: 8,
  edition?: 3,
  pokerFlow?: 2,
  propertyRules?: 2,
): TableSession {
  const maximum =
    kind === 'poker' && pokerSeats === 8
      ? 8
      : kind === 'chess' || kind === 'fleet'
        ? 2
        : kind === 'millionaire'
          ? 1
          : 6;
  const base = {
    edition,
    id: crypto.randomUUID(),
    hostId: context.actorId,
    phase: 'lobby' as const,
    seats: Array<string | null>(maximum).fill(null),
    preset: kind === 'chess' ? 'rapid' : kind === 'millionaire' ? 'ru' : 'standard',
    log: [],
  };
  base.seats[0] = context.actorId;
  let view: ActivityTable;
  if (kind === 'chess')
    view = {
      ...base,
      kind,
      fen: new Chess().fen(),
      moves: [],
      clocks: [600000, 600000],
      turnAt: 0,
      increment: 5000,
      check: false,
    };
  else if (kind === 'fleet') view = { ...base, kind, ready: [], turn: 0, boards: [] };
  else if (kind === 'millionaire')
    view = {
      ...base,
      kind,
      level: 0,
      earned: 0,
      guaranteed: 0,
      question: '',
      answers: [],
      eliminated: [],
      lifelines: [],
    };
  else if (kind === 'monopoly')
    view = {
      ...base,
      propertyRules,
      kind,
      turn: 0,
      positions: base.seats.map(() => 0),
      money: base.seats.map(() => 1500),
      owners: Array<number>(40).fill(-1),
      houses: Array<number>(40).fill(0),
      mortgaged: [],
      bankrupt: [],
      jail: base.seats.map(() => 0),
      dice: [0, 0],
      step: 'roll',
      doubles: 0,
      extraRoll: false,
      debtTo: -1,
    };
  else
    view = {
      ...base,
      kind,
      dealer: maximum - 1,
      turn: 0,
      stage: 'preflop',
      board: [],
      pot: 0,
      bet: 0,
      minRaise: 20,
      stacks: base.seats.map(() => 1000),
      bets: base.seats.map(() => 0),
      contributions: base.seats.map(() => 0),
      folded: [],
      allIn: [],
      acted: [],
      hands: [],
      payouts: base.seats.map(() => 0),
      handNumber: 0,
      pokerRules,
      pokerSeats,
      pokerFlow: edition === 3 ? pokerFlow : undefined,
    };
  return { view, secret: {} };
}
export function tableView(session: TableSession, viewerId?: string): ActivityTable {
  const v = session.view;
  if (v.kind === 'fleet') {
    const spectator = !v.seats.includes(viewerId ?? '');
    return {
      ...v,
      boards: v.seats.flatMap((ownerId, seat) =>
        ownerId
          ? [
              {
                ownerId,
                cells: (v.boards[seat]?.cells ?? Array<number>(100).fill(-1)).map((cell, index) =>
                  cell === -1 &&
                  (ownerId === viewerId ||
                    (spectator && v.phase !== 'lobby') ||
                    v.phase === 'finished') &&
                  session.secret.fleet?.[seat]?.includes(index)
                    ? 2
                    : cell,
                ),
              },
            ]
          : [],
      ),
    };
  }
  if (v.kind === 'poker') {
    const hands = v.stage === 'showdown' ? [...v.hands] : [];
    const own = v.seats.indexOf(viewerId ?? '');
    if (own >= 0 && !hands.some((h) => h.ownerId === viewerId))
      hands.push({ ownerId: viewerId!, cards: session.secret.hands?.[own] ?? [] });
    return { ...v, hands };
  }
  return v;
}
export function tickTable(session: TableSession, now: number): TableSession {
  const timed = tickTableClock(session, now);
  return timed === session ? tickBots(session, now, reduceTable, randomFleet) : timed;
}
function tickTableClock(session: TableSession, now: number): TableSession {
  const v = session.view;
  if (v.kind === 'poker') return tickPoker(session, now);
  if (v.kind !== 'chess' || v.phase !== 'playing' || v.preset === 'unlimited') return session;
  const side = v.fen.split(' ')[1] === 'w' ? 0 : 1;
  if (now - v.turnAt < v.clocks[side]) return session;
  const chess = new Chess(v.fen);
  const winner = chess.isInsufficientMaterial() ? 'draw' : v.seats[1 - side]!;
  return {
    ...session,
    view: addLog(
      { ...v, phase: 'finished', winner, clocks: side === 0 ? [0, v.clocks[1]] : [v.clocks[0], 0] },
      'Время истекло',
    ),
  };
}
export function reduceTable(
  session: TableSession,
  action: TableAction,
  context: TableContext,
): TableSession {
  if (!context.members.includes(context.actorId)) return session;
  const timed = session.secret.botActing ? session : tickTableClock(session, context.now);
  if (timed !== session) return timed;
  let v = session.view;
  if (v.bots?.some((bot) => bot.id === context.actorId) && !session.secret.botActing)
    return session;
  if (
    v.kind === 'poker' &&
    v.edition === 3 &&
    !session.secret.botActing &&
    !context.adultIds?.includes(context.actorId)
  )
    return session;
  if (action.kind === 'table-bot') return configureBot(session, action, context);
  if (action.kind === 'poker-config') {
    if (
      v.kind !== 'poker' ||
      v.edition !== 3 ||
      v.phase !== 'lobby' ||
      v.hostId !== context.actorId
    )
      return session;
    return {
      ...session,
      view: {
        ...v,
        pokerMode: action.mode,
        pokerAnte: action.ante,
        ageConfirmed: action.ageConfirmed ?? v.ageConfirmed,
      },
    };
  }
  const seat = v.seats.indexOf(context.actorId);
  if (action.kind === 'table-reset') {
    if (context.actorId !== v.hostId) return session;
    const fresh = createTable(
      v.kind,
      context,
      v.kind === 'poker' ? v.pokerRules : undefined,
      v.kind === 'poker' ? v.pokerSeats : undefined,
      v.edition,
      v.kind === 'poker' ? v.pokerFlow : undefined,
      v.kind === 'monopoly' ? v.propertyRules : undefined,
    );
    fresh.view.training = v.training;
    fresh.view.bots = v.bots;
    v.seats.forEach((id, i) => {
      if (v.bots?.some((b) => b.id === id)) fresh.view.seats[i] = id;
    });
    if (fresh.view.kind === 'poker' && v.kind === 'poker') {
      fresh.view.pokerMode = v.pokerMode;
      fresh.view.pokerAnte = v.pokerAnte;
    }
    return fresh;
  }
  if (action.kind === 'table-seat' && v.phase === 'lobby') {
    if (v.kind === 'poker' && v.edition === 3) v = { ...v, ageConfirmed: false };
    if (action.seat !== null && (action.seat >= v.seats.length || v.seats[action.seat]))
      return session;
    const seats = v.seats.map((id) => (id === context.actorId ? null : id));
    if (action.seat !== null) seats[action.seat] = context.actorId;
    if (v.kind === 'fleet') {
      const fleet = [...(session.secret.fleet ?? [[], []])];
      for (let i = 0; i < seats.length; i++) if (seats[i] !== v.seats[i]) fleet[i] = [];
      return {
        ...session,
        secret: { ...session.secret, fleet },
        view: { ...v, seats, ready: v.ready.filter((id) => seats.includes(id)), boards: [] },
      };
    }
    return { ...session, view: { ...v, seats } };
  }
  if (action.kind === 'table-config' && v.phase === 'lobby' && v.hostId === context.actorId) {
    if (v.kind === 'chess' && !chessPresets[action.preset]) return session;
    if (v.kind === 'millionaire' && !['ru', 'en'].includes(action.preset)) return session;
    if (
      v.kind !== 'chess' &&
      v.kind !== 'millionaire' &&
      !['quick', 'standard'].includes(action.preset)
    )
      return session;
    return { ...session, view: { ...v, preset: action.preset } };
  }
  if (action.kind === 'table-start' && v.phase === 'lobby' && v.hostId === context.actorId) {
    if (
      v.kind === 'poker' &&
      v.edition === 3 &&
      (!v.ageConfirmed ||
        v.seats.some(
          (id) => id && !v.bots?.some((b) => b.id === id) && !context.adultIds?.includes(id),
        ))
    )
      return session;
    const seated = v.seats.filter(Boolean);
    if (
      seated.length < (v.kind === 'millionaire' ? 1 : 2) ||
      seated.some((id) => !context.members.includes(id!) && !v.bots?.some((b) => b.id === id))
    )
      return session;
    if (v.kind === 'chess') {
      const [minutes, increment] = chessPresets[v.preset]!;
      return {
        ...session,
        view: {
          ...v,
          phase: 'playing',
          clocks: [minutes * 60000, minutes * 60000],
          increment: increment * 1000,
          turnAt: context.now,
        },
      };
    }
    if (v.kind === 'fleet') return session; // Both ready fleets start the match.
    if (v.kind === 'millionaire') {
      const quiz = makeQuiz(v.preset);
      return { view: quizQuestion({ ...v, phase: 'playing' }, quiz), secret: { quiz, votes: {} } };
    }
    v = { ...v, phase: 'playing', seats: seated as string[] };
    if (v.kind === 'poker')
      return dealPoker(
        { view: { ...v, stacks: v.seats.map(() => 1000) }, secret: {} },
        context.now,
      );
    if (v.kind === 'monopoly')
      return {
        ...session,
        view: {
          ...v,
          money: v.seats.map(() => (v.preset === 'quick' ? 1000 : 1500)),
          positions: v.seats.map(() => 0),
          jail: v.seats.map(() => 0),
        },
      };
  }
  if (
    action.kind === 'table-resign' &&
    seat >= 0 &&
    v.phase === 'playing' &&
    (v.kind === 'chess' || v.kind === 'fleet')
  )
    return {
      ...session,
      view: addLog(
        { ...v, phase: 'finished', winner: v.seats[1 - seat]! },
        `Игрок ${seat + 1} сдался`,
      ),
    };
  if (v.kind === 'chess' && v.phase === 'playing') {
    if (action.kind === 'chess-draw' && seat >= 0)
      return {
        ...session,
        view:
          v.drawOffer && v.drawOffer !== context.actorId
            ? { ...v, phase: 'finished', winner: 'draw' }
            : { ...v, drawOffer: context.actorId },
      };
    if (action.kind !== 'chess-move' || seat < 0 || seat !== (v.fen.split(' ')[1] === 'w' ? 0 : 1))
      return session;
    try {
      const chess = new Chess();
      for (const san of v.moves) chess.move(san);
      const move = chess.move({
        from: action.from,
        to: action.to,
        promotion: action.promotion ?? 'q',
      });
      const clocks: [number, number] = [...v.clocks];
      if (v.preset !== 'unlimited')
        clocks[seat] = Math.max(0, clocks[seat] - (context.now - v.turnAt)) + v.increment;
      const winner = chess.isCheckmate()
        ? context.actorId
        : chess.isDraw() || v.moves.length >= 399
          ? 'draw'
          : undefined;
      return {
        ...session,
        view: addLog(
          {
            ...v,
            fen: chess.fen(),
            moves: [...v.moves, move.san],
            check: chess.isCheck(),
            clocks,
            turnAt: context.now,
            lastMove: [action.from, action.to],
            drawOffer: undefined,
            winner,
            phase: winner ? 'finished' : 'playing',
          },
          move.san,
        ),
      };
    } catch {
      return session;
    }
  }
  if (v.kind === 'fleet' && seat >= 0) {
    if (v.phase === 'lobby') {
      if (
        action.kind === 'fleet-place' &&
        !v.ready.includes(context.actorId) &&
        validFleet(action.cells)
      ) {
        const fleet = [...(session.secret.fleet ?? [[], []])];
        fleet[seat] = [...action.cells];
        return { ...session, view: { ...v }, secret: { ...session.secret, fleet } };
      }
      if (
        action.kind === 'fleet-ready' &&
        !v.ready.includes(context.actorId) &&
        validFleet(session.secret.fleet?.[seat] ?? [])
      ) {
        const ready = [...v.ready, context.actorId];
        const start =
          ready.length === 2 &&
          v.seats.every(
            (id) => id && (context.members.includes(id) || v.bots?.some((b) => b.id === id)),
          );
        return {
          ...session,
          view: {
            ...v,
            ready,
            phase: start ? 'playing' : 'lobby',
            turn: randomInt(2),
            boards: v.seats.flatMap((id) =>
              id ? [{ ownerId: id, cells: Array<number>(100).fill(-1) }] : [],
            ),
          },
        };
      }
    }
    if (action.kind === 'fleet-shot' && v.phase === 'playing' && seat === v.turn) {
      const other = 1 - seat,
        boards = structuredClone(v.boards),
        board = boards[other];
      if (!board || board.cells[action.index] !== -1) return session;
      const layout = session.secret.fleet?.[other] ?? [],
        hit = layout.includes(action.index);
      board.cells[action.index] = hit ? 1 : 0;
      const won = layout.every((i) => board.cells[i] === 1 || board.cells[i] === 3);
      return {
        ...session,
        view: addLog(
          {
            ...v,
            boards,
            turn: hit ? seat : other,
            phase: won ? 'finished' : 'playing',
            winner: won ? context.actorId : undefined,
          },
          `Игрок ${seat + 1}: ${String.fromCharCode(65 + (action.index % 10))}${Math.floor(action.index / 10) + 1} · ${hit ? 'попадание' : 'мимо'}`,
        ),
      };
    }
  }
  if (v.kind === 'millionaire') return reduceQuiz(session, action, context);
  if (v.kind === 'monopoly') return reduceProperty(session, action, context);
  if (v.kind === 'poker') return reducePoker(session, action, context);
  return session;
}

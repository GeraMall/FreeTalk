import { Chess } from 'chess.js';
import type { ActivityGame, RoomActivity, RoomActivityAction } from './room-activity.js';
import { tableActionSchema } from './activity-table.js';
import {
  createTable,
  reduceTable,
  tableView,
  tickTable,
  type TableSession,
  type TableContext,
} from './activity-table-session.js';

export interface RoomActivitySession {
  view: RoomActivity;
  hidden?: number[];
  moves?: string[];
  table?: TableSession;
}
export function roomActivityView(
  session: RoomActivitySession,
  viewerId?: string,
  version2 = true,
  pokerEight = true,
): RoomActivity {
  return {
    ...session.view,
    table:
      version2 && session.table && (pokerEight || session.table.view.seats.length <= 6)
        ? tableView(session.table, viewerId)
        : undefined,
  };
}
export function tickRoomActivity(session: RoomActivitySession, now: number): RoomActivitySession {
  if (!session.table) return session;
  const table = tickTable(session.table, now);
  return table === session.table
    ? session
    : {
        ...session,
        table,
        view: { ...session.view, revision: session.view.revision + 1, table: tableView(table) },
      };
}

export function emptyRoomActivity(): RoomActivitySession {
  return { view: { revision: 0, open: false, region: 'RU' } };
}

const width = 8;
const area = width * width;
const hidden = -1;
const flag = -2;
const mine = 9;
const shipHit = 10;
const mineCount = 9;
const ships = [3, 2, 2];

function neighbors(index: number) {
  const row = Math.floor(index / width);
  const col = index % width;
  const result: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const y = row + dy;
      const x = col + dx;
      if ((dx || dy) && x >= 0 && x < width && y >= 0 && y < width) result.push(y * width + x);
    }
  }
  return result;
}

function placeMines(first: number) {
  const safe = new Set([first, ...neighbors(first)]);
  const available = Array.from({ length: area }, (_, index) => index).filter(
    (index) => !safe.has(index),
  );
  return Array.from(
    { length: mineCount },
    () => available.splice(Math.floor(Math.random() * available.length), 1)[0]!,
  );
}

function placeFleet() {
  const occupied = new Set<number>();
  for (const length of ships) {
    const candidates = [];
    for (let index = 0; index < area; index++) {
      for (const step of [1, width]) {
        const start = step === 1 ? index % width : Math.floor(index / width);
        if (start + length > width) continue;
        const cells = Array.from({ length }, (_, offset) => index + offset * step);
        if (cells.every((cell) => !occupied.has(cell))) candidates.push(cells);
      }
    }
    for (const index of candidates[Math.floor(Math.random() * candidates.length)]!)
      occupied.add(index);
  }
  return [...occupied];
}

function revealMines(cells: number[], mines: Set<number>, index: number) {
  if (mines.has(index)) {
    for (const cell of mines) cells[cell] = mine;
    return 'lost';
  }
  const pending = [index];
  for (const cell of pending) {
    if (cells[cell] !== hidden || mines.has(cell)) continue;
    const nearby = neighbors(cell);
    cells[cell] = nearby.filter((next) => mines.has(next)).length;
    if (cells[cell] === 0) pending.push(...nearby);
  }
  if (cells.filter((cell) => cell >= 0).length === area - mineCount) return 'won';
}

function startGame(game: ActivityGame, view: RoomActivity): RoomActivitySession {
  if (game === 'chess') {
    return {
      view: { ...view, game: { kind: game, fen: new Chess().fen(), check: false } },
      moves: [],
    };
  }
  return {
    view: { ...view, game: { kind: game, cells: Array<number>(area).fill(hidden) } },
    hidden: game === 'fleet' ? placeFleet() : undefined,
  };
}

const serviceRegions: Record<string, RoomActivity['region']> = {
  yandex: 'RU',
  kuper: 'RU',
  samokat: 'RU',
  'dodo-ru': 'RU',
  'papa-johns-ru': 'RU',
  wolt: 'KZ',
  glovo: 'KZ',
  'dodo-kz': 'KZ',
  'papa-johns-kz': 'KZ',
  'deliveroo-gb': 'GB',
  'just-eat-gb': 'GB',
  'uber-eats-gb': 'GB',
  'dominos-gb': 'GB',
};

export function applyRoomActivity(
  current: RoomActivitySession,
  revision: number,
  action: RoomActivityAction,
  context?: TableContext,
): RoomActivitySession {
  const previous = current.view;
  if (revision !== previous.revision) return current;
  const view = { ...previous, revision: previous.revision + 1 };
  if (action.kind === 'open')
    return previous.open ? current : { ...current, view: { ...view, open: true } };
  if (!previous.open) return current;
  if (action.kind === 'tablet-join' || action.kind === 'tablet-pointer') return current;
  if (action.kind === 'table-open' && context) {
    if (current.table && current.table.view.hostId !== context.actorId) return current;
    const table = createTable(action.game, context, action.pokerRules, action.pokerSeats);
    return { table, view: { ...view, game: undefined, table: tableView(table) } };
  }
  if (current.table && context) {
    if (['close', 'game', 'service', 'region'].includes(action.kind)) {
      if (current.table.view.hostId !== context.actorId) return current;
    } else {
      const parsed = tableActionSchema.safeParse(action);
      if (!parsed.success) return current;
      const table = reduceTable(current.table, parsed.data, context);
      return table === current.table
        ? current
        : { ...current, table, view: { ...view, table: tableView(table) } };
    }
  }
  if (action.kind === 'close')
    return {
      view: {
        ...view,
        open: false,
        service: undefined,
        game: undefined,
        table: undefined,
        viewers: [],
      },
    };
  if (action.kind === 'region') {
    return action.region === view.region
      ? current
      : { ...current, view: { ...view, region: action.region, service: undefined } };
  }
  if (action.kind === 'service') {
    return serviceRegions[action.service] === view.region
      ? { view: { ...view, game: undefined, service: action.service } }
      : current;
  }
  if (action.kind === 'game') return startGame(action.game, { ...view, table: undefined });
  const game = view.game;
  if (!game || game.result) return current;

  if (action.kind === 'move' && game.kind === 'chess') {
    const chess = new Chess();
    const moves = current.moves ?? [];
    try {
      for (const move of moves) chess.move(move);
      const move = chess.move({
        from: action.from,
        to: action.to,
        promotion: action.promotion ?? 'q',
      });
      if (!move) return current;
      const result = chess.isCheckmate()
        ? chess.turn() === 'w'
          ? 'black'
          : 'white'
        : chess.isDraw() || moves.length >= 399
          ? 'draw'
          : undefined;
      return {
        view: {
          ...view,
          game: { kind: 'chess', fen: chess.fen(), check: chess.isCheck(), result },
        },
        moves: [...moves, move.san],
      };
    } catch {
      return current;
    }
  }

  if (action.kind !== 'cell' || game.kind === 'chess') return current;
  const cells = [...game.cells];
  const index = action.index;
  if (game.kind === 'mines' && action.flag && (cells[index] === hidden || cells[index] === flag)) {
    cells[index] = cells[index] === flag ? hidden : flag;
    return { ...current, view: { ...view, game: { ...game, cells } } };
  }
  if (cells[index] !== hidden) return current;
  const layout = current.hidden ?? placeMines(index);
  let result: 'won' | 'lost' | undefined;
  if (game.kind === 'mines') result = revealMines(cells, new Set(layout), index);
  else {
    cells[index] = layout.includes(index) ? shipHit : 0;
    if (layout.every((cell) => cells[cell] === shipHit)) result = 'won';
    else if (cells.filter((cell) => cell === 0).length >= 24) result = 'lost';
  }
  return { view: { ...view, game: { ...game, cells, result } }, hidden: layout };
}

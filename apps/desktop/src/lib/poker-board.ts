import {
  POKER_BOARD_DELAY,
  POKER_BOARD_STEP,
  pokerBoardDuration,
  type TableOf,
} from '@freetalk/protocol';
export function pokerVisibleBoard(table: TableOf<'poker'>, now: number) {
  if (table.edition !== 3 || table.boardAt === undefined) return table.board;
  const from = table.boardFrom ?? 0;
  const added = Math.max(
    0,
    Math.floor((now - table.boardAt - POKER_BOARD_DELAY) / POKER_BOARD_STEP) + 1,
  );
  return table.board.slice(0, Math.min(table.board.length, from + added));
}
export function pokerRevealing(table: TableOf<'poker'>, now: number) {
  return (
    table.edition === 3 &&
    table.boardAt !== undefined &&
    now < table.boardAt + pokerBoardDuration(table.board.length - (table.boardFrom ?? 0))
  );
}

export const POKER_BOARD_DELAY = 150;
export const POKER_BOARD_STEP = 520;
export const POKER_BOARD_FLIGHT = 650;
export function pokerBoardDuration(count: number) {
  return count > 0
    ? POKER_BOARD_DELAY + (count - 1) * POKER_BOARD_STEP + POKER_BOARD_FLIGHT + 200
    : 0;
}

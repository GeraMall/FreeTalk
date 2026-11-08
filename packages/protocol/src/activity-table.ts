import { z } from 'zod';

export const tableKindSchema = z.enum(['chess', 'fleet', 'monopoly', 'millionaire', 'poker']);
const id = z.string().uuid();
const count = z.number().int().nonnegative();
const base = {
  edition: z.literal(3).optional(),
  training: z.boolean().optional(),
  bots: z
    .array(z.object({ id, name: z.string().max(40) }))
    .max(8)
    .optional(),
  id,
  hostId: id,
  phase: z.enum(['lobby', 'playing', 'finished']),
  seats: z.array(id.nullable()).max(6),
  preset: z.string().max(24),
  log: z.array(z.string().max(180)).max(80),
  winner: z.string().max(80).optional(),
};
export const tableSchema = z.discriminatedUnion('kind', [
  z.object({
    ...base,
    kind: z.literal('chess'),
    fen: z.string().max(128),
    moves: z.array(z.string().max(12)).max(400),
    clocks: z.tuple([count, count]),
    turnAt: count,
    increment: count,
    check: z.boolean(),
    lastMove: z.tuple([z.string(), z.string()]).optional(),
    drawOffer: id.optional(),
  }),
  z.object({
    ...base,
    kind: z.literal('fleet'),
    ready: z.array(id).max(2),
    turn: count,
    boards: z
      .array(z.object({ ownerId: id, cells: z.array(z.number().int().min(-1).max(3)).length(100) }))
      .max(2),
  }),
  z.object({
    ...base,
    kind: z.literal('millionaire'),
    level: count,
    earned: count,
    guaranteed: count,
    question: z.string().max(300),
    answers: z.array(z.string().max(160)).max(4),
    selected: z.number().int().min(0).max(3).optional(),
    correct: z.number().int().min(0).max(3).optional(),
    eliminated: z.array(z.number().int().min(0).max(3)).max(2),
    lifelines: z.array(z.enum(['half', 'audience', 'friend'])).max(3),
    audience: z.array(count).length(4).optional(),
    helpUntil: count.optional(),
  }),
  z.object({
    ...base,
    kind: z.literal('monopoly'),
    propertyRules: z.literal(2).optional(),
    pendingJailDice: z.tuple([count, count]).optional(),
    lastMove: z
      .object({
        sequence: count,
        roll: z.boolean().optional(),
        seat: count,
        from: count,
        path: z.array(count.max(39)).max(14),
        at: count,
        until: count,
      })
      .optional(),
    lastCard: z
      .object({
        sequence: count,
        kind: z.enum(['chance', 'event']),
        title: z.string().max(80),
        text: z.string().max(400),
        at: count,
      })
      .optional(),
    turn: count,
    positions: z.array(count).max(6),
    money: z.array(z.number().int()).max(6),
    owners: z.array(z.number().int().min(-1).max(5)).length(40),
    houses: z.array(z.number().int().min(0).max(5)).length(40),
    mortgaged: z.array(count).max(40),
    bankrupt: z.array(count).max(6),
    jail: z.array(count).max(6),
    dice: z.tuple([count, count]),
    step: z.enum(['roll', 'buy', 'end', 'debt']),
    doubles: count,
    extraRoll: z.boolean(),
    debtTo: z.number().int(),
    auction: z
      .object({
        index: count,
        bid: count,
        bidder: z.number().int(),
        passed: z.array(count).max(6),
        turn: count,
      })
      .optional(),
    trade: z
      .object({
        from: count,
        to: count,
        give: z.array(count).max(28),
        want: z.array(count).max(28),
        cash: z.number().int(),
      })
      .optional(),
  }),
  z.object({
    ...base,
    kind: z.literal('poker'),
    seats: z.array(id.nullable()).max(8),
    dealer: count,
    turn: count,
    stage: z.enum(['preflop', 'flop', 'turn', 'river', 'showdown']),
    board: z.array(z.string().max(3)).max(5),
    pot: count,
    bet: count,
    minRaise: count,
    stacks: z.array(count).max(8),
    bets: z.array(count).max(8),
    contributions: z.array(count).max(8),
    folded: z.array(count).max(8),
    allIn: z.array(count).max(8),
    acted: z.array(count).max(8),
    actedBets: z.array(count.nullable()).max(8).optional(),
    hands: z.array(z.object({ ownerId: id, cards: z.array(z.string().max(3)).max(2) })).max(8),
    payouts: z.array(count).max(8),
    handNumber: count,
    pokerRules: z.literal(2).optional(),
    pokerSeats: z.literal(8).optional(),
    pokerFlow: z.literal(2).optional(),
    nextHandAt: count.optional(),
    levelEndsAt: count.optional(),
    pokerBreak: z
      .object({
        id: id,
        startedAt: count,
        endsAt: count,
        nextLevel: count.max(10),
        electorate: z.array(id).max(8),
        yes: z.array(id).max(8),
      })
      .optional(),
    pokerMode: z.enum(['classic', 'tournament', 'tournament-fixed']).optional(),
    pokerAnte: z.boolean().optional(),
    ageConfirmed: z.boolean().optional(),
    tournamentStartedAt: count.optional(),
    blindLevel: count.optional(),
    smallBlindAmount: count.optional(),
    bigBlindAmount: count.optional(),
    anteAmount: count.optional(),
    boardAt: count.optional(),
    boardFrom: count.optional(),
    turnAt: count.optional(),
    turnDeadline: count.optional(),
    handStartedAt: count.optional(),
    handEndedAt: count.optional(),
    smallBlind: count.optional(),
    bigBlind: count.optional(),
    rebuys: z.array(count.max(3)).max(8).optional(),
    stats: z
      .array(z.object({ hands: count, wins: count, won: count, lost: count }))
      .max(8)
      .optional(),
    settledHand: count.optional(),
    lastAction: z
      .object({
        seat: count,
        kind: z.enum(['fold', 'check', 'call', 'raise', 'timeout', 'rebuy']),
        amount: count,
        at: count,
        sequence: count,
      })
      .optional(),
  }),
]);
export type ActivityTable = z.infer<typeof tableSchema>;
export type TableKind = z.infer<typeof tableKindSchema>;
export type TableOf<K extends TableKind> = Extract<ActivityTable, { kind: K }>;
/** Required gate for any current or future game leaderboard. Training is permanent for a match. */
export function tableCountsForStatistics(table: ActivityTable) {
  return table.training !== true && !table.bots?.length;
}
export const tableActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('table-open'),
    propertyRules: z.literal(2).optional(),
    edition: z.literal(3).optional(),
    pokerFlow: z.literal(2).optional(),
    game: tableKindSchema,
    pokerRules: z.literal(2).optional(),
    pokerSeats: z.literal(8).optional(),
  }),
  z.object({ kind: z.literal('table-seat'), seat: z.number().int().min(0).max(7).nullable() }),
  z.object({
    kind: z.literal('table-config'),
    preset: z.enum([
      'bullet',
      'bullet2',
      'blitz3',
      'blitz',
      'blitz5',
      'blitz5i',
      'rapid10',
      'rapid',
      'classical',
      'unlimited',
      'standard',
      'quick',
      'ru',
      'en',
    ]),
  }),
  z.object({ kind: z.literal('table-start') }),
  z.object({ kind: z.literal('table-reset') }),
  z.object({ kind: z.literal('table-resign') }),
  z.object({ kind: z.literal('chess-draw') }),
  z.object({
    kind: z.literal('chess-move'),
    from: z.string().regex(/^[a-h][1-8]$/),
    to: z.string().regex(/^[a-h][1-8]$/),
    promotion: z.enum(['q', 'r', 'b', 'n']).optional(),
  }),
  z.object({
    kind: z.literal('fleet-place'),
    cells: z.array(z.number().int().min(0).max(99)).length(20),
  }),
  z.object({ kind: z.literal('fleet-ready') }),
  z.object({ kind: z.literal('fleet-shot'), index: z.number().int().min(0).max(99) }),
  z.object({ kind: z.literal('quiz-vote'), answer: z.number().int().min(0).max(3) }),
  z.object({ kind: z.literal('quiz-answer'), answer: z.number().int().min(0).max(3) }),
  z.object({ kind: z.literal('quiz-next') }),
  z.object({ kind: z.literal('quiz-stop') }),
  z.object({ kind: z.literal('quiz-help'), help: z.enum(['half', 'audience', 'friend']) }),
  z.object({
    kind: z.literal('property'),
    action: z.enum([
      'roll',
      'buy',
      'pass',
      'end',
      'build',
      'sell-house',
      'mortgage',
      'bankrupt',
      'bid',
      'auction-pass',
      'jail-pay',
      'liquidate-group',
    ]),
    index: z.number().int().min(0).max(39).optional(),
  }),
  z.object({
    kind: z.literal('property-trade'),
    to: z.number().int().min(0).max(5),
    give: z.array(z.number().int().min(0).max(39)).max(28),
    want: z.array(z.number().int().min(0).max(39)).max(28),
    cash: z.number().int().min(-10000).max(10000),
  }),
  z.object({ kind: z.literal('property-trade-answer'), accept: z.boolean() }),
  z.object({
    kind: z.literal('poker-bet'),
    action: z.enum(['fold', 'check', 'call', 'raise']),
    amount: z.number().int().min(0).max(1000000).optional(),
  }),
  z.object({
    kind: z.literal('poker-config'),
    mode: z.enum(['classic', 'tournament', 'tournament-fixed']),
    ante: z.boolean(),
    ageConfirmed: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('table-bot'),
    seat: z.number().int().min(0).max(7),
    remove: z.boolean().optional(),
  }),
  z.object({ kind: z.literal('poker-next') }),
  z.object({ kind: z.literal('poker-break-vote'), breakId: id }),
  z.object({ kind: z.literal('poker-rebuy') }),
  z.object({ kind: z.literal('tablet-join'), joined: z.boolean() }),
  z.object({
    kind: z.literal('tablet-pointer'),
    surface: z.string().max(80),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    visible: z.boolean(),
  }),
]);
export type TableAction = z.infer<typeof tableActionSchema>;
export const activityPointerSchema = z.object({
  type: z.literal('activity-pointer'),
  participantId: id,
  surface: z.string().max(80),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  visible: z.boolean(),
});

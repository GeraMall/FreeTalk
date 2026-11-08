import { z } from 'zod';
import { tableSchema, tableActionSchema, tableKindSchema } from './activity-table.js';

export const activityRegionSchema = z.enum(['RU', 'KZ', 'GB']);
export const activityGameSchema = z.enum(['chess', 'mines', 'fleet']);
const cell = z.number().int().min(0).max(63);
const square = z.string().regex(/^[a-h][1-8]$/);

export const roomActivityActionSchema = z.union([
  tableActionSchema,
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('game-access') }),
    z.object({
      kind: z.literal('game-propose'),
      game: z.enum(['chess', 'mines', 'fleet', 'monopoly', 'millionaire', 'poker']),
    }),
    z.object({ kind: z.literal('game-vote'), id: z.string().uuid(), accept: z.boolean() }),
    z.object({ kind: z.literal('open') }),
    z.object({ kind: z.literal('close') }),
    z.object({ kind: z.literal('region'), region: activityRegionSchema }),
    z.object({ kind: z.literal('service'), service: z.string().regex(/^[a-z0-9-]{1,32}$/) }),
    z.object({ kind: z.literal('game'), game: activityGameSchema }),
    z.object({ kind: z.literal('cell'), index: cell, flag: z.boolean().optional() }),
    z.object({
      kind: z.literal('move'),
      from: square,
      to: square,
      promotion: z.enum(['q', 'r', 'b', 'n']).optional(),
    }),
  ]),
]);

export const gameSwitchVoteSchema = z.object({
  id: z.string().uuid(),
  game: z.enum(['chess', 'mines', 'fleet', 'monopoly', 'millionaire', 'poker']),
  from: z.union([tableKindSchema, z.literal('mines')]).optional(),
  requestedBy: z.string().uuid(),
  pokerFlow: z.literal(2).optional(),
  propertyRules: z.literal(2).optional(),
  electorate: z.array(z.string().uuid()).max(8),
  yes: z.array(z.string().uuid()).max(8),
  no: z.array(z.string().uuid()).max(8),
  deadline: z.number().int().nonnegative(),
  state: z.enum(['voting', 'accepted', 'rejected', 'expired']),
  finishedAt: z.number().int().nonnegative().optional(),
});
export const roomActivitySchema = z.object({
  revision: z.number().int().nonnegative(),
  sessionId: z.string().uuid().optional(),
  startedBy: z.string().uuid().optional(),
  open: z.boolean(),
  table: tableSchema.optional(),
  switchVote: gameSwitchVoteSchema.optional(),
  canPlayPoker: z.boolean().optional(),
  restrictedGame: z.literal('poker').optional(),
  viewers: z.array(z.string().uuid()).max(8).optional(),
  region: activityRegionSchema,
  service: z.string().max(32).optional(),
  game: z
    .discriminatedUnion('kind', [
      z.object({
        kind: z.literal('chess'),
        fen: z.string().max(128),
        check: z.boolean(),
        result: z.enum(['white', 'black', 'draw']).optional(),
      }),
      z.object({
        kind: z.enum(['mines', 'fleet']),
        cells: z.array(z.number().int().min(-2).max(10)).length(64),
        result: z.enum(['won', 'lost']).optional(),
      }),
    ])
    .optional(),
});

export type ActivityRegion = z.infer<typeof activityRegionSchema>;
export type ActivityGame = z.infer<typeof activityGameSchema>;
export type RoomActivityAction = z.infer<typeof roomActivityActionSchema>;
export type RoomActivity = z.infer<typeof roomActivitySchema>;

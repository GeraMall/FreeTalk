import { z } from 'zod';

export const activityRegionSchema = z.enum(['RU', 'KZ', 'GB']);
export const activityGameSchema = z.enum(['chess', 'mines', 'fleet']);
const cell = z.number().int().min(0).max(63);
const square = z.string().regex(/^[a-h][1-8]$/);

export const roomActivityActionSchema = z.discriminatedUnion('kind', [
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
]);

export const roomActivitySchema = z.object({
  revision: z.number().int().nonnegative(),
  sessionId: z.string().uuid().optional(),
  startedBy: z.string().uuid().optional(),
  open: z.boolean(),
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

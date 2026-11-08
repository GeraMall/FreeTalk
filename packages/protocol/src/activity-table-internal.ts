import type { DiceMotion, ActivityTable, TableAction } from './activity-table.js';
export interface QuizQuestion {
  q: string;
  a: [string, string, string, string];
  correct: number;
  difficulty: number;
}
export interface TableSession {
  view: ActivityTable;
  secret: {
    botSignature?: string;
    botNextAt?: number;
    botActing?: boolean;
    fleet?: number[][];
    deck?: string[];
    hands?: string[][];
    quiz?: QuizQuestion[];
    votes?: Record<string, number>;
    pokerStartingStacks?: number[];
  };
}
export type TableContext = {
  actorId: string;
  members: string[];
  now: number;
  voters?: string[];
  adultIds?: string[];
  pokerFlow?: 2;
  propertyRules?: 2;
  diceMotion?: DiceMotion;
  propertyRoll?: 2;
};
export type TableReducer = (
  session: TableSession,
  action: TableAction,
  context: TableContext,
) => TableSession;
export function randomInt(maximum: number) {
  const limit = 0x100000000 - (0x100000000 % maximum);
  const buffer = new Uint32Array(1);
  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0]! >= limit);
  return buffer[0]! % maximum;
}
export function shuffled<T>(values: readonly T[]): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
export function addLog<T extends ActivityTable>(view: T, text: string): T {
  return { ...view, log: [...view.log, text].slice(-80) };
}

import { describe, expect, it } from 'vitest';
import { createTable, reduceTable, tableView } from './activity-table-session.js';
import { roomActivityView, emptyRoomActivity } from './room-activity-session.js';
import { tableSchema, tableActionSchema } from './activity-table.js';

const members = Array.from(
  { length: 8 },
  (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
);
describe('eight-seat poker', () => {
  it('seats eight, deals unique private hands, and conserves 8000 chips at an eight-way showdown', () => {
    let now = 10000;
    let table = createTable('poker', { actorId: members[0]!, members, now }, 2, 8);
    for (let seat = 1; seat < 8; seat++)
      table = reduceTable(table, tableActionSchema.parse({ kind: 'table-seat', seat }), {
        actorId: members[seat]!,
        members,
        now,
      });
    table = reduceTable(table, { kind: 'table-start' }, { actorId: members[0]!, members, now });
    expect(table.view.seats).toEqual(members);
    expect(new Set(table.secret.hands!.flat()).size).toBe(16);
    for (const id of members) {
      const view = tableSchema.parse(tableView(table, id));
      if (view.kind !== 'poker') throw Error();
      expect(view.hands).toHaveLength(1);
      expect(view.hands[0]!.ownerId).toBe(id);
    }
    const legacy = roomActivityView({ ...emptyRoomActivity(), table }, members[0], true, false);
    expect(legacy.table).toBeUndefined();
    now += 3000;
    while (table.view.kind === 'poker' && table.view.stage !== 'showdown') {
      const v = table.view;
      table = reduceTable(
        table,
        { kind: 'poker-bet', action: v.bet === 1000 ? 'call' : 'raise', amount: 1000 },
        { actorId: v.seats[v.turn]!, members, now: now++ },
      );
    }
    if (table.view.kind !== 'poker') throw Error();
    expect(tableSchema.safeParse(table.view).success).toBe(true);
    expect(table.view.stacks.reduce((a, b) => a + b, 0)).toBe(8000);
    expect(table.view.stats!.every((s) => s.hands === 1)).toBe(true);
    const reset = reduceTable(
      table,
      { kind: 'table-reset' },
      { actorId: members[0]!, members, now },
    );
    expect(reset.view.seats).toHaveLength(8);
  });
  it('keeps six places for legacy tables and preserves new capacity after a two-player game', () => {
    const context = { actorId: members[0]!, members, now: 1000 };
    expect(createTable('poker', context, 2).view.seats).toHaveLength(6);
    expect(createTable('monopoly', context).view.seats).toHaveLength(6);
    let table = createTable('poker', context, 2, 8);
    table = reduceTable(
      table,
      { kind: 'table-seat', seat: 7 },
      { ...context, actorId: members[1]! },
    );
    table = reduceTable(table, { kind: 'table-start' }, context);
    expect(table.view.seats).toHaveLength(2);
    expect(reduceTable(table, { kind: 'table-reset' }, context).view.seats).toHaveLength(8);
  });
});

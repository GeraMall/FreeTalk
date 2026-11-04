import { describe, expect, it } from 'vitest';
import {
  applyRoomActivity,
  emptyRoomActivity,
  type RoomActivitySession,
} from './room-activity-session.js';
import { roomActivitySchema, type RoomActivityAction } from './room-activity.js';

function act(session: RoomActivitySession, action: RoomActivityAction) {
  return applyRoomActivity(session, session.view.revision, action);
}

describe('shared call tablet', () => {
  it('rejects stale changes and requires a service from the selected country', () => {
    const open = act(emptyRoomActivity(), { kind: 'open' });
    expect(applyRoomActivity(open, 0, { kind: 'close' })).toBe(open);
    expect(act(open, { kind: 'service', service: 'wolt' })).toBe(open);
    const region = act(open, { kind: 'region', region: 'KZ' });
    const selection = act(region, { kind: 'service', service: 'dodo-kz' });
    expect(selection.view).toMatchObject({ open: true, region: 'KZ', service: 'dodo-kz' });
    expect(act(selection, { kind: 'close' }).view.open).toBe(false);
  });

  it('validates chess turns and recognises checkmate', () => {
    let state = act(act(emptyRoomActivity(), { kind: 'open' }), { kind: 'game', game: 'chess' });
    expect(act(state, { kind: 'move', from: 'e7', to: 'e5' })).toBe(state);
    for (const [from, to] of [
      ['f2', 'f3'],
      ['e7', 'e5'],
      ['g2', 'g4'],
      ['d8', 'h4'],
    ] as const) {
      state = act(state, { kind: 'move', from, to });
    }
    expect(state.view.game).toMatchObject({ kind: 'chess', result: 'black', check: true });
    expect(act(state, { kind: 'move', from: 'e2', to: 'e4' })).toBe(state);
  });

  it('keeps layouts on the server and resolves a fleet victory', () => {
    const open = act(emptyRoomActivity(), { kind: 'open' });
    const mines = act(act(open, { kind: 'game', game: 'mines' }), { kind: 'cell', index: 0 });
    expect(mines.hidden).toHaveLength(9);
    expect(mines.hidden).not.toContain(0);
    expect(mines.view.game).toMatchObject({ kind: 'mines', cells: expect.arrayContaining([0]) });
    expect(roomActivitySchema.parse(mines.view)).not.toHaveProperty('hidden');
    const fleet = act(open, { kind: 'game', game: 'fleet' });
    expect(new Set(fleet.hidden).size).toBe(7);
    const won = fleet.hidden!.reduce((state, index) => act(state, { kind: 'cell', index }), fleet);
    expect(won.view.game).toMatchObject({ kind: 'fleet', result: 'won' });
  });
});

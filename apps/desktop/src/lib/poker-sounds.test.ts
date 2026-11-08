// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TableOf } from '@freetalk/protocol';
import { PokerSounds, PokerSoundTracker, pokerDealDelay } from './poker-sounds';
const table = (): TableOf<'poker'> => ({
  id: 'sound-table',
  kind: 'poker',
  pokerRules: 2,
  hostId: 'a',
  phase: 'playing',
  seats: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
  preset: 'standard',
  log: [],
  dealer: 0,
  smallBlind: 1,
  turn: 3,
  stage: 'preflop',
  board: [],
  pot: 30,
  bet: 20,
  minRaise: 20,
  stacks: Array(8).fill(1000),
  bets: Array(8).fill(0),
  contributions: Array(8).fill(0),
  folded: [],
  allIn: [],
  acted: [],
  hands: [],
  payouts: Array(8).fill(0),
  handNumber: 1,
  handStartedAt: 10000,
  turnAt: 12600,
  turnDeadline: 42600,
});
afterEach(() => vi.useRealTimers());
describe('local poker foley', () => {
  it('synchronizes sixteen card sounds inside the deal animation and ignores old snapshots', () => {
    const v = table();
    const tracker = new PokerSoundTracker();
    const events = tracker.update(v, 'a', 10000);
    expect(events.filter((e) => e.sound === 'deal')).toHaveLength(16);
    expect(events[0]!.sound).toBe('shuffle');
    expect(Math.max(...events.map((e) => e.at)) + 600).toBeLessThan(v.turnAt!);
    expect(tracker.update(v, 'a', 10250)).toEqual([]);
    expect(new PokerSoundTracker().update(v, 'a', 20000)).toEqual([]);
    expect(pokerDealDelay(v, 0, 1)).toBeGreaterThan(pokerDealDelay(v, 1, 0));
  });
  it('plays knocks and chips for accepted actions once, with a distinct all-in accent', () => {
    const tracker = new PokerSoundTracker(),
      v = table();
    tracker.update(v, 'a', 15000);
    const check = {
      ...v,
      lastAction: { seat: 3, kind: 'check' as const, amount: 0, at: 16000, sequence: 1 },
    };
    expect(tracker.update(check, 'a', 16000).map((e) => e.sound)).toEqual(['check']);
    expect(tracker.update(check, 'a', 16250)).toEqual([]);
    const raise = {
      ...check,
      allIn: [3],
      lastAction: { seat: 3, kind: 'raise' as const, amount: 1000, at: 17000, sequence: 2 },
    };
    expect(tracker.update(raise, 'a', 17000).map((e) => e.sound)).toEqual(['all-in']);
    const call = {
      ...raise,
      lastAction: { seat: 4, kind: 'call' as const, amount: 20, at: 18000, sequence: 3 },
    };
    expect(tracker.update(call, 'a', 18000).map((e) => e.sound)).toEqual(['chips']);
    expect(new PokerSoundTracker().update(call, 'a', 18000)).toEqual([]);
  });
  it('signals a new own turn and five seconds once, never at every timer tick', () => {
    const tracker = new PokerSoundTracker(),
      v = table();
    tracker.update(v, 'a', 15000);
    const turn = { ...v, turn: 0, turnAt: 16000, turnDeadline: 46000 };
    expect(tracker.update(turn, 'a', 16000).map((e) => e.sound)).toEqual(['turn']);
    expect(tracker.update(turn, 'a', 41000).map((e) => e.sound)).toEqual(['warning']);
    expect(tracker.update(turn, 'a', 42000)).toEqual([]);
  });
  it('cancels pending sounds on leaving or muting and deduplicates across remounts', () => {
    vi.useFakeTimers();
    const audio = vi.spyOn(window, 'Audio');
    const player = new PokerSounds();
    const event = { key: 'unique-cancel', sound: 'chips' as const, at: Date.now() + 500 };
    player.schedule(event);
    player.stop();
    vi.advanceTimersByTime(1000);
    const second = new PokerSounds();
    second.schedule(event);
    second.enabled = false;
    second.schedule({ ...event, key: 'unique-disabled' });
    vi.runAllTimers();
    expect(audio).not.toHaveBeenCalled();
    audio.mockRestore();
  });
});

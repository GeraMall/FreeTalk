import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/db.js', () => ({ db: {}, transaction: vi.fn() }));
vi.mock('../src/env.js', () => ({ env: {} }));
vi.mock('../src/social-routes.js', () => ({ publishChatEvent: vi.fn() }));
import { MissingCallTracker } from '../src/call-reconciliation.js';

describe('lost call end reconciliation', () => {
  it('ends orphaned group calls only after repeated confirmed absence', () => {
    const tracker = new MissingCallTracker();
    expect(tracker.observe(['group'], new Set(), 0)).toEqual([]);
    expect(tracker.observe(['group'], new Set(), 30_000)).toEqual([]);
    expect(tracker.observe(['group'], new Set(), 60_000)).toEqual(['group']);
  });
  it('never expires a live call even after many days', () => {
    const tracker = new MissingCallTracker();
    expect(tracker.observe(['group'], new Set(['group']), 0)).toEqual([]);
    expect(tracker.observe(['group'], new Set(['group']), 999_999_999)).toEqual([]);
  });
  it('allows reconnection and restarts the grace period after snapshot failure', () => {
    const tracker = new MissingCallTracker();
    tracker.observe(['room'], new Set(), 0);
    expect(tracker.observe(['room'], new Set(['room']), 60_000)).toEqual([]);
    expect(tracker.observe(['room'], new Set(), 90_000)).toEqual([]);
    tracker.reset();
    expect(tracker.observe(['room'], new Set(), 180_000)).toEqual([]);
    expect(tracker.observe(['room'], new Set(), 240_000)).toEqual(['room']);
  });
});

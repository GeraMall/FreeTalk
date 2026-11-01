import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/db.js', () => ({ db: { query: vi.fn() }, transaction: vi.fn() }));
vi.mock('../src/env.js', () => ({ env: {} }));
vi.mock('../src/social-routes.js', () => ({ publishChatEvent: vi.fn() }));
import { MissingCallTracker, startCallReconciliation } from '../src/call-reconciliation.js';
import { db, transaction } from '../src/db.js';
import { publishChatEvent } from '../src/social-routes.js';

describe('lost call end reconciliation', () => {
  it('retires a failed setup card even when signaling never created a call session', async () => {
    vi.useFakeTimers();
    const failedCard = { id: 'message', chat_id: 'chat', metadata: { ended: true } };
    vi.mocked(db.query).mockResolvedValue({ rows: [{ room_id: 'failed-setup' }] } as never);
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [failedCard] });
    vi.mocked(transaction).mockImplementation(async (callback) => callback({ query } as never));
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json({ roomIds: [] }));
    const logError = vi.fn();
    const stop = startCallReconciliation(logError);
    try {
      await vi.advanceTimersByTimeAsync(30_000);
      expect(publishChatEvent).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(publishChatEvent).toHaveBeenCalledWith('chat', {
        type: 'message-updated',
        chatId: 'chat',
        messageId: 'message',
        metadata: { ended: true },
      });
      expect(logError).not.toHaveBeenCalled();
    } finally {
      stop();
      fetchMock.mockRestore();
      vi.useRealTimers();
      vi.clearAllMocks();
    }
  });

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

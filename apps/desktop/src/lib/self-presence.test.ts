// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SELF_PRESENCE_RECONNECT_GRACE_MS, SelfPresenceTracker } from './self-presence';

describe('self presence across account subscriptions', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps a working account online when one subscription closes or unmounts', () => {
    const changed = vi.fn();
    const tracker = new SelfPresenceTracker(changed);
    const sidebar = vi.fn();
    const first = tracker.subscribe('user', sidebar);
    const second = tracker.subscribe('user');
    first.ready('online');
    second.ready('online');
    changed.mockClear();
    first.disconnected();
    vi.advanceTimersByTime(30_000);
    first.stop();
    expect(tracker.get('user')).toBe('online');
    expect(sidebar).toHaveBeenLastCalledWith('online');
    expect(changed).not.toHaveBeenCalled();
    second.stop();
  });

  it('does not flash offline during a brief reconnect, but does report an actual outage', () => {
    const listener = vi.fn();
    const tracker = new SelfPresenceTracker(vi.fn());
    const peer = tracker.subscribe('user', listener);
    peer.ready('online');
    listener.mockClear();
    peer.disconnected();
    vi.advanceTimersByTime(1_000);
    peer.ready('online');
    vi.advanceTimersByTime(SELF_PRESENCE_RECONNECT_GRACE_MS);
    expect(listener).not.toHaveBeenCalled();
    peer.disconnected();
    vi.advanceTimersByTime(SELF_PRESENCE_RECONNECT_GRACE_MS - 1);
    expect(tracker.get('user')).toBe('online');
    vi.advanceTimersByTime(1);
    expect(tracker.get('user')).toBe('offline');
    peer.ready('online');
    expect(listener).toHaveBeenLastCalledWith('online');
    peer.stop();
  });

  it('restores a new panel from the existing account snapshot', () => {
    const tracker = new SelfPresenceTracker(vi.fn());
    const app = tracker.subscribe('user');
    app.ready('away');
    const listener = vi.fn();
    const sidebar = tracker.subscribe('user', listener);
    expect(listener).toHaveBeenCalledWith('away');
    expect(tracker.get('user')).toBe('away');
    sidebar.stop();
    app.stop();
  });

  it('applies invisible immediately and clears status immediately on final logout', () => {
    const tracker = new SelfPresenceTracker(vi.fn());
    const listener = vi.fn();
    const peer = tracker.subscribe('user', listener);
    peer.ready('online');
    peer.ready('offline');
    expect(tracker.get('user')).toBe('offline');
    peer.ready('dnd');
    peer.disconnected();
    peer.stop();
    expect(tracker.get('user')).toBe('offline');
    expect(listener).toHaveBeenLastCalledWith('offline');
    vi.advanceTimersByTime(30_000);
    expect(tracker.get('user')).toBe('offline');
  });

  it('keeps accounts isolated and uses the same priority as the server', () => {
    const tracker = new SelfPresenceTracker(vi.fn());
    const a = tracker.subscribe('a');
    const b = tracker.subscribe('b');
    const a2 = tracker.subscribe('a');
    a.ready('away');
    b.ready('dnd');
    a2.ready('online');
    expect(tracker.get('a')).toBe('online');
    expect(tracker.get('b')).toBe('dnd');
    a2.stop();
    expect(tracker.get('a')).toBe('away');
    a.stop();
    expect(tracker.get('b')).toBe('dnd');
    b.stop();
  });
});

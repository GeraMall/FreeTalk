import { describe, expect, it, vi } from 'vitest';
import type { RoomActivity, RoomActivityAction, ServerMessage } from '@freetalk/protocol';
import { RoomManager, type PeerConnection } from '../src/room-manager.js';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
class Connection implements PeerConnection {
  canUseActivity = true;
  activityVersion: 2 | undefined = 2;
  messages: ServerMessage[] = [];
  send(message: ServerMessage) {
    this.messages.push(message);
  }
  close() {}
  get activity(): RoomActivity {
    const m = [...this.messages]
      .reverse()
      .find((m) => m.type === 'activity-state' || m.type === 'joined-room');
    if (!m || !('activity' in m) || !m.activity) throw Error('Missing activity');
    return m.activity;
  }
}
describe('private table projections and pointers', () => {
  it('isolates hole cards in updates and rejoin snapshots while preserving old clients', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100000);
    try {
      const manager = new RoomManager(),
        a = new Connection(),
        b = new Connection(),
        watcher = new Connection(),
        legacy = new Connection();
      legacy.activityVersion = undefined;
      manager.create('ABCDEFGH2345', id(1), 'session-123456789', 'Host', a);
      manager.join('ABCDEFGH2345', id(2), 'session-223456789', 'Peer', b);
      manager.join('ABCDEFGH2345', id(3), 'session-323456789', 'Watch', watcher);
      manager.join('ABCDEFGH2345', id(4), 'session-423456789', 'Old', legacy);
      const send = (actor: number, connection: Connection, action: RoomActivityAction) => {
        vi.advanceTimersByTime(160);
        manager.updateActivity('ABCDEFGH2345', id(actor), connection.activity.revision, action);
      };
      send(1, a, { kind: 'open' });
      send(1, a, { kind: 'table-open', game: 'poker' });
      send(2, b, { kind: 'table-seat', seat: 1 });
      send(1, a, { kind: 'table-start' });
      expect(a.activity.table).toMatchObject({
        kind: 'poker',
        hands: [{ ownerId: id(1), cards: expect.any(Array) }],
      });
      expect(b.activity.table).toMatchObject({
        hands: [{ ownerId: id(2), cards: expect.any(Array) }],
      });
      expect(watcher.activity.table).toMatchObject({ hands: [] });
      expect(legacy.activity.table).toBeUndefined();
      const revision = a.activity.revision;
      send(4, legacy, { kind: 'game', game: 'chess' });
      expect(a.activity.revision).toBe(revision);
      const reconnect = new Connection();
      manager.leave('ABCDEFGH2345', id(2), b);
      expect(() =>
        manager.join('ABCDEFGH2345', id(2), 'attacker-session-12345', 'Impostor', new Connection()),
      ).toThrow();
      manager.join('ABCDEFGH2345', id(2), 'session-223456789', 'Peer', reconnect);
      expect(reconnect.activity.table).toEqual(b.activity.table);
      const t = a.activity.table;
      if (!t) throw Error();
      send(1, a, { kind: 'tablet-join', joined: true });
      send(3, watcher, { kind: 'tablet-join', joined: true });
      send(1, a, {
        kind: 'tablet-pointer',
        surface: t.id + ':tablet',
        x: 0.5,
        y: 0.5,
        visible: true,
      });
      expect(watcher.messages.some((m) => m.type === 'activity-pointer')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
  it('sends pointers only to tablet viewers, throttles them separately from moves and removes presence on leave', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100000);
    try {
      const manager = new RoomManager(),
        a = new Connection(),
        b = new Connection(),
        outside = new Connection();
      manager.create('ABCDEFGH2345', id(1), 'session-123456789', 'Host', a);
      manager.join('ABCDEFGH2345', id(2), 'session-223456789', 'Peer', b);
      manager.join('ABCDEFGH2345', id(3), 'session-323456789', 'Outside', outside);
      manager.updateActivity('ABCDEFGH2345', id(1), 0, { kind: 'open' });
      manager.updateActivity('ABCDEFGH2345', id(1), 1, { kind: 'tablet-join', joined: true });
      manager.updateActivity('ABCDEFGH2345', id(2), 1, { kind: 'tablet-join', joined: true });
      const move = {
        kind: 'tablet-pointer' as const,
        surface: 'catalog:catalog',
        x: 0.2,
        y: 0.5,
        visible: true,
      };
      manager.updateActivity('ABCDEFGH2345', id(1), 1, move);
      manager.updateActivity('ABCDEFGH2345', id(1), 1, move);
      expect(b.messages.filter((m) => m.type === 'activity-pointer')).toHaveLength(1);
      expect(outside.messages.filter((m) => m.type === 'activity-pointer')).toHaveLength(0);
      expect(a.activity.revision).toBe(1);
      manager.leave('ABCDEFGH2345', id(2));
      expect(a.activity.viewers).toEqual([id(1)]);
    } finally {
      vi.useRealTimers();
    }
  });
});

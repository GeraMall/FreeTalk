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
  it('negotiates eight seats without sending oversized snapshots to an older client', () => {
    const manager = new RoomManager();
    const host = Object.assign(new Connection(), { pokerSeats: 8 as const });
    const old = new Connection();
    manager.create('ABCDEFGH2345', id(1), 'session-123456789', 'Host', host);
    manager.join('ABCDEFGH2345', id(2), 'session-223456789', 'Older', old);
    const send = (action: RoomActivityAction) =>
      manager.updateActivity('ABCDEFGH2345', id(1), host.activity.revision, action);
    send({ kind: 'open' });
    send({ kind: 'table-open', game: 'poker', pokerRules: 2, pokerSeats: 8 });
    expect(host.activity.table?.seats).toHaveLength(8);
    expect(old.activity.table).toBeUndefined();
    manager.updateActivity('ABCDEFGH2345', id(2), old.activity.revision, {
      kind: 'table-seat',
      seat: 7,
    });
    expect(host.activity.table?.seats[7]).toBeNull();
    const upgraded = Object.assign(new Connection(), { pokerSeats: 8 as const });
    manager.join('ABCDEFGH2345', id(2), 'session-223456789', 'Upgraded', upgraded);
    expect(upgraded.activity.table?.seats).toHaveLength(8);
    manager.updateActivity('ABCDEFGH2345', id(2), upgraded.activity.revision, {
      kind: 'table-seat',
      seat: 7,
    });
    expect(host.activity.table?.seats[7]).toBe(id(2));
  });
  it('ticks advanced poker only at the deadline and keeps all timeout snapshots private', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100000);
    try {
      const manager = new RoomManager(),
        peers = Array.from({ length: 4 }, () => new Connection());
      manager.create('ABCDEFGH2345', id(1), 'session-123456789', 'Host', peers[0]!);
      for (let i = 1; i < 4; i++)
        manager.join('ABCDEFGH2345', id(i + 1), `session-${i}23456789`, 'Peer', peers[i]!);
      const send = (i: number, action: RoomActivityAction) =>
        manager.updateActivity('ABCDEFGH2345', id(i + 1), peers[i]!.activity.revision, action);
      send(0, { kind: 'open' });
      send(0, { kind: 'table-open', game: 'poker', pokerRules: 2 });
      for (let i = 1; i < 4; i++) send(i, { kind: 'table-seat', seat: i });
      send(0, { kind: 'table-start' });
      const table = peers[0]!.activity.table;
      if (table?.kind !== 'poker') throw Error();
      const before = peers.map((p) => p.messages.length);
      manager.tickActivities(table.turnDeadline! - 1);
      expect(peers.map((p) => p.messages.length)).toEqual(before);
      manager.tickActivities(table.turnDeadline!);
      for (let i = 0; i < 4; i++) {
        expect(peers[i]!.activity.table).toMatchObject({
          lastAction: { kind: 'timeout' },
          hands: [{ ownerId: id(i + 1), cards: expect.any(Array) }],
        });
        expect(peers[i]!.messages.length).toBe(before[i]! + 1);
      }
    } finally {
      vi.useRealTimers();
    }
  });
  it('repairs stale actions using only the requesting player private snapshot and limits retries', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100000);
    try {
      const manager = new RoomManager();
      const connections = Array.from({ length: 4 }, () => new Connection());
      manager.create('ABCDEFGH2345', id(1), 'session-123456789', 'Host', connections[0]!);
      for (let i = 1; i < 4; i++)
        manager.join('ABCDEFGH2345', id(i + 1), `session-${i}23456789`, 'Peer', connections[i]!);
      const send = (actor: number, action: RoomActivityAction) =>
        manager.updateActivity(
          'ABCDEFGH2345',
          id(actor + 1),
          connections[actor]!.activity.revision,
          action,
        );
      send(0, { kind: 'open' });
      send(0, { kind: 'table-open', game: 'poker' });
      for (let i = 1; i < 4; i++) send(i, { kind: 'table-seat', seat: i });
      send(0, { kind: 'table-start' });
      const counts = connections.map((c) => c.messages.length);
      const revision = connections[1]!.activity.revision;
      manager.updateActivity('ABCDEFGH2345', id(2), revision - 1, {
        kind: 'poker-bet',
        action: 'call',
      });
      expect(connections[1]!.messages.length).toBe(counts[1]! + 1);
      expect(connections[1]!.activity.revision).toBe(revision);
      expect(connections[1]!.activity.table).toMatchObject({
        hands: [{ ownerId: id(2), cards: expect.any(Array) }],
      });
      for (const i of [0, 2, 3]) expect(connections[i]!.messages.length).toBe(counts[i]);
      manager.updateActivity('ABCDEFGH2345', id(2), revision - 1, {
        kind: 'poker-bet',
        action: 'call',
      });
      expect(connections[1]!.messages.length).toBe(counts[1]! + 1);
      vi.advanceTimersByTime(250);
      manager.updateActivity('ABCDEFGH2345', id(2), revision - 1, {
        kind: 'poker-bet',
        action: 'call',
      });
      expect(connections[1]!.messages.length).toBe(counts[1]! + 2);
    } finally {
      vi.useRealTimers();
    }
  });
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

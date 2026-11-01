import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { RoomManager, type PeerConnection } from '../src/room-manager.js';
import { RoomCluster } from '../src/room-cluster.js';
import { ClusterStore, ClusterUnavailable } from '../src/cluster-store.js';
const room = 'ABCDEFGH2345';
const connection = (): PeerConnection => ({ send: vi.fn(), close: vi.fn() });
describe('durable room recovery', () => {
  it('cannot acknowledge an in-flight save after the node has been fenced', async () => {
    const manager = new RoomManager();
    let release!: () => void;
    const store = {
      node: { leaseMs: 15_000 },
      acquire: vi.fn().mockResolvedValue({ epoch: '1', snapshot: null }),
      save: vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      ),
    } as unknown as ClusterStore;
    const cluster = new RoomCluster(store, manager),
      send = vi.fn(),
      closed = vi.fn();
    const pending = cluster.run(room, true, () =>
      manager.create(room, randomUUID(), 'long-session-secret', 'Owner', {
        send: (message) => cluster.deliver(room, () => send(message)),
        close: () => cluster.deliver(room, closed),
      }),
    );
    await vi.waitFor(() => expect(store.save).toHaveBeenCalled());
    await cluster.stop();
    expect(closed).toHaveBeenCalled();
    release();
    await expect(pending).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
  it('restores owner, mute, history and session identity without leaking a session secret', () => {
    const a = new RoomManager(),
      b = new RoomManager();
    const owner = randomUUID(),
      friend = randomUUID(),
      account = randomUUID(),
      otherAccount = randomUUID();
    a.create(room, owner, 'private-session-owner', 'Owner', connection(), undefined, account);
    a.join(room, friend, 'private-session-friend', 'Friend', connection(), undefined, otherAccount);
    a.setMuted(room, owner, true);
    a.chat(room, owner, randomUUID(), 'Message before failure');
    const snapshot = a.snapshot(room)!;
    expect(JSON.stringify(snapshot)).not.toContain('private-session');
    b.restore(snapshot);
    const friendConnection = connection();
    expect(() =>
      b.join(room, owner, 'wrong-session-secret', 'Intruder', connection(), undefined, account),
    ).toThrow();
    expect(() =>
      b.join(
        room,
        owner,
        'private-session-owner',
        'Intruder',
        connection(),
        undefined,
        otherAccount,
      ),
    ).toThrow();
    b.join(
      room,
      friend,
      'private-session-friend',
      'Friend',
      friendConnection,
      undefined,
      otherAccount,
    );
    expect(friendConnection.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'joined-room',
        participants: [expect.objectContaining({ id: friend })],
        roomStartedAt: snapshot.createdAt,
      }),
    );
    const ownerConnection = connection();
    b.join(room, owner, 'private-session-owner', 'Owner', ownerConnection, undefined, account);
    expect(friendConnection.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'participant-joined',
        participant: expect.objectContaining({ id: owner, muted: true, isOwner: true }),
      }),
    );
    expect(b.snapshot(room)?.chatMessages[0]?.text).toBe('Message before failure');
  });
  it('does not acknowledge a mutation when durable persistence fails', async () => {
    const manager = new RoomManager();
    const store = {
      node: { leaseMs: 15_000 },
      acquire: vi.fn().mockResolvedValue({ epoch: '1', snapshot: null }),
      save: vi.fn().mockRejectedValue(new ClusterUnavailable('database lost')),
    } as unknown as ClusterStore;
    const cluster = new RoomCluster(store, manager);
    const send = vi.fn();
    await expect(
      cluster.run(room, true, () => {
        manager.create(room, randomUUID(), 'test-session-12345', 'Owner', {
          send: (m) => cluster.deliver(room, () => send(m)),
          close: () => {},
        });
      }),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(manager.hasRoom(room)).toBe(false);
  });
});

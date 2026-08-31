import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '@freetalk/protocol';
import { RoomError, RoomManager, type PeerConnection } from '../src/room-manager.js';

class FakeConnection implements PeerConnection {
  messages: ServerMessage[] = [];
  closed = false;
  send(message: ServerMessage) {
    this.messages.push(message);
  }
  close() {
    this.closed = true;
  }
}

const room = 'ABCDEFGH2345';
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

describe('RoomManager', () => {
  it('creates, joins and relays without storing media', () => {
    const manager = new RoomManager();
    const first = new FakeConnection();
    const second = new FakeConnection();
    manager.create(room, id(1), 'session-123456789', 'One', first);
    manager.join(room, id(2), 'session-223456789', 'Two', second);
    expect(manager.roomSize(room)).toBe(2);
    expect(
      manager.relay(room, id(1), id(2), {
        type: 'offer',
        from: id(1),
        description: { type: 'offer', sdp: 'v=0' },
      }),
    ).toBe(true);
    expect(second.messages.at(-1)?.type).toBe('offer');
  });

  it('enforces the eight participant limit', () => {
    const manager = new RoomManager();
    manager.create(room, id(1), 'session-123456789', 'One', new FakeConnection());
    for (let n = 2; n <= 8; n++)
      manager.join(room, id(n), `session-${n}23456789`, `P${n}`, new FakeConnection());
    expect(() =>
      manager.join(room, id(9), 'session-923456789', 'Nine', new FakeConnection()),
    ).toThrow(RoomError);
  });

  it('deletes an empty room', () => {
    const manager = new RoomManager();
    const connection = new FakeConnection();
    manager.create(room, id(1), 'session-123456789', 'One', connection);
    manager.leave(room, id(1), connection);
    expect(manager.hasRoom(room)).toBe(false);
  });

  it('replaces the same session during reconnect and ignores the stale close', () => {
    const manager = new RoomManager();
    const oldConnection = new FakeConnection();
    const newConnection = new FakeConnection();
    manager.create(room, id(1), 'session-123456789', 'One', oldConnection);
    manager.join(room, id(1), 'session-123456789', 'One', newConnection);
    expect(oldConnection.closed).toBe(true);
    expect(manager.leave(room, id(1), oldConnection)).toBe(false);
    expect(manager.roomSize(room)).toBe(1);
  });

  it('allows only the owner to force-mute another participant', () => {
    const manager = new RoomManager();
    const owner = new FakeConnection();
    const member = new FakeConnection();
    manager.create(room, id(1), 'session-123456789', 'Owner', owner);
    manager.join(room, id(2), 'session-223456789', 'Member', member);

    expect(manager.moderationMute(room, id(2), id(1))).toBe('NOT_OWNER');
    expect(manager.moderationMute(room, id(1), id(2))).toBe('OK');
    expect(member.messages.some((message) => message.type === 'force-mute')).toBe(true);
    expect(
      owner.messages.some(
        (message) =>
          message.type === 'mute-changed' && message.participantId === id(2) && message.muted,
      ),
    ).toBe(true);
  });

  it('assigns ownership to the earliest remaining participant', () => {
    const manager = new RoomManager();
    const owner = new FakeConnection();
    const second = new FakeConnection();
    manager.create(room, id(1), 'session-123456789', 'Owner', owner);
    manager.join(room, id(2), 'session-223456789', 'Second', second);
    manager.leave(room, id(1), owner);
    expect(
      second.messages.some(
        (message) => message.type === 'owner-changed' && message.ownerId === id(2),
      ),
    ).toBe(true);
    expect(manager.moderationMute(room, id(2), id(1))).toBe('TARGET_NOT_FOUND');
  });

  it('keeps heartbeat-active participants and removes only stale peers', () => {
    const manager = new RoomManager();
    const owner = new FakeConnection();
    const member = new FakeConnection();
    manager.create(room, id(1), 'session-123456789', 'Owner', owner);
    manager.join(room, id(2), 'session-223456789', 'Member', member);

    manager.touch(room, id(1), 50_000);
    manager.touch(room, id(2), 50_000);
    manager.removeStale(45_000, 90_000);

    expect(manager.roomSize(room)).toBe(2);
    expect(owner.closed).toBe(false);
    expect(member.closed).toBe(false);
  });

  it('transfers ownership when only the owner is stale', () => {
    const manager = new RoomManager();
    const owner = new FakeConnection();
    const member = new FakeConnection();
    manager.create(room, id(1), 'session-123456789', 'Owner', owner);
    manager.join(room, id(2), 'session-223456789', 'Member', member);

    manager.touch(room, id(1), 1_000);
    manager.touch(room, id(2), 50_000);
    manager.removeStale(45_000, 90_000);

    expect(manager.roomSize(room)).toBe(1);
    expect(owner.closed).toBe(true);
    expect(member.closed).toBe(false);
    expect(
      member.messages.some(
        (message) => message.type === 'owner-changed' && message.ownerId === id(2),
      ),
    ).toBe(true);
  });

  it('broadcasts profile changes and limits them to five per five hours', () => {
    const manager = new RoomManager();
    const owner = new FakeConnection();
    const member = new FakeConnection();
    manager.create(room, id(1), 'session-123456789', 'Owner', owner);
    manager.join(room, id(2), 'session-223456789', 'Member', member);
    expect(manager.updateProfile(room, id(2), 'Member 1', undefined, 1_000)).toBe('OK');
    expect(manager.updateProfile(room, id(2), 'Member 2', undefined, 2_000)).toBe('OK');
    expect(manager.updateProfile(room, id(2), 'Member 3', undefined, 3_000)).toBe('OK');
    expect(manager.updateProfile(room, id(2), 'Member 4', undefined, 4_000)).toBe('OK');
    expect(manager.updateProfile(room, id(2), 'Member 5', undefined, 5_000)).toBe('OK');
    expect(manager.updateProfile(room, id(2), 'Member 6', undefined, 6_000)).toBe('RATE_LIMITED');
    expect(
      owner.messages.some(
        (message) =>
          message.type === 'participant-updated' && message.participant.name === 'Member 5',
      ),
    ).toBe(true);
  });

  it('broadcasts reactions but throttles rapid repeats', () => {
    const manager = new RoomManager();
    const owner = new FakeConnection();
    manager.create(room, id(1), 'session-123456789', 'Owner', owner);
    expect(manager.react(room, id(1), id(8), '🎉', 1_000)).toBe(true);
    expect(manager.react(room, id(1), id(9), '🔥', 1_200)).toBe(false);
    expect(owner.messages.some((message) => message.type === 'reaction')).toBe(true);
  });

  it('broadcasts recording starts only when announced by the owner', () => {
    const manager = new RoomManager();
    const owner = new FakeConnection();
    const member = new FakeConnection();
    manager.create(room, id(1), 'session-123456789', 'Owner', owner);
    manager.join(room, id(2), 'session-223456789', 'Member', member);

    expect(manager.recordingStarted(room, id(2), 12_000)).toBe('NOT_OWNER');
    expect(manager.recordingStarted(room, id(1), 12_345)).toBe('OK');
    expect(member.messages.at(-1)).toEqual({
      type: 'recording-started',
      participantId: id(1),
      participantName: 'Owner',
      timestamp: 12_345,
    });
  });

  it('broadcasts room chat in realtime and includes its history for late joiners', () => {
    const manager = new RoomManager();
    const owner = new FakeConnection();
    const member = new FakeConnection();
    manager.create(room, id(1), 'session-123456789', 'Owner', owner);
    expect(manager.chat(room, id(1), id(8), 'Привет', 12_345)).toBe(true);
    expect(
      owner.messages.some(
        (message) =>
          message.type === 'room-chat-message' &&
          message.message.senderName === 'Owner' &&
          message.message.text === 'Привет',
      ),
    ).toBe(true);

    manager.join(room, id(2), 'session-223456789', 'Member', member);
    const joined = member.messages.find((message) => message.type === 'joined-room');
    expect(joined?.type === 'joined-room' ? joined.roomChatMessages : []).toHaveLength(1);
  });

  it('clears ephemeral room chat when the last participant leaves', () => {
    const manager = new RoomManager();
    const first = new FakeConnection();
    manager.create(room, id(1), 'session-123456789', 'Owner', first);
    manager.chat(room, id(1), id(8), 'Не должно сохраниться');
    manager.leave(room, id(1), first);

    const replacement = new FakeConnection();
    manager.create(room, id(2), 'session-223456789', 'New owner', replacement);
    const joined = replacement.messages.find((message) => message.type === 'joined-room');
    expect(joined?.type === 'joined-room' ? joined.roomChatMessages : []).toEqual([]);
  });

  it('keeps only the latest 200 room chat messages', () => {
    const manager = new RoomManager();
    const owner = new FakeConnection();
    manager.create(room, id(1), 'session-123456789', 'Owner', owner);
    for (let index = 1; index <= 205; index += 1)
      manager.chat(room, id(1), id(1_000 + index), `Message ${index}`, index);
    const late = new FakeConnection();
    manager.join(room, id(2), 'session-223456789', 'Late', late);
    const joined = late.messages.find((message) => message.type === 'joined-room');
    const history = joined?.type === 'joined-room' ? (joined.roomChatMessages ?? []) : [];
    expect(history).toHaveLength(200);
    expect(history[0]?.text).toBe('Message 6');
    expect(history.at(-1)?.text).toBe('Message 205');
  });
});

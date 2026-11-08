import { expect, it } from 'vitest';
import type { ServerMessage } from '@freetalk/protocol';
import { RoomManager, type PeerConnection } from '../src/room-manager.js';
class Connection implements PeerConnection {
  messages: ServerMessage[] = [];
  send(message: ServerMessage) {
    this.messages.push(structuredClone(message));
  }
  close() {}
}
const room = 'ABCDEFGH2345';
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
function setup() {
  const manager = new RoomManager(),
    host = new Connection(),
    guest = new Connection();
  manager.create(room, id(1), 'session-123456789', 'Host', host);
  manager.join(room, id(2), 'session-223456789', 'Guest', guest);
  manager.chat(room, id(1), id(10), 'Hello', 1000);
  return { manager, host, guest };
}
it('allows shared reactions and replies but protects edits and deletion', () => {
  const { manager, host } = setup();
  expect(manager.chatAction(room, id(2), { kind: 'edit', id: id(10), text: 'forged' })).toBe(false);
  expect(manager.chatAction(room, id(2), { kind: 'delete', id: id(10) })).toBe(false);
  expect(manager.chatAction(room, id(1), { kind: 'edit', id: id(10), text: 'Edited' }, 2000)).toBe(
    true,
  );
  expect(host.messages.at(-1)).toMatchObject({
    type: 'room-chat-updated',
    message: { text: 'Edited', editedAt: 2000 },
  });
  manager.chatAction(room, id(2), { kind: 'react', id: id(10), emoji: '❤️' });
  expect(host.messages.at(-1)).toMatchObject({
    message: { reactions: [{ emoji: '❤️', userIds: [id(2)] }] },
  });
  manager.chatAction(room, id(2), { kind: 'react', id: id(10), emoji: '❤️' });
  expect(host.messages.at(-1)).toMatchObject({ message: { reactions: [] } });
  manager.chat(room, id(2), id(11), 'Reply', 3000, undefined, id(10));
  expect(host.messages.at(-1)).toMatchObject({ message: { replyTo: id(10) } });
  manager.chatAction(room, id(1), { kind: 'delete', id: id(10) });
  expect(host.messages.at(-1)).toMatchObject({
    message: { deleted: true, reactions: [], pinned: false },
  });
  expect(manager.chatAction(room, id(2), { kind: 'react', id: id(10), emoji: '❤️' })).toBe(false);
});
it('records the first view once, reveals readers only to the author, including on rejoin', () => {
  const { manager, host, guest } = setup();
  const count = guest.messages.length;
  manager.chatAction(room, id(2), { kind: 'read', ids: [id(10)] }, 3000);
  expect(guest.messages).toHaveLength(count);
  expect(host.messages.at(-1)).toMatchObject({
    message: { readers: [{ id: id(2), name: 'Guest', readAt: 3000 }] },
  });
  const previous = host.messages.length;
  manager.chatAction(room, id(2), { kind: 'read', ids: [id(10)] }, 8000);
  expect(host.messages).toHaveLength(previous);
  manager.chatAction(room, id(1), { kind: 'pin', id: id(10), pinned: true });
  expect(
    (guest.messages.at(-1) as { message: { readers?: unknown } }).message.readers,
  ).toBeUndefined();
  const late = new Connection();
  manager.join(room, id(3), 'session-323456789', 'Late', late);
  const joined = late.messages.find((m) => m.type === 'joined-room');
  if (joined?.type !== 'joined-room') throw Error('Missing snapshot');
  expect(joined.roomChatVersion).toBe(2);
  expect(joined.roomChatMessages?.[0]?.readers).toBeUndefined();
});
it('throttles typing, accepts immediate stop and ignores actions from nonmembers', () => {
  const { manager, host } = setup();
  expect(manager.chatAction(room, id(2), { kind: 'typing', active: true }, 3000)).toBe(true);
  expect(host.messages.at(-1)).toEqual({
    type: 'room-chat-typing',
    participantId: id(2),
    name: 'Guest',
    expiresAt: 8000,
  });
  expect(manager.chatAction(room, id(2), { kind: 'typing', active: true }, 3500)).toBe(false);
  expect(manager.chatAction(room, id(2), { kind: 'typing', active: false }, 3500)).toBe(true);
  expect(host.messages.at(-1)).toMatchObject({ expiresAt: 0 });
  expect(manager.chatAction(room, id(9), { kind: 'typing', active: true })).toBe(false);
});

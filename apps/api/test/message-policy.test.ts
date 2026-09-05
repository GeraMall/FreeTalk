import { describe, expect, it } from 'vitest';
import { canDeleteChatMessage, canPinChatMessage } from '../src/message-policy.js';

describe('persistent chat message permissions', () => {
  it('never lets a direct-chat creator delete the other participant message', () => {
    expect(
      canDeleteChatMessage({
        actorId: 'creator',
        senderId: 'friend',
        kind: 'text',
        chatType: 'direct',
        role: 'owner',
      }),
    ).toBe(false);
  });

  it('lets an author delete their own message and a group admin moderate messages', () => {
    expect(
      canDeleteChatMessage({
        actorId: 'member',
        senderId: 'member',
        kind: 'image',
        chatType: 'group',
        role: 'member',
      }),
    ).toBe(true);
    expect(
      canDeleteChatMessage({
        actorId: 'admin',
        senderId: 'member',
        kind: 'text',
        chatType: 'group',
        role: 'admin',
      }),
    ).toBe(true);
  });

  it('keeps system messages immutable', () => {
    expect(
      canDeleteChatMessage({
        actorId: 'owner',
        senderId: 'owner',
        kind: 'system',
        chatType: 'group',
        role: 'owner',
      }),
    ).toBe(false);
  });

  it('allows both direct participants to pin and limits group pins to admins', () => {
    expect(canPinChatMessage('direct', 'member')).toBe(true);
    expect(canPinChatMessage('group', 'owner')).toBe(true);
    expect(canPinChatMessage('group', 'admin')).toBe(true);
    expect(canPinChatMessage('group', 'member')).toBe(false);
  });
});

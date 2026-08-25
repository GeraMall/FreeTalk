import { describe, expect, it } from 'vitest';
import { clientMessageSchema, parseClientMessage, serverMessageSchema } from '../src';

const base = {
  roomId: 'ABCDEFGH2345',
  clientId: '286d39ef-61af-4aca-84b8-47f78b0f554a',
  sessionId: '1234567890abcdef',
  name: 'Алексей',
};

describe('protocol validation', () => {
  it('accepts a valid join message', () => {
    expect(clientMessageSchema.parse({ type: 'join-room', ...base })).toEqual({
      type: 'join-room',
      ...base,
    });
  });

  it('rejects HTML-looking and control-character names', () => {
    expect(() =>
      clientMessageSchema.parse({ type: 'join-room', ...base, name: '<script>' }),
    ).toThrow();
    expect(() =>
      clientMessageSchema.parse({ type: 'join-room', ...base, name: 'bad\u0000name' }),
    ).toThrow();
  });

  it('rejects malformed room IDs and unknown fields are stripped', () => {
    expect(() =>
      clientMessageSchema.parse({ type: 'join-room', ...base, roomId: '../bad' }),
    ).toThrow();
    expect(
      parseClientMessage(JSON.stringify({ type: 'join-room', ...base, admin: true })),
    ).not.toHaveProperty('admin');
  });

  it('validates directed SDP messages', () => {
    expect(
      serverMessageSchema.safeParse({
        type: 'offer',
        from: base.clientId,
        description: { type: 'offer', sdp: 'v=0' },
      }).success,
    ).toBe(true);
  });

  it('validates owner moderation messages without accepting extra authority fields', () => {
    expect(
      clientMessageSchema.parse({
        type: 'moderation-mute',
        targetParticipantId: base.clientId,
        owner: true,
      }),
    ).toEqual({ type: 'moderation-mute', targetParticipantId: base.clientId });
    expect(
      serverMessageSchema.safeParse({
        type: 'force-mute',
        byParticipantId: base.clientId,
      }).success,
    ).toBe(true);
  });

  it('validates profile updates and the fixed reaction set', () => {
    expect(
      clientMessageSchema.safeParse({ type: 'update-profile', name: 'Новое имя' }).success,
    ).toBe(true);
    expect(
      clientMessageSchema.safeParse({
        type: 'reaction',
        id: base.clientId,
        reaction: '🎉',
      }).success,
    ).toBe(true);
    expect(
      clientMessageSchema.safeParse({
        type: 'reaction',
        id: base.clientId,
        reaction: '💣',
      }).success,
    ).toBe(false);
  });
});

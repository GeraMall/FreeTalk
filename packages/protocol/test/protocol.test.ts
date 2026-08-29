import { describe, expect, it } from 'vitest';
import {
  chatRealtimeClientMessageSchema,
  chatRealtimeServerMessageSchema,
  clientMessageSchema,
  parseClientMessage,
  serverMessageSchema,
} from '../src';

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

  it('accepts trusted hosted profile avatars in room messages', () => {
    expect(
      clientMessageSchema.safeParse({
        type: 'create-room',
        ...base,
        avatar: 'https://freetalk.example.test/v1/users/profile/avatar?v=2',
      }).success,
    ).toBe(true);
    expect(
      clientMessageSchema.safeParse({
        type: 'create-room',
        ...base,
        avatar: 'javascript:alert(1)',
      }).success,
    ).toBe(false);
  });

  it('accepts only opaque room authorization tokens with bounded length', () => {
    expect(
      clientMessageSchema.safeParse({
        type: 'join-room',
        ...base,
        authToken: 'a'.repeat(43),
      }).success,
    ).toBe(true);
    expect(
      clientMessageSchema.safeParse({ type: 'join-room', ...base, authToken: 'short' }).success,
    ).toBe(false);
    expect(
      serverMessageSchema.safeParse({
        type: 'error',
        code: 'GUEST_SESSION_EXPIRED',
        message: 'Сессия завершена',
        fatal: true,
      }).success,
    ).toBe(true);
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

  it('validates bounded ephemeral room chat messages', () => {
    expect(
      clientMessageSchema.safeParse({
        type: 'room-chat-message',
        id: base.clientId,
        text: 'Привет комнате',
      }).success,
    ).toBe(true);
    expect(
      clientMessageSchema.safeParse({
        type: 'room-chat-message',
        id: base.clientId,
        text: 'x'.repeat(2_001),
      }).success,
    ).toBe(false);
    expect(
      serverMessageSchema.safeParse({
        type: 'room-chat-message',
        message: {
          id: base.clientId,
          participantId: base.clientId,
          senderName: 'Алексей',
          text: 'Без HTML-инъекции из полей клиента',
          timestamp: Date.now(),
        },
      }).success,
    ).toBe(true);
  });

  it('validates authenticated realtime chat events', () => {
    expect(
      chatRealtimeClientMessageSchema.safeParse({
        type: 'authenticate',
        token: 'a'.repeat(48),
      }).success,
    ).toBe(true);
    expect(
      chatRealtimeServerMessageSchema.safeParse({
        type: 'profile-updated',
        userId: base.clientId,
      }).success,
    ).toBe(true);
    expect(
      chatRealtimeServerMessageSchema.safeParse({
        type: 'message-created',
        chatId: base.clientId,
        message: {
          id: '386d39ef-61af-4aca-84b8-47f78b0f554b',
          kind: 'text',
          body: 'Привет',
          metadata: {},
          sender_id: base.clientId,
          username: 'friend_1',
          display_name: 'Друг',
          avatar_url: 'https://api.example.test/v1/users/avatar',
          created_at: new Date().toISOString(),
          expires_at: null,
        },
      }).success,
    ).toBe(true);
    expect(
      chatRealtimeServerMessageSchema.safeParse({
        type: 'message-created',
        chatId: base.clientId,
        message: {
          id: '386d39ef-61af-4aca-84b8-47f78b0f554c',
          kind: 'image',
          body: '',
          metadata: { width: 1600, height: 900 },
          sender_id: base.clientId,
          created_at: new Date().toISOString(),
          expires_at: null,
        },
      }).success,
    ).toBe(true);
  });
});

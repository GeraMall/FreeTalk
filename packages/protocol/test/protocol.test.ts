import { describe, expect, it } from 'vitest';
import {
  chatGifMetadataSchema,
  chatReactionEmojiSchema,
  chatRealtimeClientMessageSchema,
  chatRealtimeServerMessageSchema,
  clientMessageSchema,
  parseClientMessage,
  serverMessageSchema,
  telemetryReportSchema,
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

  it('validates server-authenticated recording notifications', () => {
    expect(clientMessageSchema.parse({ type: 'recording-started', name: 'Подмена' })).toEqual({
      type: 'recording-started',
    });
    expect(
      serverMessageSchema.safeParse({
        type: 'recording-started',
        participantId: base.clientId,
        participantName: base.name,
        timestamp: Date.now(),
      }).success,
    ).toBe(true);
  });

  it('accepts bounded anonymous connection telemetry and rejects oversized batches', () => {
    const report = {
      eventVersion: 1 as const,
      timestamp: Date.now(),
      clientVersion: '0.4.0-beta.73',
      platform: 'windows' as const,
      sessionId: base.sessionId,
      connections: [
        {
          peerId: base.clientId,
          connectionType: 'turn' as const,
          localCandidateType: 'relay' as const,
          remoteCandidateType: 'srflx' as const,
          protocol: 'udp' as const,
          connectionState: 'connected' as const,
          iceState: 'completed' as const,
          rttMs: 42,
          availableOutgoingBitrate: 2_000_000,
          availableIncomingBitrate: 4_000_000,
          bytesSent: 1_000,
          bytesReceived: 2_000,
          media: [],
        },
      ],
      events: [{ type: 'ice_restart' as const, timestamp: Date.now() }],
    };
    expect(telemetryReportSchema.safeParse(report).success).toBe(true);
    expect(
      telemetryReportSchema.safeParse({
        ...report,
        connections: Array(8).fill(report.connections[0]),
      }).success,
    ).toBe(false);
    expect(JSON.stringify(report)).not.toContain('email');
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
    expect(
      chatRealtimeServerMessageSchema.safeParse({
        type: 'message-updated',
        chatId: base.clientId,
        messageId: '386d39ef-61af-4aca-84b8-47f78b0f554c',
        metadata: { roomId: 'ROOM12345678', ended: true },
      }).success,
    ).toBe(true);
    expect(
      chatRealtimeServerMessageSchema.safeParse({
        type: 'chat-removed',
        chatId: base.clientId,
      }).success,
    ).toBe(true);
    expect(
      chatRealtimeServerMessageSchema.safeParse({
        type: 'message-reactions-updated',
        chatId: base.clientId,
        messageId: '386d39ef-61af-4aca-84b8-47f78b0f554c',
        reactions: [{ emoji: '👨‍👩‍👧‍👦', count: 1, userIds: [base.clientId] }],
      }).success,
    ).toBe(true);
    expect(
      chatRealtimeServerMessageSchema.safeParse({
        type: 'message-pin-updated',
        chatId: base.clientId,
        messageId: '386d39ef-61af-4aca-84b8-47f78b0f554c',
        pinnedAt: new Date().toISOString(),
        pinnedBy: base.clientId,
      }).success,
    ).toBe(true);
    expect(
      chatRealtimeServerMessageSchema.safeParse({
        type: 'message-deleted',
        chatId: base.clientId,
        messageId: '386d39ef-61af-4aca-84b8-47f78b0f554c',
        latestMessage: null,
      }).success,
    ).toBe(true);
  });

  it('accepts exactly one arbitrary emoji grapheme for persistent chat reactions', () => {
    for (const emoji of ['👍', '🫠', '👨‍👩‍👧‍👦', '🇷🇺', '1️⃣', '😀‍😀‍😀‍😀‍😀‍😀‍😀‍😀‍😀'])
      expect(chatReactionEmojiSchema.safeParse(emoji).success).toBe(true);
    for (const invalid of ['', 'A', '👍🔥', 'not emoji'])
      expect(chatReactionEmojiSchema.safeParse(invalid).success).toBe(false);
  });

  it('does not discard valid reaction summaries from larger group chats', () => {
    expect(
      chatRealtimeServerMessageSchema.safeParse({
        type: 'message-reactions-updated',
        chatId: base.clientId,
        messageId: '386d39ef-61af-4aca-84b8-47f78b0f554c',
        reactions: [{ emoji: '🔥', count: 51, userIds: Array(51).fill(base.clientId) }],
      }).success,
    ).toBe(true);
  });

  it('allows GIF media only from the exact Wikimedia upload host', () => {
    const gif = {
      url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/example.gif',
      previewUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/example.gif',
      width: 640,
      height: 360,
      alt: 'Example GIF',
      attribution: {
        provider: 'Wikimedia Commons',
        title: 'Example',
        pageUrl: 'https://commons.wikimedia.org/wiki/File:Example.gif',
        author: 'Example author',
        license: 'CC BY-SA 4.0',
      },
    } as const;
    expect(chatGifMetadataSchema.safeParse(gif).success).toBe(true);
    expect(
      chatGifMetadataSchema.safeParse({
        url: gif.url,
        alt: gif.alt,
        attribution: {
          provider: gif.attribution.provider,
          title: gif.attribution.title,
          pageUrl: gif.attribution.pageUrl,
        },
      }).success,
    ).toBe(true);
    expect(
      chatGifMetadataSchema.safeParse({
        ...gif,
        url: 'https://upload.wikimedia.org.evil.example/example.gif',
      }).success,
    ).toBe(false);
    expect(
      chatGifMetadataSchema.safeParse({ ...gif, url: 'http://upload.wikimedia.org/example.gif' })
        .success,
    ).toBe(false);
    expect(
      chatGifMetadataSchema.safeParse({
        ...gif,
        attribution: {
          ...gif.attribution,
          pageUrl: 'https://commons.wikimedia.org.evil.example/wiki/File:Example.gif',
        },
      }).success,
    ).toBe(false);
  });
});

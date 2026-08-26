import { DISPLAY_NAME_PATTERN, ROOM_CODE_PATTERN } from '@freetalk/config';
import { z } from 'zod';

export const participantSchema = z.object({
  id: z.string().uuid(),
  name: z.string().regex(DISPLAY_NAME_PATTERN),
  avatar: z
    .string()
    .max(18_000)
    .regex(/^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/)
    .optional(),
  muted: z.boolean(),
  isOwner: z.boolean(),
  connectedAt: z.number().int().nonnegative(),
});

const roomId = z.string().regex(ROOM_CODE_PATTERN);
const clientId = z.string().uuid();
const displayName = z.string().trim().regex(DISPLAY_NAME_PATTERN);
const avatar = participantSchema.shape.avatar;
export const reactionSchema = z.enum(['👍', '❤️', '😂', '🎉', '🔥']);
const sessionId = z.string().min(16).max(128);
const sdp = z.object({ type: z.enum(['offer', 'answer']), sdp: z.string().min(1).max(24_000) });
const ice = z.object({
  candidate: z.string().max(8_000),
  sdpMid: z.string().nullable().optional(),
  sdpMLineIndex: z.number().int().nonnegative().nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional(),
});

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create-room'),
    roomId,
    clientId,
    sessionId,
    authToken: z.string().min(32).max(256).optional(),
    name: displayName,
    avatar,
  }),
  z.object({
    type: z.literal('join-room'),
    roomId,
    clientId,
    sessionId,
    authToken: z.string().min(32).max(256).optional(),
    name: displayName,
    avatar,
  }),
  z.object({ type: z.literal('leave-room') }),
  z.object({ type: z.literal('offer'), to: clientId, description: sdp }),
  z.object({ type: z.literal('answer'), to: clientId, description: sdp }),
  z.object({ type: z.literal('ice-candidate'), to: clientId, candidate: ice }),
  z.object({ type: z.literal('mute-changed'), muted: z.boolean() }),
  z.object({ type: z.literal('update-profile'), name: displayName, avatar }),
  z.object({ type: z.literal('reaction'), id: z.string().uuid(), reaction: reactionSchema }),
  z.object({ type: z.literal('moderation-mute'), targetParticipantId: clientId }),
  z.object({ type: z.literal('ping'), timestamp: z.number().int().nonnegative() }),
]);

export const iceServerSchema = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional(),
});

export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('room-created'), roomId }),
  z.object({
    type: z.literal('joined-room'),
    roomId,
    selfId: clientId,
    // Optional during the rolling update: 0.3.19 signaling servers do not send it yet.
    roomStartedAt: z.number().int().nonnegative().optional(),
    participants: z.array(participantSchema),
  }),
  z.object({ type: z.literal('participants'), participants: z.array(participantSchema) }),
  z.object({ type: z.literal('participant-joined'), participant: participantSchema }),
  z.object({ type: z.literal('participant-updated'), participant: participantSchema }),
  z.object({
    type: z.literal('reaction'),
    id: z.string().uuid(),
    participantId: clientId,
    reaction: reactionSchema,
  }),
  z.object({
    type: z.literal('participant-left'),
    participantId: clientId,
    reason: z.string().max(128).optional(),
  }),
  z.object({ type: z.literal('offer'), from: clientId, description: sdp }),
  z.object({ type: z.literal('answer'), from: clientId, description: sdp }),
  z.object({ type: z.literal('ice-candidate'), from: clientId, candidate: ice }),
  z.object({ type: z.literal('mute-changed'), participantId: clientId, muted: z.boolean() }),
  z.object({
    type: z.literal('force-mute'),
    byParticipantId: clientId,
  }),
  z.object({ type: z.literal('owner-changed'), ownerId: clientId }),
  z.object({
    type: z.literal('ice-config'),
    iceServers: z.array(iceServerSchema),
    expiresAt: z.number().optional(),
  }),
  z.object({ type: z.literal('pong'), timestamp: z.number().int().nonnegative() }),
  z.object({ type: z.literal('room-closed'), reason: z.string().max(256) }),
  z.object({ type: z.literal('participant-disconnected'), reason: z.string().max(256) }),
  z.object({
    type: z.literal('error'),
    code: z.enum([
      'INVALID_MESSAGE',
      'ROOM_NOT_FOUND',
      'ROOM_EXISTS',
      'ROOM_FULL',
      'NOT_JOINED',
      'TARGET_NOT_FOUND',
      'NOT_OWNER',
      'RATE_LIMITED',
      'PROFILE_RATE_LIMITED',
      'AUTH_REQUIRED',
      'REGISTERED_ONLY',
      'GUEST_SESSION_EXPIRED',
      'GUEST_DAILY_LIMIT',
      'INTERNAL_ERROR',
    ]),
    message: z.string().max(256),
    fatal: z.boolean().optional(),
  }),
]);

export type Participant = z.infer<typeof participantSchema>;
export type Reaction = z.infer<typeof reactionSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type SignalMessage = Extract<ClientMessage, { type: 'offer' | 'answer' | 'ice-candidate' }>;

export const chatRealtimeClientMessageSchema = z.object({
  type: z.literal('authenticate'),
  token: z.string().min(32).max(256),
});

const realtimeChatMessage = z.object({
  id: z.string().uuid(),
  kind: z.enum(['text', 'system', 'call']),
  body: z.string().max(4000),
  metadata: z.record(z.string(), z.unknown()).optional(),
  sender_id: z.string().uuid().nullable(),
  username: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  avatar_url: z.string().url().nullable().optional(),
  created_at: z.string(),
  expires_at: z.string().nullable(),
});

export const chatRealtimeServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({
    type: z.literal('message-created'),
    chatId: z.string().uuid(),
    message: realtimeChatMessage,
  }),
  z.object({ type: z.literal('history-cleared'), chatId: z.string().uuid() }),
  z.object({ type: z.literal('profile-updated'), userId: z.string().uuid() }),
  z.object({
    type: z.literal('retention-changed'),
    chatId: z.string().uuid(),
    retentionHours: z.union([z.literal(24), z.literal(168), z.literal(720), z.null()]),
  }),
]);

export type ChatRealtimeClientMessage = z.infer<typeof chatRealtimeClientMessageSchema>;
export type ChatRealtimeServerMessage = z.infer<typeof chatRealtimeServerMessageSchema>;

export function parseClientMessage(raw: string): ClientMessage {
  return clientMessageSchema.parse(JSON.parse(raw));
}

export function parseServerMessage(raw: string): ServerMessage {
  return serverMessageSchema.parse(JSON.parse(raw));
}

export function parseChatRealtimeServerMessage(raw: string): ChatRealtimeServerMessage {
  return chatRealtimeServerMessageSchema.parse(JSON.parse(raw));
}

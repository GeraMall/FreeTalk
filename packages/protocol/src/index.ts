import { DISPLAY_NAME_PATTERN, ROOM_CODE_PATTERN } from '@freetalk/config';
import { z } from 'zod';

export {
  CHAT_SLOW_MODE_MS,
  CHAT_SPAM_MAX_ATTEMPTS,
  CHAT_SPAM_WINDOW_MS,
  ChatSendPacer,
  type ChatSendPacingResult,
} from './chat-send-pacer.js';

const inlineAvatarSchema = z
  .string()
  .max(18_000)
  .regex(/^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/);
const hostedAvatarSchema = z
  .string()
  .max(2_048)
  .regex(/^https:\/\/[^\s]+$/);
const avatarSchema = z.union([inlineAvatarSchema, hostedAvatarSchema]);

export const participantSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid().optional(),
  name: z.string().regex(DISPLAY_NAME_PATTERN),
  avatar: avatarSchema.optional(),
  muted: z.boolean(),
  isOwner: z.boolean(),
  connectedAt: z.number().int().nonnegative(),
});

const roomId = z.string().regex(ROOM_CODE_PATTERN);
const clientId = z.string().uuid();
const displayName = z.string().trim().regex(DISPLAY_NAME_PATTERN);
const avatar = participantSchema.shape.avatar;
export const reactionSchema = z.enum(['👍', '❤️', '😂', '🎉', '🔥']);
export const roomChatTextSchema = z.string().trim().min(1).max(2_000);
export const roomChatMessageSchema = z.object({
  id: z.string().uuid(),
  participantId: clientId,
  senderName: displayName,
  senderAvatar: avatar,
  text: roomChatTextSchema,
  timestamp: z.number().int().nonnegative(),
});
const sessionId = z.string().min(16).max(128);
const sdp = z.object({ type: z.enum(['offer', 'answer']), sdp: z.string().min(1).max(24_000) });
const ice = z.object({
  candidate: z.string().max(8_000),
  sdpMid: z.string().nullable().optional(),
  sdpMLineIndex: z.number().int().nonnegative().nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional(),
});

export const telemetryMediaSampleSchema = z.object({
  source: z.enum(['camera', 'screen']),
  direction: z.enum(['outbound', 'inbound']),
  width: z.number().int().min(0).max(8192),
  height: z.number().int().min(0).max(8192),
  framesPerSecond: z.number().min(0).max(240),
  bitrate: z.number().int().min(0).max(100_000_000),
  packetsLost: z.number().int().min(0).max(2_147_483_647),
  packetsDelta: z.number().int().min(0).max(2_147_483_647).optional(),
  packetsLostDelta: z.number().int().min(0).max(2_147_483_647).optional(),
  packetLossPercent: z.number().min(0).max(100).optional(),
  framesSent: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  framesEncoded: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  framesDropped: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  qualityLimitationReason: z.enum(['none', 'bandwidth', 'cpu', 'other']),
  mode: z.enum(['text', 'video', 'auto']).optional(),
});

export const telemetryConnectionSampleSchema = z.object({
  peerId: clientId,
  connectionType: z.enum(['direct', 'turn', 'unknown']),
  localCandidateType: z.enum(['host', 'srflx', 'prflx', 'relay', 'unknown']),
  remoteCandidateType: z.enum(['host', 'srflx', 'prflx', 'relay', 'unknown']),
  protocol: z.enum(['udp', 'tcp', 'tls', 'unknown']),
  connectionState: z.enum(['new', 'connecting', 'connected', 'disconnected', 'failed', 'closed']),
  iceState: z.enum([
    'new',
    'checking',
    'connected',
    'completed',
    'disconnected',
    'failed',
    'closed',
  ]),
  rttMs: z.number().min(0).max(120_000).nullable(),
  availableOutgoingBitrate: z.number().int().min(0).max(10_000_000_000).nullable(),
  availableIncomingBitrate: z.number().int().min(0).max(10_000_000_000).nullable(),
  bytesSent: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  bytesReceived: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  media: z.array(telemetryMediaSampleSchema).max(4),
});

export const telemetryEventSchema = z.object({
  type: z.enum(['signaling_reconnect', 'ice_failure', 'ice_restart']),
  timestamp: z.number().int().nonnegative(),
  details: z
    .record(
      z.string().max(32),
      z.union([z.string().max(128), z.number().finite(), z.boolean(), z.null()]),
    )
    .refine((value) => Object.keys(value).length <= 8, 'Too many telemetry detail fields')
    .optional(),
});

export const telemetryReportSchema = z.object({
  eventVersion: z.literal(1),
  timestamp: z.number().int().nonnegative(),
  clientVersion: z.string().min(1).max(64),
  platform: z.enum([
    'windows',
    'macos-arm64',
    'macos-x64',
    'linux',
    'web',
    'android',
    'ios',
    'unknown',
  ]),
  sessionId,
  connections: z.array(telemetryConnectionSampleSchema).max(7),
  events: z.array(telemetryEventSchema).max(20).default([]),
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
  z.object({
    type: z.literal('room-chat-message'),
    id: z.string().uuid(),
    text: roomChatTextSchema,
  }),
  z.object({ type: z.literal('recording-started') }),
  z.object({ type: z.literal('moderation-mute'), targetParticipantId: clientId }),
  z.object({ type: z.literal('telemetry-report'), report: telemetryReportSchema }),
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
    roomChatMessages: z.array(roomChatMessageSchema).max(200).optional(),
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
  z.object({ type: z.literal('room-chat-message'), message: roomChatMessageSchema }),
  z.object({
    type: z.literal('recording-started'),
    participantId: clientId,
    participantName: displayName,
    timestamp: z.number().int().nonnegative(),
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
export type RoomChatMessage = z.infer<typeof roomChatMessageSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type SignalMessage = Extract<ClientMessage, { type: 'offer' | 'answer' | 'ice-candidate' }>;
export type TelemetryReport = z.infer<typeof telemetryReportSchema>;
export type TelemetryConnectionSample = z.infer<typeof telemetryConnectionSampleSchema>;

export const presenceStatusSchema = z.enum(['online', 'away', 'dnd', 'offline']);
export type PresenceStatus = z.infer<typeof presenceStatusSchema>;

function isSingleEmojiGrapheme(value: string) {
  if (!value || new TextEncoder().encode(value).length > 64) return false;
  if (typeof Intl.Segmenter === 'function') {
    const graphemes = [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(value)];
    if (graphemes.length !== 1) return false;
    return /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3)/u.test(value);
  }
  return /^(?:\p{Regional_Indicator}{2}|[#*0-9]\ufe0f?\u20e3|\p{Extended_Pictographic}(?:\ufe0f|\p{Emoji_Modifier})?(?:\u200d\p{Extended_Pictographic}(?:\ufe0f|\p{Emoji_Modifier})?)*)$/u.test(
    value,
  );
}

export const chatReactionEmojiSchema = z
  .string()
  .refine(isSingleEmojiGrapheme, 'Reaction must be one emoji grapheme');

const wikimediaUploadUrlSchema = z
  .string()
  .url()
  .max(2_048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        url.hostname === 'upload.wikimedia.org' &&
        url.port === '' &&
        url.username === '' &&
        url.password === ''
      );
    } catch {
      return false;
    }
  }, 'GIF URL must use the Wikimedia upload host');

const wikimediaCommonsPageUrlSchema = z
  .string()
  .url()
  .max(2_048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        url.hostname === 'commons.wikimedia.org' &&
        url.port === '' &&
        url.username === '' &&
        url.password === ''
      );
    } catch {
      return false;
    }
  }, 'Attribution URL must use Wikimedia Commons');

export const chatGifMetadataSchema = z.object({
  url: wikimediaUploadUrlSchema,
  previewUrl: wikimediaUploadUrlSchema.optional(),
  width: z.number().int().min(1).max(4_096).optional(),
  height: z.number().int().min(1).max(4_096).optional(),
  alt: z.string().trim().min(1).max(200),
  attribution: z.object({
    provider: z.literal('Wikimedia Commons'),
    title: z.string().trim().min(1).max(200),
    pageUrl: wikimediaCommonsPageUrlSchema,
    author: z.string().trim().min(1).max(200).optional(),
    license: z.string().trim().min(1).max(100).optional(),
  }),
});

export type ChatGifMetadata = z.infer<typeof chatGifMetadataSchema>;

export const chatRealtimeClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('authenticate'),
    token: z.string().min(32).max(256),
  }),
  z.object({
    type: z.literal('presence'),
    status: presenceStatusSchema,
  }),
]);

export const chatMessageReplySchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['text', 'system', 'call', 'image']),
  body: z.string().max(4_000),
  metadata: z.record(z.string(), z.unknown()).optional(),
  sender_id: z.string().uuid().nullable(),
  display_name: z.string().nullable().optional(),
});

export const chatMessageReactionSummarySchema = z.object({
  emoji: chatReactionEmojiSchema,
  count: z.number().int().min(1),
  userIds: z.array(z.string().uuid()),
});

export const realtimeChatMessageSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['text', 'system', 'call', 'image']),
  body: z.string().max(4000),
  metadata: z.record(z.string(), z.unknown()).optional(),
  sender_id: z.string().uuid().nullable(),
  username: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  avatar_url: z.string().url().nullable().optional(),
  created_at: z.string(),
  expires_at: z.string().nullable(),
  reply_to: chatMessageReplySchema.nullable().optional(),
  reactions: z.array(chatMessageReactionSummarySchema).optional(),
  pinned_at: z.string().datetime({ offset: true }).nullable().optional(),
  pinned_by: z.string().uuid().nullable().optional(),
});

export type RealtimeChatMessage = z.infer<typeof realtimeChatMessageSchema>;
export type ChatMessageReply = z.infer<typeof chatMessageReplySchema>;
export type ChatMessageReactionSummary = z.infer<typeof chatMessageReactionSummarySchema>;

export const chatRealtimeServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({
    type: z.literal('message-created'),
    chatId: z.string().uuid(),
    message: realtimeChatMessageSchema,
  }),
  z.object({
    type: z.literal('message-updated'),
    chatId: z.string().uuid(),
    messageId: z.string().uuid(),
    metadata: z.record(z.string(), z.unknown()),
  }),
  z.object({ type: z.literal('history-cleared'), chatId: z.string().uuid() }),
  z.object({
    type: z.literal('message-reactions-updated'),
    chatId: z.string().uuid(),
    messageId: z.string().uuid(),
    reactions: z.array(chatMessageReactionSummarySchema),
  }),
  z.object({
    type: z.literal('message-pin-updated'),
    chatId: z.string().uuid(),
    messageId: z.string().uuid(),
    pinnedAt: z.string().datetime({ offset: true }).nullable(),
    pinnedBy: z.string().uuid().nullable(),
    pinnedMessage: realtimeChatMessageSchema.nullable().optional(),
  }),
  z.object({
    type: z.literal('message-deleted'),
    chatId: z.string().uuid(),
    messageId: z.string().uuid(),
    latestMessage: realtimeChatMessageSchema.nullable().optional(),
    pinnedMessage: realtimeChatMessageSchema.nullable().optional(),
  }),
  z.object({ type: z.literal('chat-removed'), chatId: z.string().uuid() }),
  z.object({ type: z.literal('profile-updated'), userId: z.string().uuid() }),
  z.object({
    type: z.literal('chat-updated'),
    chatId: z.string().uuid(),
    title: z.string().min(1).max(80).optional(),
    avatarUrl: z.string().url().nullable().optional(),
    avatarPositionX: z.number().int().min(0).max(100).optional(),
    avatarPositionY: z.number().int().min(0).max(100).optional(),
    avatarScale: z.number().int().min(100).max(250).optional(),
  }),
  z.object({
    type: z.literal('presence-updated'),
    userId: z.string().uuid(),
    status: presenceStatusSchema,
  }),
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

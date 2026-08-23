export const ROOM_MAX_PARTICIPANTS = 6;
export const MAX_SIGNAL_BYTES = 32 * 1024;
export const ROOM_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/;
// Protocol validation intentionally excludes ASCII control characters.
// eslint-disable-next-line no-control-regex
export const DISPLAY_NAME_PATTERN = /^[^<>\u0000-\u001F\u007F]{1,32}$/u;
export const HEARTBEAT_INTERVAL_MS = 15_000;
export const CLIENT_STALE_AFTER_MS = 45_000;
export const RATE_LIMIT_MESSAGES = 120;
export const RATE_LIMIT_WINDOW_MS = 10_000;
export const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 15_000, 30_000] as const;
export const MAX_RECONNECT_ATTEMPTS = 8;

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
];

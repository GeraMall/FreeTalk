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

const IPV4_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export function isIpv4Address(value: string) {
  if (!IPV4_PATTERN.test(value)) return false;
  return value.split('.').every((part) => Number(part) <= 255);
}

export function parseDnsIpv4Answers(value: unknown) {
  if (!value || typeof value !== 'object' || !('Answer' in value) || !Array.isArray(value.Answer))
    return [];
  return [
    ...new Set(
      value.Answer.flatMap((answer) => {
        if (!answer || typeof answer !== 'object') return [];
        if (!('type' in answer) || answer.type !== 1 || !('data' in answer)) return [];
        return typeof answer.data === 'string' && isIpv4Address(answer.data) ? [answer.data] : [];
      }),
    ),
  ].slice(0, 4);
}

export function withCloudflareTurnIpFallbacks(iceServers: RTCIceServer[], ipv4Addresses: string[]) {
  const addresses = [...new Set(ipv4Addresses.filter(isIpv4Address))].slice(0, 4);
  if (addresses.length === 0) return iceServers;
  const fallbackServers = iceServers.flatMap((server): RTCIceServer[] => {
    const urls = typeof server.urls === 'string' ? [server.urls] : server.urls;
    if (
      !server.username ||
      !server.credential ||
      !urls.some((url) => /^turns?:turn\.cloudflare\.com(?=[:/?]|$)/i.test(url))
    )
      return [];
    return [
      {
        urls: addresses.flatMap((address) => [
          `turn:${address}:3478?transport=udp`,
          `turn:${address}:3478?transport=tcp`,
          `turn:${address}:53?transport=udp`,
          `turn:${address}:80?transport=tcp`,
        ]),
        username: server.username,
        credential: server.credential,
      },
    ];
  });
  return [...iceServers, ...fallbackServers];
}

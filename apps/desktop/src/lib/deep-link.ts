import { ROOM_CODE_PATTERN } from '@freetalk/config';

export const DEFAULT_INVITE_BASE_URL = 'https://freetalk.191-44-38-60.sslip.io';

export function roomInviteUrl(roomCode: string, baseUrl = DEFAULT_INVITE_BASE_URL) {
  if (!ROOM_CODE_PATTERN.test(roomCode)) throw new Error('Invalid room code');
  return `${baseUrl.replace(/\/$/, '')}/join/${roomCode}`;
}

export function parseRoomDeepLink(value: string, baseUrl = DEFAULT_INVITE_BASE_URL) {
  try {
    const url = new URL(value);
    const expectedOrigin = new URL(baseUrl).origin;
    const customScheme =
      url.protocol === 'freetalk:' && (url.hostname === 'room' || url.hostname === 'join');
    const webInvite = url.protocol === 'https:' && url.origin === expectedOrigin;
    if (!customScheme && !webInvite) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const candidate = customScheme
      ? parts.length === 1
        ? parts[0]
        : undefined
      : parts.length === 2 && parts[0] === 'join'
        ? parts[1]
        : undefined;
    if (!candidate) return null;
    const roomCode = candidate.toUpperCase();
    return ROOM_CODE_PATTERN.test(roomCode) ? roomCode : null;
  } catch {
    return null;
  }
}

export async function subscribeToRoomDeepLinks(
  onRoom: (roomCode: string) => void,
  baseUrl = DEFAULT_INVITE_BASE_URL,
) {
  if (!(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
    return () => undefined;
  const { getCurrent, onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
  const accept = (urls: string[]) => {
    for (const value of urls) {
      const roomCode = parseRoomDeepLink(value, baseUrl);
      if (roomCode) {
        onRoom(roomCode);
        return;
      }
    }
  };
  const current = await getCurrent().catch(() => null);
  if (current) accept(current);
  return onOpenUrl(accept);
}

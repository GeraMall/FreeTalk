import { ROOM_CODE_PATTERN } from '@freetalk/config';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
}

export function parseRoomCode(input: string) {
  const normalized = input.trim().toUpperCase();
  if (ROOM_CODE_PATTERN.test(normalized)) return normalized;
  const match = normalized.match(/[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}/);
  return match && ROOM_CODE_PATTERN.test(match[0]) ? match[0] : null;
}

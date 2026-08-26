export const GUEST_MAX_JOINS_PER_UTC_DAY = 5;
export const GUEST_SESSION_SECONDS = 30 * 60;
export const DEFAULT_MESSAGE_RETENTION_HOURS = 30 * 24;
export const MESSAGE_RETENTION_OPTIONS = [24, 7 * 24, DEFAULT_MESSAGE_RETENTION_HOURS] as const;

export type MessageRetentionHours = (typeof MESSAGE_RETENTION_OPTIONS)[number] | null;

export function isMessageRetentionHours(value: unknown): value is MessageRetentionHours {
  return value === null || MESSAGE_RETENTION_OPTIONS.includes(value as 24 | 168 | 720);
}

export function hasHistoryMajority(votes: number, eligibleMembers: number) {
  return eligibleMembers > 0 && votes > eligibleMembers / 2;
}

export function guestQuotaAvailable(joinCount: number) {
  return joinCount >= 0 && joinCount < GUEST_MAX_JOINS_PER_UTC_DAY;
}

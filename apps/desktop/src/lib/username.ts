export const USERNAME_MIN_LENGTH = 5;
export const USERNAME_MAX_LENGTH = 24;
export const USERNAME_PATTERN = /^[a-z0-9_]{5,24}$/;

export function normalizeUsername(value: string) {
  return value
    .replace(/^@/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, USERNAME_MAX_LENGTH);
}

export function isValidUsername(value: string) {
  return USERNAME_PATTERN.test(value);
}

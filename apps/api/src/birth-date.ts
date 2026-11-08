/** Dates are self-declared account data, not identity verification. */
export function parseBirthDate(text: string, now = new Date()): string | null {
  const match = text
    .trim()
    .replace(/^\/birthdate\s+/i, '')
    .match(/^(\d{1,2})[.\s/-](\d{1,2})[.\s/-](\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]),
    month = Number(match[2]),
    year = Number(match[3]);
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === iso &&
    iso <= now.toISOString().slice(0, 10)
    ? iso
    : null;
}
export function adultBirthDate(iso: string, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const cutoff = `${now.getUTCFullYear() - 18}${today.slice(4)}`;
  return iso <= cutoff;
}

import { describe, expect, it } from 'vitest';
import { parseBirthDate, adultBirthDate } from '../src/birth-date.js';
describe('private birth date capture', () => {
  it('validates real dates rather than accepting an age or a future birthday', () => {
    const now = new Date('2026-11-08T12:00:00Z');
    expect(parseBirthDate('25.12.2000', now)).toBe('2000-12-25');
    expect(parseBirthDate('/birthdate 29.02.2008', now)).toBe('2008-02-29');
    for (const invalid of [
      '18',
      '31.02.2000',
      '29.02.2007',
      '01.01.1899',
      '09.11.2026',
      '25.13.2000',
      '01.01.2100',
    ])
      expect(parseBirthDate(invalid, now)).toBeNull();
  });
  it('changes eligibility on the birthday, including a leap-day boundary', () => {
    const now = new Date('2026-11-08T12:00:00Z');
    expect(adultBirthDate('2008-11-08', now)).toBe(true);
    expect(adultBirthDate('2008-11-09', now)).toBe(false);
    expect(adultBirthDate('2008-02-29', new Date('2026-02-28T12:00:00Z'))).toBe(false);
    expect(adultBirthDate('2008-02-29', new Date('2026-03-01T12:00:00Z'))).toBe(true);
  });
});

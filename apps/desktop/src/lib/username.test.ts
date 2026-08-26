import { describe, expect, it } from 'vitest';
import { isValidUsername, normalizeUsername } from './username';

describe('username rules', () => {
  it('accepts only 5-24 lowercase latin letters, digits and underscores', () => {
    expect(isValidUsername('gera_25')).toBe(true);
    expect(isValidUsername('gera')).toBe(false);
    expect(isValidUsername('гера_25')).toBe(false);
    expect(isValidUsername('gera.name')).toBe(false);
    expect(isValidUsername('gera-name')).toBe(false);
  });

  it('normalizes input before it reaches registration or profile APIs', () => {
    expect(normalizeUsername('@Gera_25!Привет')).toBe('gera_25');
  });
});

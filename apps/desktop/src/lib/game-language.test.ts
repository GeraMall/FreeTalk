// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import translations from './game-translations.json';
import { t } from './app-language';
import { localizeGameText } from './game-text';
import { propertyLog } from './monopoly-layout';
afterEach(() => localStorage.clear());
it('has every game catalog entry in all six translated languages without losing placeholders', () => {
  for (const [key, entries] of Object.entries(translations))
    for (const lang of ['en', 'zh-CN', 'kk', 'be', 'ka', 'es'] as const) {
      expect(entries[lang], `${lang}: ${key}`).toBeTruthy();
      expect(
        [...entries[lang].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(),
        `${lang}: ${key}`,
      ).toEqual([...key.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort());
    }
});
it('localizes poker terminology, quiz arithmetic, and server-generated property logs', () => {
  localStorage.setItem('trlka.ui-language', 'en');
  expect(t('Пас')).toBe('Fold');
  expect(t('Общий банк')).toBe('Pot');
  expect(localizeGameText('Чему равно 7 × 8?')).toContain('7');
  expect(localizeGameText('What is 7 × 8?')).not.toMatch(/[А-Яа-я]/);
  expect(propertyLog('Игрок 2 → игроку 1: аренда 50')).not.toMatch(/[А-Яа-я]/);
});

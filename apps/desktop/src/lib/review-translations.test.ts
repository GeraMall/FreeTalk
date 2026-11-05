// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { appLanguages, t } from './app-language';
import { registrationLegalDocuments } from '@freetalk/protocol';
import { localizedServiceBody } from './service-chat';

afterEach(() => localStorage.removeItem('trlka.ui-language'));
describe('Word review translations', () => {
  for (const language of Object.keys(appLanguages).filter((lang) => lang !== 'ru')) {
    it(`translates legal documents and service commands in ${language}`, () => {
      localStorage.setItem('trlka.ui-language', language);
      for (const document of Object.values(registrationLegalDocuments)) {
        expect(t(document.title)).not.toBe(document.title);
        for (const paragraph of document.paragraphs) expect(t(paragraph)).not.toBe(paragraph);
      }
      const body = localizedServiceBody({
        author: 'bot',
        body: '/bug — сообщить об ошибке\n/cancel — отменить ввод обращения',
      });
      expect(body).not.toContain('сообщить');
      expect(body).toContain('/bug');
      expect(body).toContain('/cancel');
      expect(t('Вы в звонке')).not.toBe('Вы в звонке');
    });
  }
  it('never translates user messages even if they match a system string', () => {
    localStorage.setItem('trlka.ui-language', 'zh-CN');
    expect(localizedServiceBody({ author: 'user', body: 'Нет на месте' })).toBe('Нет на месте');
    expect(localizedServiceBody({ author: 'user', body: '/bug — сообщить об ошибке' })).toBe(
      '/bug — сообщить об ошибке',
    );
    expect(t('БОТ')).toBe('机器人');
  });
  it('preserves the support receipt ID while translating its surrounding text', () => {
    localStorage.setItem('trlka.ui-language', 'en');
    expect(
      localizedServiceBody({
        author: 'bot',
        body: 'Обращение №a12bc345 принято и поставлено в очередь отправки команде TRLKA. Спасибо за подробности.',
      }),
    ).toBe(
      'Request #a12bc345 has been accepted and queued for delivery to the TRLKA team. Thank you for the details.',
    );
    expect(localizedServiceBody({ author: 'bot', body: 'Unknown future template' })).toBe(
      'Unknown future template',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { chatGifMetadataSchema } from './index';
const gif = {
  url: 'https://static.klipy.com/reaction.gif?delivery=keep',
  previewUrl: 'https://static.klipy.com/preview.gif',
  alt: 'Реакция',
  attribution: { provider: 'KLIPY', title: 'Реакция', pageUrl: 'https://klipy.com/gifs/reaction' },
};
describe('GIF sharing contract', () => {
  it('accepts the exact provider URL without losing delivery parameters', () => {
    expect(chatGifMetadataSchema.parse(gif).url).toBe(gif.url);
  });
  it('rejects spoofed hosts, credentials, ports and mismatched attribution', () => {
    for (const url of [
      'https://static.klipy.com.evil.test/a.gif',
      'http://static.klipy.com/a.gif',
      'https://user:password@static.klipy.com/a.gif',
      'https://static.klipy.com:8443/a.gif',
      'https://upload.wikimedia.org/forged.gif',
      'https://static.klipy.com/still.png',
    ])
      expect(chatGifMetadataSchema.safeParse({ ...gif, url }).success).toBe(false);
  });
});

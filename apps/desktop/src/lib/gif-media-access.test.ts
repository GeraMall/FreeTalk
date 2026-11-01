import { describe, expect, it } from 'vitest';
import { accountRealtimeUrl, protectedGifAssetId } from './api-client';
describe('private GIF request authentication boundary', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const url = new URL(accountRealtimeUrl().replace(/^ws/, 'http'));
  url.pathname = url.pathname.replace('/chats/realtime', `/gifs/assets/${id}`);
  it('recognizes only the exact account API asset path', () => {
    expect(protectedGifAssetId(url.toString())).toBe(id);
    expect(protectedGifAssetId(url + '?variant=thumbnail')).toBe(id);
  });
  it('never routes credentials to remote URLs, alternate paths or arbitrary queries', () => {
    const external = new URL(url);
    external.hostname = 'cdn.example.test';
    expect(protectedGifAssetId(external.toString())).toBeUndefined();
    expect(protectedGifAssetId(url + '?redirect=external')).toBeUndefined();
    expect(protectedGifAssetId(url + '/anything')).toBeUndefined();
  });
});

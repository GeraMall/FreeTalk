import { describe, expect, it } from 'vitest';
import { parseRoomDeepLink, roomInviteUrl } from './deep-link';

const code = 'ABCDEFGH2345';

describe('room deep links', () => {
  it('creates a public HTTPS invitation and parses both supported forms', () => {
    expect(roomInviteUrl(code)).toBe(`https://freetalk.191-44-38-60.sslip.io/join/${code}`);
    expect(parseRoomDeepLink(`freetalk://join/${code}`)).toBe(code);
    expect(parseRoomDeepLink(`freetalk://room/${code}`)).toBe(code);
    expect(parseRoomDeepLink(roomInviteUrl(code))).toBe(code);
  });

  it('rejects foreign origins, extra paths and malformed room codes', () => {
    expect(parseRoomDeepLink(`https://example.com/join/${code}`)).toBeNull();
    expect(parseRoomDeepLink(`https://freetalk.191-44-38-60.sslip.io/other/${code}`)).toBeNull();
    expect(
      parseRoomDeepLink(`https://freetalk.191-44-38-60.sslip.io/join/${code}/extra`),
    ).toBeNull();
    expect(parseRoomDeepLink(`freetalk://join/${code}/extra`)).toBeNull();
    expect(parseRoomDeepLink('freetalk://join/not-a-room')).toBeNull();
  });
});

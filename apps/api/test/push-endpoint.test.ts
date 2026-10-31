import { describe, expect, it } from 'vitest';
import { isTrustedPushEndpoint } from '../src/push-endpoint.js';

describe('push delivery destinations', () => {
  it.each([
    'https://fcm.googleapis.com/wp/token',
    'https://updates.push.services.mozilla.com/wpush/v2/token',
    'https://web.push.apple.com/token',
    'https://wns2-par02p.notify.windows.com/w/?token=secret',
  ])('accepts browser push provider %s', (url) => {
    expect(isTrustedPushEndpoint(url)).toBe(true);
  });
  it.each([
    'http://fcm.googleapis.com/wp/token',
    'https://127.0.0.1/api',
    'http://169.254.169.254/latest/meta-data/',
    'https://[::1]/',
    'https://localhost/',
    'https://fcm.googleapis.com.attacker.example/',
    'https://attacker.example/?host=fcm.googleapis.com',
    'https://fcm.googleapis.com@attacker.example/',
    'https://user:password@fcm.googleapis.com/',
    'https://fcm.googleapis.com:8443/',
    'https://attacker.notify.windows.com.example/',
    'https://web.push.apple.com/#fragment',
    'file:///etc/passwd',
    'invalid',
  ])('rejects arbitrary destination %s', (url) => {
    expect(isTrustedPushEndpoint(url)).toBe(false);
  });
});

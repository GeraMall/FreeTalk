// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearBrowserActiveCall,
  readBrowserActiveCall,
  saveBrowserActiveCall,
} from './active-call-resume';

const NOW = 1_760_000_000_000;

afterEach(() => {
  clearBrowserActiveCall();
  vi.restoreAllMocks();
});

describe('browser active call resume', () => {
  it('restores a recent call for the same account', () => {
    saveBrowserActiveCall({
      roomId: 'ABCD1234EFGH',
      chatId: 'chat-1',
      accountId: 'account-1',
      savedAt: NOW,
    });

    expect(readBrowserActiveCall('account-1', NOW + 5_000)).toEqual({
      roomId: 'ABCD1234EFGH',
      chatId: 'chat-1',
      accountId: 'account-1',
      savedAt: NOW,
    });
  });

  it('does not restore another account call', () => {
    saveBrowserActiveCall({
      roomId: 'ABCD1234EFGH',
      accountId: 'account-1',
      savedAt: NOW,
    });

    expect(readBrowserActiveCall('account-2', NOW)).toBeUndefined();
    expect(readBrowserActiveCall('account-1', NOW)).toBeUndefined();
  });

  it('removes expired and malformed entries', () => {
    saveBrowserActiveCall({
      roomId: 'ABCD1234EFGH',
      accountId: 'account-1',
      savedAt: NOW - 25 * 60 * 60 * 1_000,
    });
    expect(readBrowserActiveCall('account-1', NOW)).toBeUndefined();

    localStorage.setItem('trlka.browser.active-call.v1', '{broken');
    expect(readBrowserActiveCall('account-1', NOW)).toBeUndefined();
  });
});

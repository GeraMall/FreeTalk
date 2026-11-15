// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createNativeSettingsBridge } from './native-settings-bridge';

afterEach(() => {
  delete window.TRLKANativeSettings;
  delete window.receiveNativeSettings;
  vi.useRealTimers();
});

it('ignores replies from a previous settings page after a language reload', async () => {
  vi.useFakeTimers();
  const messages: Array<{ id: number; client: string }> = [];
  window.TRLKANativeSettings = { postMessage: (raw) => messages.push(JSON.parse(raw)) };
  const oldRequest = createNativeSettingsBridge().request('profile.save');
  const expired = expect(oldRequest).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
  const current = createNativeSettingsBridge().request('bootstrap');
  const resolved = vi.fn();
  void current.then(resolved);
  window.receiveNativeSettings?.({ ...messages[0], result: 'old account' });
  await Promise.resolve();
  expect(resolved).not.toHaveBeenCalled();
  window.receiveNativeSettings?.({ ...messages[1], result: 'current account' });
  await expect(current).resolves.toBe('current account');
  await vi.advanceTimersByTimeAsync(60_001);
  await expired;
});

it('preserves native account error codes and cleans failed bridge sends', async () => {
  vi.useFakeTimers();
  let message!: { id: number; client: string };
  window.TRLKANativeSettings = {
    postMessage: (raw) => {
      message = JSON.parse(raw);
    },
  };
  const host = createNativeSettingsBridge();
  const result = host.request('profile.save');
  const rejected = expect(result).rejects.toMatchObject({ code: 'USERNAME_TAKEN', status: 409 });
  window.receiveNativeSettings?.({
    ...message,
    error: { code: 'USERNAME_TAKEN', message: 'Имя занято', status: 409 },
  });
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
  window.TRLKANativeSettings.postMessage = () => {
    throw new Error('View closed');
  };
  await expect(host.request('close')).rejects.toThrow('View closed');
  expect(vi.getTimerCount()).toBe(0);
});

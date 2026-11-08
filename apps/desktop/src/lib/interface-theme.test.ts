// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { accountClient } from './api-client';
import { ThemeController, storedInterfaceTheme } from './interface-theme';
const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  localStorage.clear();
  delete document.documentElement.dataset.uiTheme;
  delete document.documentElement.dataset.authScreen;
  vi.restoreAllMocks();
});
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
it('keeps theme changes local by default and restores the device theme', async () => {
  const request = vi
    .spyOn(accountClient, 'request')
    .mockResolvedValue({ appearance: { theme: 'black', syncEnabled: false } });
  const store = new ThemeController();
  cleanups.push(store.connect('self'));
  await tick();
  store.choose('light');
  await tick();
  expect(storedInterfaceTheme()).toBe('light');
  expect(document.documentElement.dataset.uiTheme).toBe('light');
  expect(request.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(0);
  expect(new ThemeController().snapshot().theme).toBe('light');
});
it('downloads only an opted-in account theme and clears account sync at logout', async () => {
  vi.spyOn(accountClient, 'request').mockResolvedValue({
    appearance: { theme: 'black', syncEnabled: true },
  });
  const store = new ThemeController();
  const close = store.connect('self');
  cleanups.push(close);
  await tick();
  expect(store.snapshot()).toMatchObject({ theme: 'black', syncEnabled: true });
  close();
  store.connect();
  expect(store.snapshot()).toMatchObject({ theme: 'black', syncEnabled: false, account: false });
});
it('queues the latest theme when the user changes it while opt-in is being saved', async () => {
  let finish!: (value: unknown) => void;
  const request = vi
    .spyOn(accountClient, 'request')
    .mockResolvedValue({ appearance: { theme: 'default', syncEnabled: false } });
  const store = new ThemeController();
  cleanups.push(store.connect('self'));
  await tick();
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  store.toggleSync(true);
  store.choose('light');
  store.choose('black');
  finish({});
  await tick();
  await tick();
  const writes = request.mock.calls
    .filter(([, options]) => options?.method === 'PUT')
    .map(([, options]) => JSON.parse(String(options!.body)));
  expect(writes).toEqual([
    { theme: 'default', syncEnabled: true },
    { theme: 'black', syncEnabled: true },
  ]);
});
it('preserves the local theme when saving fails and does not claim sync succeeded', async () => {
  const request = vi
    .spyOn(accountClient, 'request')
    .mockResolvedValue({ appearance: { theme: 'default', syncEnabled: false } });
  const store = new ThemeController();
  cleanups.push(store.connect('self'));
  await tick();
  store.choose('light');
  request.mockRejectedValueOnce(Error('offline'));
  store.toggleSync(true);
  await tick();
  expect(store.snapshot()).toMatchObject({
    theme: 'light',
    syncEnabled: false,
    error: true,
    busy: false,
  });
});
it('ignores a late preference response after changing accounts', async () => {
  let finish!: (value: unknown) => void;
  vi.spyOn(accountClient, 'request')
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({ appearance: { theme: 'default', syncEnabled: false } });
  const store = new ThemeController();
  const first = store.connect('first');
  first();
  cleanups.push(store.connect('second'));
  await tick();
  finish({ appearance: { theme: 'black', syncEnabled: true } });
  await tick();
  expect(store.snapshot()).toMatchObject({ theme: 'default', syncEnabled: false });
});

it('keeps the welcome screen dark without discarding the saved account theme', () => {
  const store = new ThemeController();
  document.documentElement.dataset.authScreen = 'true';
  store.choose('light');
  expect(document.documentElement.dataset.uiTheme).toBe('default');
  expect(storedInterfaceTheme()).toBe('light');
  delete document.documentElement.dataset.authScreen;
  store.receiveDeviceTheme('light');
  expect(document.documentElement.dataset.uiTheme).toBe('light');
});

it('does not let a stale poll undo an explicit sync choice', async () => {
  const request = vi
    .spyOn(accountClient, 'request')
    .mockResolvedValue({ appearance: { theme: 'default', syncEnabled: false } });
  const store = new ThemeController();
  cleanups.push(store.connect('self'));
  await tick();
  let finish!: (value: unknown) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const reading = store.refresh();
  store.toggleSync(true);
  await tick();
  finish({ appearance: { theme: 'default', syncEnabled: false } });
  await reading;
  expect(store.snapshot().syncEnabled).toBe(true);
});

it('does not offer a working sync toggle when the server endpoint is unavailable', async () => {
  const request = vi.spyOn(accountClient, 'request').mockRejectedValue({ status: 404 });
  const store = new ThemeController();
  cleanups.push(store.connect('self'));
  await tick();
  store.choose('light');
  store.toggleSync(true);
  await tick();
  expect(store.snapshot()).toMatchObject({
    theme: 'light',
    syncEnabled: false,
    available: false,
    ready: true,
  });
  expect(request.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(0);
});

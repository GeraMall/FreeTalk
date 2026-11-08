// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  check: vi.fn(),
  download: vi.fn(),
  close: vi.fn(),
  install: vi.fn(),
  relaunch: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: native.check }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.4.0-beta.193' }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: native.relaunch }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  Object.assign(window, { __TAURI_INTERNALS__: {} });
  native.check.mockResolvedValue({
    version: '0.4.0-beta.194',
    body: '',
    close: native.close,
    download: native.download,
    install: native.install,
  });
});
afterEach(() => {
  delete window.__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

describe('updater request and progress coordination', () => {
  it('checks once for simultaneous callers', async () => {
    const updater = await import('./updater');
    const statuses = await Promise.all([updater.checkForUpdate(), updater.checkForUpdate()]);
    expect(native.check).toHaveBeenCalledTimes(1);
    expect(statuses[0]).toEqual(statuses[1]);
  });

  it('downloads once, throttles chunks and never moves progress backwards', async () => {
    let finish!: () => void;
    native.download.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    const updater = await import('./updater');
    await updater.checkForUpdate();
    const first = vi.fn();
    const second = vi.fn();
    const a = updater.installPendingUpdate(first);
    const b = updater.installPendingUpdate(second);
    expect(native.download).toHaveBeenCalledTimes(1);
    expect(await updater.checkForUpdate()).toMatchObject({ kind: 'downloading', progress: 0 });
    expect(native.close).not.toHaveBeenCalled();
    const event = native.download.mock.calls[0]![0];
    event({ event: 'Started', data: { contentLength: 10_000 } });
    for (let i = 0; i < 100; i++) event({ event: 'Progress', data: { chunkLength: 1 } });
    expect(first).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(100);
    event({ event: 'Progress', data: { chunkLength: 5_900 } });
    clock.mockReturnValue(200);
    event({ event: 'Started', data: { contentLength: 20_000 } });
    event({ event: 'Progress', data: { chunkLength: 1 } });
    event({ event: 'Finished' });
    finish();
    await Promise.all([a, b]);
    expect(first.mock.calls.map(([status]) => status.progress)).toEqual([0, 60, 100]);
    expect(second.mock.calls.map(([status]) => status.progress)).toEqual([0, 60, 100]);
  });

  it('finishes downloading but defers installation if a call starts; reuses the verified download afterwards', async () => {
    let busy = false;
    native.download.mockImplementation(async () => {
      busy = true;
    });
    const updater = await import('./updater');
    await updater.checkForUpdate();
    const progress = vi.fn();
    expect(await updater.installPendingUpdate(progress, () => !busy)).toBe(false);
    expect(native.install).not.toHaveBeenCalled();
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'available', downloaded: true }),
    );
    expect(await updater.checkForUpdate()).toMatchObject({ kind: 'available', downloaded: true });
    expect(native.check).toHaveBeenCalledOnce();
    expect(native.close).not.toHaveBeenCalled();
    busy = false;
    expect(await updater.installPendingUpdate(progress, () => !busy)).toBe(true);
    expect(native.download).toHaveBeenCalledOnce();
    expect(native.install).toHaveBeenCalledOnce();
  });
  it('does not apply or relaunch an automatic update after its setting is disabled during download', async () => {
    let enabled = true;
    native.download.mockImplementation(async () => {
      enabled = false;
    });
    const updater = await import('./updater');
    await updater.checkForUpdate();
    expect(await updater.installPendingUpdate(vi.fn(), () => enabled)).toBe(false);
    expect(native.install).not.toHaveBeenCalled();
    expect(native.relaunch).not.toHaveBeenCalled();
  });
  it('releases the install lock after a download error so a retry can succeed', async () => {
    native.download.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    const updater = await import('./updater');
    await updater.checkForUpdate();
    await expect(updater.installPendingUpdate(vi.fn())).rejects.toThrow('offline');
    await updater.installPendingUpdate(vi.fn());
    expect(native.download).toHaveBeenCalledTimes(2);
  });
});

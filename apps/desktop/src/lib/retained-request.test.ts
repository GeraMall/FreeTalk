import { afterEach, describe, expect, it, vi } from 'vitest';
import { RetainedRequest } from './retained-request';

afterEach(() => vi.useRealTimers());

describe('retained navigation requests', () => {
  it('coalesces repeated navigation, including a loaded empty response', async () => {
    const resource = new RetainedRequest();
    let finish!: () => void;
    const load = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const first = resource.run(load);
    const repeated = resource.run(load);
    expect(repeated).toBe(first);
    await Promise.resolve();
    finish();
    await first;
    expect(resource.loaded).toBe(true);
    await resource.run(load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('refreshes stale data while preserving the loaded state', async () => {
    vi.useFakeTimers();
    const resource = new RetainedRequest();
    const load = vi.fn(async () => undefined);
    await resource.run(load);
    vi.advanceTimersByTime(30_001);
    await resource.run(load);
    expect(resource.loaded).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('queues one fresh snapshot after an in-flight request when data is mutated', async () => {
    const resource = new RetainedRequest();
    let finish!: () => void;
    const first = resource.run(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await Promise.resolve();
    const fresh = vi.fn(async () => undefined);
    const refresh = resource.run(fresh, true);
    expect(resource.run(fresh, true)).toBe(refresh);
    finish();
    await Promise.all([first, refresh]);
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it('allows retry after a failed first load and retains data after a failed refresh', async () => {
    const resource = new RetainedRequest();
    const fail = async () => {
      throw new Error('offline');
    };
    await expect(resource.run(fail)).rejects.toThrow('offline');
    expect(resource.loaded).toBe(false);
    await resource.run(async () => undefined, true);
    await expect(resource.run(fail, true)).rejects.toThrow('offline');
    expect(resource.loaded).toBe(true);
  });

  it('backs off failed navigation requests but permits an explicit retry', async () => {
    vi.useFakeTimers();
    const resource = new RetainedRequest();
    const load = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(resource.run(load)).rejects.toThrow('offline');
    await expect(resource.run(load)).rejects.toThrow('offline');
    expect(load).toHaveBeenCalledTimes(1);
    await expect(resource.run(load, true)).rejects.toThrow('offline');
    vi.advanceTimersByTime(3_001);
    await expect(resource.run(load)).rejects.toThrow('offline');
    expect(load).toHaveBeenCalledTimes(3);
  });
});

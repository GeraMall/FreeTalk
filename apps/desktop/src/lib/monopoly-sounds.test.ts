// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { MonopolySounds } from './monopoly-sounds';
vi.mock('./settings', () => ({ loadSettings: () => ({ outputVolume: 0.7, outputDeviceId: '' }) }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('stops dice at the shared roll deadline and leaves unrelated sound effects alone', async () => {
  vi.useFakeTimers();
  const made: {
    src: string;
    currentTime: number;
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
  }[] = [];
  vi.stubGlobal(
    'Audio',
    class {
      src: string;
      volume = 0;
      preload = '';
      currentTime = 0;
      onended = null;
      onerror = null;
      play = vi.fn().mockResolvedValue(undefined);
      pause = vi.fn();
      constructor(src: string) {
        this.src = src;
        made.push(this);
      }
    },
  );
  const sounds = new MonopolySounds();
  await sounds.play('roll', { offsetMs: 700, remainingMs: 200 });
  await sounds.play('card');
  expect(made[0]!.currentTime).toBe(0.7);
  vi.advanceTimersByTime(199);
  expect(made[0]!.pause).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(made[0]!.pause).toHaveBeenCalledOnce();
  expect(made[1]!.pause).not.toHaveBeenCalled();
  await sounds.play('shake');
  sounds.stopDice();
  expect(made[2]!.pause).toHaveBeenCalledOnce();
  expect(made[1]!.pause).not.toHaveBeenCalled();
  sounds.stop();
  expect(made[1]!.pause).toHaveBeenCalledOnce();
});

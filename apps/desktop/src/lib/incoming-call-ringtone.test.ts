import { describe, expect, it, vi } from 'vitest';
import { IncomingCallRingtone } from './incoming-call-ringtone';

function audioHarness() {
  return {
    preload: '',
    loop: false,
    volume: 0,
    currentTime: 12,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    setSinkId: vi.fn().mockResolvedValue(undefined),
  };
}

describe('incoming call ringtone', () => {
  it('loops on the selected output at the configured volume', async () => {
    const audio = audioHarness();
    const ringtone = new IncomingCallRingtone(() => audio as unknown as HTMLAudioElement);

    await ringtone.start({ outputDeviceId: 'headphones', outputVolume: 0.64 });

    expect(audio.preload).toBe('auto');
    expect(audio.loop).toBe(true);
    expect(audio.volume).toBe(0.64);
    expect(audio.setSinkId).toHaveBeenCalledWith('headphones');
    expect(audio.play).toHaveBeenCalledOnce();
  });

  it('stops and rewinds the ringtone', async () => {
    const audio = audioHarness();
    const ringtone = new IncomingCallRingtone(() => audio as unknown as HTMLAudioElement);
    await ringtone.start({ outputDeviceId: '', outputVolume: 1 });

    ringtone.stop();

    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.currentTime).toBe(0);
  });
});

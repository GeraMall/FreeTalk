import { describe, expect, it } from 'vitest';
import {
  MICROPHONE_SOUND_URLS,
  microphoneSoundUrl,
  microphoneSoundVolume,
} from './microphone-sounds';

describe('microphone toggle sounds', () => {
  it('uses the enabled sound after unmuting', () => {
    expect(microphoneSoundUrl(false)).toBe(MICROPHONE_SOUND_URLS.enabled);
  });

  it('uses the disabled sound after muting', () => {
    expect(microphoneSoundUrl(true)).toBe(MICROPHONE_SOUND_URLS.disabled);
  });

  it('plays both microphone signals twenty percent below the output volume', () => {
    expect(microphoneSoundVolume(1)).toBe(0.8);
    expect(microphoneSoundVolume(0.5)).toBe(0.4);
  });
});

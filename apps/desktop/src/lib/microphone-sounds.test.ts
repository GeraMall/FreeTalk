import { describe, expect, it } from 'vitest';
import { MICROPHONE_SOUND_URLS, microphoneSoundUrl } from './microphone-sounds';

describe('microphone toggle sounds', () => {
  it('uses the enabled sound after unmuting', () => {
    expect(microphoneSoundUrl(false)).toBe(MICROPHONE_SOUND_URLS.enabled);
  });

  it('uses the disabled sound after muting', () => {
    expect(microphoneSoundUrl(true)).toBe(MICROPHONE_SOUND_URLS.disabled);
  });
});

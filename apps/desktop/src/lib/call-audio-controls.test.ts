import { describe, expect, it } from 'vitest';
import { callAudioReducer as reduce, INITIAL_CALL_AUDIO as initial } from './call-audio-controls';
describe('linked microphone and headphone controls', () => {
  it('deafens and mutes together, then enables hearing when the microphone is enabled', () => {
    const off = reduce(initial, { type: 'deafen', deafened: true });
    expect(off).toMatchObject({ muted: true, deafened: true });
    expect(reduce(off, { type: 'mute', muted: false })).toMatchObject({
      muted: false,
      deafened: false,
    });
  });
  it('restores an enabled microphone when headphones are enabled again', () => {
    const off = reduce(initial, { type: 'deafen', deafened: true });
    expect(reduce(off, { type: 'deafen', deafened: false })).toMatchObject({
      muted: false,
      deafened: false,
    });
  });
  it('preserves a previously muted microphone and does not undo moderation', () => {
    const muted = reduce(initial, { type: 'mute', muted: true });
    const off = reduce(muted, { type: 'deafen', deafened: true });
    expect(reduce(off, { type: 'deafen', deafened: false })).toMatchObject({
      muted: true,
      deafened: false,
    });
    const moderated = reduce(reduce(initial, { type: 'deafen', deafened: true }), {
      type: 'mute',
      muted: true,
    });
    expect(reduce(moderated, { type: 'deafen', deafened: false }).muted).toBe(true);
  });
  it('keeps deafened audio muted across repeated toggles and explicit mute actions', () => {
    let state = initial;
    for (let i = 0; i < 100; i++) {
      for (const action of [
        { type: 'deafen', deafened: true },
        { type: 'mute', muted: true },
        { type: 'deafen', deafened: false },
        { type: 'mute', muted: false },
      ] as const) {
        state = reduce(state, action);
        expect(state.deafened && !state.muted).toBe(false);
      }
    }
  });
});

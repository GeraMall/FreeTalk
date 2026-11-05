import { describe, expect, it } from 'vitest';
import { clientMessageSchema, serverMessageSchema, mergeParticipantAudioState } from '../src/index';
describe('headphone state compatibility', () => {
  it('accepts old and new clients and server messages', () => {
    for (const state of [
      { muted: true },
      { muted: true, deafened: true },
      { muted: false, deafened: false },
    ]) {
      expect(clientMessageSchema.parse({ type: 'mute-changed', ...state })).toEqual({
        type: 'mute-changed',
        ...state,
      });
      expect(
        serverMessageSchema.parse({
          type: 'mute-changed',
          participantId: '286d39ef-61af-4aca-84b8-47f78b0f554a',
          ...state,
        }),
      ).toMatchObject(state);
    }
  });
  it('never advertises an enabled microphone while headphones are off', () => {
    expect(mergeParticipantAudioState({ muted: false }, { muted: false, deafened: true })).toEqual({
      muted: true,
      deafened: true,
    });
  });
  it('preserves headphones for old moderation updates but clears them for an old explicit unmute', () => {
    const old = { muted: true, deafened: true };
    expect(mergeParticipantAudioState(old, { muted: true })).toEqual(old);
    expect(mergeParticipantAudioState(old, { muted: false })).toEqual({
      muted: false,
      deafened: false,
    });
  });
});

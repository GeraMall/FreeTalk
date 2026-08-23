import { describe, expect, it } from 'vitest';
import {
  activeRms,
  equalizationGains,
  ParticipantNotificationTracker,
} from './notification-sounds';

describe('notification sound equalization', () => {
  it('attenuates the louder sound until both active RMS levels match', () => {
    const quiet = activeRms([new Float32Array([0, 0.1, -0.1, 0])]);
    const loud = activeRms([new Float32Array([0, 0.2, -0.2, 0])]);
    const gains = equalizationGains({ joined: quiet, disconnected: loud });

    expect(gains.joined).toBeCloseTo(1);
    expect(gains.disconnected).toBeCloseTo(0.5);
    expect(quiet * gains.joined).toBeCloseTo(loud * gains.disconnected);
  });

  it('falls back to equal playback gain for an invalid or silent asset', () => {
    expect(equalizationGains({ joined: 0, disconnected: 0.2 })).toEqual({
      joined: 1,
      disconnected: 1,
    });
  });
});

describe('participant notification tracking', () => {
  it('ignores the initial snapshot, self, and duplicate reconnect events', () => {
    const tracker = new ParticipantNotificationTracker();
    tracker.reset(['self', 'already-here']);

    expect(tracker.joined('self', 'self')).toBe(false);
    expect(tracker.joined('already-here', 'self')).toBe(false);
    expect(tracker.joined('friend', 'self')).toBe(true);
    expect(tracker.joined('friend', 'self')).toBe(false);
  });

  it('notifies once when a known friend disconnects', () => {
    const tracker = new ParticipantNotificationTracker();
    tracker.reset(['self', 'friend']);

    expect(tracker.disconnected('self', 'self')).toBe(false);
    expect(tracker.disconnected('friend', 'self')).toBe(true);
    expect(tracker.disconnected('friend', 'self')).toBe(false);
  });
});

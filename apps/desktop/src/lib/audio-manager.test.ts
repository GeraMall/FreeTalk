import { describe, expect, it, vi } from 'vitest';
import { AudioManager } from './audio-manager';

describe('AudioManager transmission gates', () => {
  it('controls the actual MediaStreamTrack.enabled flag for mute and PTT', () => {
    const track = { enabled: true, stop: vi.fn() };
    const manager = new AudioManager(
      () => undefined,
      () => undefined,
      {
        transmissionMode: 'push-to-talk',
        vadThreshold: 0.045,
        noiseSuppression: true,
        autoGainControl: true,
        echoCancellation: true,
        comfortNoise: false,
      },
    );
    (manager as unknown as { stream: { getAudioTracks(): (typeof track)[] } }).stream = {
      getAudioTracks: () => [track],
    };

    manager.setPushToTalkPressed(false);
    expect(track.enabled).toBe(false);
    manager.setPushToTalkPressed(true);
    expect(track.enabled).toBe(true);
    manager.setMuted(true);
    expect(track.enabled).toBe(false);
    manager.setMuted(false);
    expect(track.enabled).toBe(true);
    manager.setPushToTalkPressed(false);
    expect(track.enabled).toBe(false);
  });

  it('supports continuous, voice activation and typing suppression modes', () => {
    const track = { enabled: false, stop: vi.fn() };
    const manager = new AudioManager(
      () => undefined,
      () => undefined,
      {
        transmissionMode: 'continuous',
        vadThreshold: 0.045,
        noiseSuppression: true,
        autoGainControl: true,
        echoCancellation: true,
        comfortNoise: false,
      },
    );
    (manager as unknown as { stream: { getAudioTracks(): (typeof track)[] } }).stream = {
      getAudioTracks: () => [track],
    };

    manager.setSettings({
      transmissionMode: 'continuous',
      vadThreshold: 0.045,
      noiseSuppression: true,
      autoGainControl: true,
      echoCancellation: true,
      comfortNoise: false,
    });
    expect(track.enabled).toBe(true);
    manager.setTypingSuppressed(true);
    expect(track.enabled).toBe(false);
    manager.setTypingSuppressed(false);
    expect(track.enabled).toBe(true);

    manager.setSettings({
      transmissionMode: 'voice-activation',
      vadThreshold: 0.045,
      noiseSuppression: true,
      autoGainControl: true,
      echoCancellation: true,
      comfortNoise: false,
    });
    expect(track.enabled).toBe(false);
    (manager as unknown as { voiceActive: boolean }).voiceActive = true;
    manager.setMuted(false);
    expect(track.enabled).toBe(true);
  });
});

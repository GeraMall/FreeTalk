import { describe, expect, it } from 'vitest';
import { recordingFileName } from './recording-storage';

describe('recording storage', () => {
  it('creates filesystem-safe timestamped names for WebM and MP4 recordings', () => {
    const date = new Date('2026-08-30T09:15:42.123Z');
    expect(recordingFileName(date)).toBe('FreeTalk_2026-08-30_09-15-42.webm');
    expect(recordingFileName(date, 'mp4')).toBe('FreeTalk_2026-08-30_09-15-42.mp4');
  });
});

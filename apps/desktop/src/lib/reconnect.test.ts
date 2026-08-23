import { describe, expect, it } from 'vitest';
import { ReconnectSchedule } from './reconnect';
import { generateRoomCode, parseRoomCode } from './room-code';

describe('reconnect schedule', () => {
  it('backs off and caps the delay', () => {
    const schedule = new ReconnectSchedule();
    expect([schedule.next(), schedule.next(), schedule.next()]).toEqual([500, 1000, 2000]);
    for (let i = 0; i < 20; i++) schedule.next();
    expect(schedule.next()).toBe(30_000);
    schedule.reset();
    expect(schedule.next()).toBe(500);
  });

  it('stops offering reconnect attempts after the configured limit', () => {
    const schedule = new ReconnectSchedule();
    expect(schedule.canRetry).toBe(true);
    for (let attempt = 0; attempt < 8; attempt++) schedule.next();
    expect(schedule.attempts).toBe(8);
    expect(schedule.canRetry).toBe(false);
  });
});

describe('room code', () => {
  it('uses the expected alphabet and parses invite links', () => {
    const code = generateRoomCode();
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/);
    expect(parseRoomCode(`freetalk://join/${code}`)).toBe(code);
  });
});

import { describe, expect, it } from 'vitest';
import { ChatSendPacer } from '../src/chat-send-pacer';

describe('ChatSendPacer', () => {
  it('allows six quick sends and puts the seventh attempt into slow mode', () => {
    const pacer = new ChatSendPacer();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      expect(pacer.check('chat:user', 1_000 + attempt * 100)).toEqual({ limited: false });
    }
    expect(pacer.check('chat:user', 1_600)).toEqual({
      limited: true,
      retryAfterSeconds: 30,
      blockedUntil: 31_600,
    });
    expect(pacer.check('chat:user', 2_600)).toMatchObject({
      limited: true,
      retryAfterSeconds: 29,
    });
  });

  it('isolates chats and users and unlocks after the cooldown', () => {
    const pacer = new ChatSendPacer();
    for (let attempt = 0; attempt < 7; attempt += 1) pacer.check('chat-a:user-a', attempt);

    expect(pacer.check('chat-a:user-b', 10)).toEqual({ limited: false });
    expect(pacer.check('chat-b:user-a', 10)).toEqual({ limited: false });
    expect(pacer.check('chat-a:user-a', 30_006)).toEqual({ limited: false });
  });

  it('does not count messages outside the rapid-send window', () => {
    const pacer = new ChatSendPacer();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(pacer.check('chat:user', attempt * 10_001)).toEqual({ limited: false });
    }
  });
});

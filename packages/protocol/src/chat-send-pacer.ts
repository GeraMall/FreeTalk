export const CHAT_SPAM_MAX_ATTEMPTS = 7;
export const CHAT_SPAM_WINDOW_MS = 10_000;
export const CHAT_SLOW_MODE_MS = 30_000;

export type ChatSendPacingResult =
  { limited: false } | { limited: true; retryAfterSeconds: number; blockedUntil: number };

interface ChatSendPacingState {
  attempts: number[];
  blockedUntil: number;
  lastSeen: number;
}

/**
 * Small in-memory sliding-window guard used by both the desktop client and API.
 * The API instance remains authoritative; the client instance only makes the
 * warning immediate instead of waiting for a round trip.
 */
export class ChatSendPacer {
  private readonly states = new Map<string, ChatSendPacingState>();
  private checks = 0;

  constructor(
    private readonly maxAttempts = CHAT_SPAM_MAX_ATTEMPTS,
    private readonly windowMs = CHAT_SPAM_WINDOW_MS,
    private readonly slowModeMs = CHAT_SLOW_MODE_MS,
  ) {}

  check(key: string, now = Date.now()): ChatSendPacingResult {
    this.checks += 1;
    if (this.checks % 100 === 0) this.prune(now);

    const current = this.states.get(key) ?? {
      attempts: [],
      blockedUntil: 0,
      lastSeen: now,
    };
    current.lastSeen = now;

    if (current.blockedUntil > now) {
      this.states.set(key, current);
      return this.limited(current.blockedUntil, now);
    }

    if (current.blockedUntil) {
      current.blockedUntil = 0;
      current.attempts = [];
    }

    const windowStart = now - this.windowMs;
    current.attempts = current.attempts.filter((attempt) => attempt > windowStart);
    if (current.attempts.length >= this.maxAttempts - 1) {
      current.attempts = [];
      current.blockedUntil = now + this.slowModeMs;
      this.states.set(key, current);
      return this.limited(current.blockedUntil, now);
    }

    current.attempts.push(now);
    this.states.set(key, current);
    return { limited: false };
  }

  private limited(blockedUntil: number, now: number): ChatSendPacingResult {
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - now) / 1_000)),
      blockedUntil,
    };
  }

  private prune(now: number) {
    const staleBefore = now - Math.max(this.windowMs, this.slowModeMs) * 2;
    for (const [key, state] of this.states) {
      if (state.lastSeen < staleBefore && state.blockedUntil <= now) this.states.delete(key);
    }
  }
}

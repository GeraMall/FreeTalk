import { MAX_RECONNECT_ATTEMPTS, RECONNECT_DELAYS_MS } from '@freetalk/config';

export class ReconnectSchedule {
  private attempt = 0;
  constructor(private readonly options: { unlimited?: boolean; jitter?: boolean } = {}) {}
  next() {
    const base = RECONNECT_DELAYS_MS[Math.min(this.attempt++, RECONNECT_DELAYS_MS.length - 1)];
    // Spread returning clients over time instead of reconnecting an entire failed node at once.
    return this.options.jitter ? Math.round(base * (0.8 + Math.random() * 0.4)) : base;
  }
  reset() {
    this.attempt = 0;
  }
  get attempts() {
    return this.attempt;
  }
  get canRetry() {
    return this.options.unlimited || this.attempt < MAX_RECONNECT_ATTEMPTS;
  }
}

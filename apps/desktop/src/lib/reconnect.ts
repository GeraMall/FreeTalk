import { MAX_RECONNECT_ATTEMPTS, RECONNECT_DELAYS_MS } from '@freetalk/config';

export class ReconnectSchedule {
  private attempt = 0;
  next() {
    return RECONNECT_DELAYS_MS[Math.min(this.attempt++, RECONNECT_DELAYS_MS.length - 1)];
  }
  reset() {
    this.attempt = 0;
  }
  get attempts() {
    return this.attempt;
  }
  get canRetry() {
    return this.attempt < MAX_RECONNECT_ATTEMPTS;
  }
}

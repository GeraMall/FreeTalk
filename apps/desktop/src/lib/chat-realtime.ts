import {
  parseChatRealtimeServerMessage,
  type ChatRealtimeServerMessage,
  type PresenceStatus,
} from '@freetalk/protocol';
import { accountClient, accountRealtimeUrl } from './api-client';

const MAX_RECONNECT_DELAY_MS = 30_000;
const CONNECT_TIMEOUT_MS = 10_000;
export const AWAY_AFTER_MS = 10 * 60 * 1_000;

export class ChatRealtimeClient {
  private socket?: WebSocket;
  private retryTimer?: number;
  private stopped = true;
  private attempt = 0;
  private lastActivityAt = Date.now();
  private lastActivitySignalAt = 0;
  private awayTimer?: number;
  private currentPresence: PresenceStatus = 'offline';

  constructor(
    private readonly onEvent: (event: ChatRealtimeServerMessage) => void,
    private readonly onSelfPresence?: (status: PresenceStatus) => void,
  ) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.attachActivityListeners();
    this.scheduleAway();
    void this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer !== undefined) window.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.socket?.close(1000, 'Client stopped');
    this.socket = undefined;
    this.detachActivityListeners();
    if (this.awayTimer !== undefined) window.clearTimeout(this.awayTimer);
    this.awayTimer = undefined;
    this.updateSelfPresence('offline');
  }

  private async connect() {
    if (this.stopped) return;
    try {
      const token = await accountClient.realtimeAccessToken();
      if (this.stopped) return;
      const socket = new WebSocket(accountRealtimeUrl());
      this.socket = socket;
      const connectTimeout = window.setTimeout(() => socket.close(), CONNECT_TIMEOUT_MS);

      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ type: 'authenticate', token }));
      });
      socket.addEventListener('message', (event) => {
        try {
          const message = parseChatRealtimeServerMessage(String(event.data));
          if (message.type === 'ready') {
            this.attempt = 0;
            window.clearTimeout(connectTimeout);
            this.sendPresence(
              Date.now() - this.lastActivityAt >= AWAY_AFTER_MS ? 'away' : 'online',
            );
            return;
          }
          this.onEvent(message);
        } catch {
          // Ignore malformed server data without breaking subsequent realtime events.
        }
      });
      socket.addEventListener('close', () => {
        window.clearTimeout(connectTimeout);
        if (this.socket === socket) this.socket = undefined;
        this.updateSelfPresence('offline');
        this.scheduleReconnect();
      });
    } catch {
      this.scheduleReconnect();
    }
  }

  private readonly markActive = () => {
    const now = Date.now();
    if (this.currentPresence !== 'away' && now - this.lastActivitySignalAt < 1_000) return;
    this.lastActivitySignalAt = now;
    this.lastActivityAt = now;
    if (this.currentPresence === 'away') this.sendPresence('online');
    this.scheduleAway();
  };

  private attachActivityListeners() {
    for (const event of ['pointerdown', 'keydown', 'mousemove', 'touchstart', 'focus'])
      window.addEventListener(event, this.markActive, { passive: true });
  }

  private detachActivityListeners() {
    for (const event of ['pointerdown', 'keydown', 'mousemove', 'touchstart', 'focus'])
      window.removeEventListener(event, this.markActive);
  }

  private scheduleAway() {
    if (this.awayTimer !== undefined) window.clearTimeout(this.awayTimer);
    this.awayTimer = window.setTimeout(() => this.sendPresence('away'), AWAY_AFTER_MS);
  }

  private sendPresence(status: 'online' | 'away') {
    if (this.socket && this.socket.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify({ type: 'presence', status }));
    this.updateSelfPresence(status);
  }

  private updateSelfPresence(status: PresenceStatus) {
    if (this.currentPresence === status) return;
    this.currentPresence = status;
    this.onSelfPresence?.(status);
  }

  private scheduleReconnect() {
    if (this.stopped || this.retryTimer !== undefined) return;
    const delay = Math.min(1_000 * 2 ** this.attempt, MAX_RECONNECT_DELAY_MS);
    this.attempt += 1;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = undefined;
      void this.connect();
    }, delay);
  }
}

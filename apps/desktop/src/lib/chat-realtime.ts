import {
  parseChatRealtimeServerMessage,
  type ChatRealtimeServerMessage,
  type PresenceStatus,
} from '@freetalk/protocol';
import { accountClient, accountRealtimeUrl } from './api-client';
import {
  createAccountSocket,
  type SignalSocket,
  type SignalCloseDetails,
} from './signaling-transport';
import {
  ACCOUNT_PRESENCE_EVENT,
  CALL_ACTIVITY_EVENT,
  VOICE_ACTIVITY_EVENT,
} from './presence-activity';
import {
  getPresenceMode,
  PRESENCE_MODE_EVENT,
  resolvePresence,
  type PresenceMode,
} from './presence-preference';

const MAX_RECONNECT_DELAY_MS = 30_000;
const CONNECT_TIMEOUT_MS = 10_000;
export const AWAY_AFTER_MS = 5 * 60 * 1_000;

export class ChatRealtimeClient {
  private socket?: SignalSocket;
  private generation = 0;
  private retryTimer?: number;
  private stopped = true;
  private attempt = 0;
  private lastActivityAt = Date.now();
  private lastActivitySignalAt = 0;
  private awayTimer?: number;
  private currentPresence: PresenceStatus = 'offline';
  private presenceMode: PresenceMode = getPresenceMode();

  constructor(
    private readonly onEvent: (event: ChatRealtimeServerMessage) => void,
    private readonly onSelfPresence?: (status: PresenceStatus) => void,
    private readonly onReady?: () => void,
  ) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.attachActivityListeners();
    window.addEventListener(PRESENCE_MODE_EVENT, this.handlePresenceModeChange);
    window.addEventListener(CALL_ACTIVITY_EVENT, this.handleCallActivityChange);
    window.addEventListener(VOICE_ACTIVITY_EVENT, this.markActive);
    window.addEventListener('online', this.handleNetworkOnline);
    this.scheduleAway();
    void this.connect();
  }

  stop() {
    this.stopped = true;
    this.generation += 1;
    if (this.retryTimer !== undefined) window.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    socket?.close(1000, 'Client stopped');
    this.detachActivityListeners();
    window.removeEventListener(PRESENCE_MODE_EVENT, this.handlePresenceModeChange);
    window.removeEventListener(CALL_ACTIVITY_EVENT, this.handleCallActivityChange);
    window.removeEventListener(VOICE_ACTIVITY_EVENT, this.markActive);
    window.removeEventListener('online', this.handleNetworkOnline);
    if (this.awayTimer !== undefined) window.clearTimeout(this.awayTimer);
    this.awayTimer = undefined;
    this.updateSelfPresence('offline');
  }

  private async connect() {
    if (this.stopped) return;
    const generation = ++this.generation;
    try {
      const token = await accountClient.realtimeAccessToken();
      if (this.stopped || generation !== this.generation) return;
      const socket = createAccountSocket(accountRealtimeUrl());
      this.socket = socket;
      const connectTimeout = window.setTimeout(() => socket.close(), CONNECT_TIMEOUT_MS);

      socket.addEventListener('open', () => {
        if (this.stopped || this.socket !== socket) return;
        socket.send(JSON.stringify({ type: 'authenticate', token }));
      });
      socket.addEventListener('message', (event) => {
        if (this.stopped || this.socket !== socket) return;
        try {
          const message = parseChatRealtimeServerMessage(String((event as MessageEvent).data));
          if (message.type === 'ready') {
            this.attempt = 0;
            window.clearTimeout(connectTimeout);
            this.sendPresence(this.resolvedPresence());
            this.onReady?.();
            return;
          }
          if (message.type === 'presence-updated')
            window.dispatchEvent(new CustomEvent(ACCOUNT_PRESENCE_EVENT, { detail: message }));
          this.onEvent(message);
        } catch {
          // Ignore malformed server data without breaking subsequent realtime events.
        }
      });
      socket.addEventListener('close', (event) => {
        window.clearTimeout(connectTimeout);
        if (this.stopped || this.socket !== socket) return;
        this.socket = undefined;
        this.updateSelfPresence('offline');
        const details =
          event instanceof MessageEvent
            ? (event.data as SignalCloseDetails)
            : (event as CloseEvent);
        if (details.code === 4401 && details.reason === 'Session ended') {
          this.stop();
          window.location.reload();
          return;
        }
        this.scheduleReconnect();
      });
    } catch {
      if (!this.stopped && generation === this.generation) this.scheduleReconnect();
    }
  }

  private readonly handleNetworkOnline = () => {
    if (this.stopped || this.socket) return;
    if (this.retryTimer !== undefined) window.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.attempt = 0;
    void this.connect();
  };

  private readonly markActive = () => {
    const now = Date.now();
    if (this.presenceMode !== 'auto') return;
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
    this.awayTimer = undefined;
    if (this.presenceMode === 'auto')
      this.awayTimer = window.setTimeout(
        () => this.sendPresence('away'),
        Math.max(0, AWAY_AFTER_MS - (Date.now() - this.lastActivityAt)),
      );
  }

  private readonly handlePresenceModeChange = (event: Event) => {
    this.presenceMode = (event as CustomEvent<PresenceMode>).detail;
    if (this.presenceMode === 'auto') this.lastActivityAt = Date.now();
    this.scheduleAway();
    this.sendPresence(this.resolvedPresence());
  };

  private resolvedPresence() {
    return resolvePresence(this.presenceMode, Date.now() - this.lastActivityAt >= AWAY_AFTER_MS);
  }

  private readonly handleCallActivityChange = () => {
    this.lastActivityAt = Date.now();
    this.scheduleAway();
    this.sendPresence(this.resolvedPresence());
  };

  private sendPresence(status: PresenceStatus) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify({ type: 'presence', status }));
    this.updateSelfPresence(status);
  }

  private updateSelfPresence(status: PresenceStatus) {
    if (this.currentPresence === status) return;
    this.currentPresence = status;
    if (accountClient.user?.id)
      window.dispatchEvent(
        new CustomEvent(ACCOUNT_PRESENCE_EVENT, {
          detail: { userId: accountClient.user.id, status },
        }),
      );
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

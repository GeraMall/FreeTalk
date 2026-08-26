import { parseChatRealtimeServerMessage, type ChatRealtimeServerMessage } from '@freetalk/protocol';
import { accountClient, accountRealtimeUrl } from './api-client';

const MAX_RECONNECT_DELAY_MS = 30_000;
const CONNECT_TIMEOUT_MS = 10_000;

export class ChatRealtimeClient {
  private socket?: WebSocket;
  private retryTimer?: number;
  private stopped = true;
  private attempt = 0;

  constructor(private readonly onEvent: (event: ChatRealtimeServerMessage) => void) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    void this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer !== undefined) window.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.socket?.close(1000, 'Client stopped');
    this.socket = undefined;
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
        this.scheduleReconnect();
      });
    } catch {
      this.scheduleReconnect();
    }
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

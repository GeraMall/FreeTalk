import { HEARTBEAT_INTERVAL_MS } from '@freetalk/config';
import { parseServerMessage, type ClientMessage, type ServerMessage } from '@freetalk/protocol';
import { ReconnectSchedule } from './reconnect';

export type SignalingState = 'offline' | 'connecting' | 'connected' | 'reconnecting';

export class SignalingClient {
  private socket?: WebSocket;
  private heartbeat?: number;
  private retryTimer?: number;
  private closedByUser = false;
  private joined?: Extract<ClientMessage, { type: 'create-room' | 'join-room' }>;
  private readonly schedule = new ReconnectSchedule();

  constructor(
    private readonly url: string,
    private readonly onMessage: (message: ServerMessage) => void,
    private readonly onState: (state: SignalingState, attempt?: number) => void,
  ) {}

  connect(join: Extract<ClientMessage, { type: 'create-room' | 'join-room' }>) {
    this.joined = join;
    this.closedByUser = false;
    this.open(false);
  }

  send(message: ClientMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  close() {
    this.closedByUser = true;
    if (this.retryTimer) window.clearTimeout(this.retryTimer);
    if (this.heartbeat) window.clearInterval(this.heartbeat);
    this.send({ type: 'leave-room' });
    this.socket?.close(1000, 'Выход');
    this.socket = undefined;
    this.onState('offline');
  }

  private open(reconnecting: boolean) {
    if (!this.joined) return;
    this.onState(reconnecting ? 'reconnecting' : 'connecting', this.schedule.attempts);
    try {
      const separator = this.url.includes('?') ? '&' : '?';
      this.socket = new WebSocket(
        `${this.url}${separator}room=${encodeURIComponent(this.joined.roomId)}`,
      );
    } catch {
      this.scheduleRetry();
      return;
    }

    this.socket.addEventListener('open', () => {
      this.onState('connected');
      const message = reconnecting ? { ...this.joined!, type: 'join-room' as const } : this.joined!;
      this.send(message);
      this.schedule.reset();
      if (this.heartbeat) window.clearInterval(this.heartbeat);
      this.heartbeat = window.setInterval(
        () => this.send({ type: 'ping', timestamp: Date.now() }),
        HEARTBEAT_INTERVAL_MS,
      );
    });
    this.socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      try {
        this.onMessage(parseServerMessage(event.data));
      } catch {
        this.onMessage({
          type: 'error',
          code: 'INVALID_MESSAGE',
          message: 'Сервер прислал некорректный ответ',
        });
      }
    });
    this.socket.addEventListener('close', () => {
      if (this.heartbeat) window.clearInterval(this.heartbeat);
      if (!this.closedByUser) this.scheduleRetry();
    });
    this.socket.addEventListener('error', () => this.socket?.close());
  }

  private scheduleRetry() {
    if (this.closedByUser) return;
    if (!this.schedule.canRetry) {
      this.closedByUser = true;
      this.onState('offline', this.schedule.attempts);
      return;
    }
    const delay = this.schedule.next();
    this.onState('reconnecting', this.schedule.attempts);
    this.retryTimer = window.setTimeout(() => this.open(true), delay);
  }
}

import { HEARTBEAT_INTERVAL_MS } from '@freetalk/config';
import { parseServerMessage, type ClientMessage, type ServerMessage } from '@freetalk/protocol';
import { ReconnectSchedule } from './reconnect';

export type SignalingState = 'offline' | 'connecting' | 'connected' | 'reconnecting';

const SERVER_ACTIVITY_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS * 3;

export class SignalingClient {
  private socket?: WebSocket;
  private heartbeat?: number;
  private retryTimer?: number;
  private closedByUser = false;
  private lastServerActivity = 0;
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
    this.schedule.reset();
    this.open(false);
  }

  send(message: ClientMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  close() {
    this.closedByUser = true;
    this.clearTimers();
    this.send({ type: 'leave-room' });
    this.socket?.close(1000, 'Выход');
    this.socket = undefined;
    this.onState('offline');
  }

  reconnectNow() {
    if (this.closedByUser || !this.joined) return;
    this.clearTimers();
    this.schedule.reset();
    const previous = this.socket;
    this.socket = undefined;
    previous?.close(4001, 'Network changed');
    this.open(true);
  }

  private open(reconnecting: boolean) {
    if (!this.joined) return;
    if (this.retryTimer) window.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.onState(reconnecting ? 'reconnecting' : 'connecting', this.schedule.attempts);
    let socket: WebSocket;
    try {
      const separator = this.url.includes('?') ? '&' : '?';
      socket = new WebSocket(
        `${this.url}${separator}room=${encodeURIComponent(this.joined.roomId)}`,
      );
      this.socket = socket;
    } catch {
      this.scheduleRetry();
      return;
    }

    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      this.onState('connected');
      const message = reconnecting ? { ...this.joined!, type: 'join-room' as const } : this.joined!;
      this.send(message);
      this.lastServerActivity = Date.now();
      this.startHeartbeat(socket);
    });
    socket.addEventListener('message', (event) => {
      if (this.socket !== socket || typeof event.data !== 'string') return;
      try {
        const message = parseServerMessage(event.data);
        this.lastServerActivity = Date.now();
        this.schedule.reset();
        this.onMessage(message);
      } catch {
        this.onMessage({
          type: 'error',
          code: 'INVALID_MESSAGE',
          message: 'Сервер прислал некорректный ответ',
        });
      }
    });
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      if (this.heartbeat) window.clearInterval(this.heartbeat);
      this.heartbeat = undefined;
      if (!this.closedByUser) this.scheduleRetry();
    });
    socket.addEventListener('error', () => {
      if (this.socket === socket) socket.close();
    });
  }

  private startHeartbeat(socket: WebSocket) {
    if (this.heartbeat) window.clearInterval(this.heartbeat);
    this.heartbeat = window.setInterval(() => {
      if (this.socket !== socket) return;
      if (Date.now() - this.lastServerActivity >= SERVER_ACTIVITY_TIMEOUT_MS) {
        socket.close(4000, 'Heartbeat timeout');
        return;
      }
      this.send({ type: 'ping', timestamp: Date.now() });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private clearTimers() {
    if (this.retryTimer) window.clearTimeout(this.retryTimer);
    if (this.heartbeat) window.clearInterval(this.heartbeat);
    this.retryTimer = undefined;
    this.heartbeat = undefined;
  }

  private scheduleRetry() {
    if (this.closedByUser) return;
    if (!this.schedule.canRetry) {
      this.onState('offline', this.schedule.attempts);
      return;
    }
    const delay = this.schedule.next();
    this.onState('reconnecting', this.schedule.attempts);
    this.retryTimer = window.setTimeout(() => this.open(true), delay);
  }
}

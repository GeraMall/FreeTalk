import { HEARTBEAT_INTERVAL_MS } from '@freetalk/config';
import { parseServerMessage, type ClientMessage, type ServerMessage } from '@freetalk/protocol';
import { ReconnectSchedule } from './reconnect';
import {
  createSignalSocket,
  SIGNAL_SOCKET_OPEN,
  type NativeSendConfirmation,
  type SignalCloseDetails,
  type SignalOpenDetails,
  type SignalSocket,
} from './signaling-transport';
import { connectionDiagnostics } from './connection-diagnostics';

export type SignalingState = 'offline' | 'connecting' | 'connected' | 'reconnecting';

const SERVER_ACTIVITY_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS * 3;

export class SignalingClient {
  private socket?: SignalSocket;
  private heartbeat?: number;
  private retryTimer?: number;
  private closedByUser = false;
  private lastServerActivity = 0;
  private lastPingQueuedAt?: number;
  private lastPingNativeSentAt?: number;
  private lastPongReceivedAt?: number;
  private lastNativeError?: string;
  private reconnectPending = false;
  private readonly clientClosing = new WeakSet<SignalSocket>();
  private messageQueue: Promise<void> = Promise.resolve();
  private joined?: Extract<ClientMessage, { type: 'create-room' | 'join-room' }>;
  private readonly schedule = new ReconnectSchedule();

  constructor(
    private readonly url: string,
    private readonly onMessage: (message: ServerMessage) => Promise<void>,
    private readonly onState: (state: SignalingState, attempt?: number) => void,
  ) {}

  connect(join: Extract<ClientMessage, { type: 'create-room' | 'join-room' }>) {
    this.joined = join;
    this.closedByUser = false;
    this.schedule.reset();
    this.open(false);
  }

  send(message: ClientMessage) {
    if (this.socket?.readyState !== SIGNAL_SOCKET_OPEN) return false;
    connectionDiagnostics.record(`signal-sent:${message.type}`, undefined, {
      socketId: this.socket.correlationId,
    });
    this.socket.send(JSON.stringify(message));
    return true;
  }

  close() {
    this.closedByUser = true;
    this.clearTimers();
    this.send({ type: 'leave-room' });
    if (this.socket) this.clientClosing.add(this.socket);
    this.socket?.close(1000, 'Выход');
    this.socket = undefined;
    this.onState('offline');
  }

  reconnectNow(reason = 'manual') {
    if (this.closedByUser || !this.joined) return;
    connectionDiagnostics.record('signaling-reconnect:requested', undefined, { reason });
    this.clearTimers();
    this.schedule.reset();
    const previous = this.socket;
    this.socket = undefined;
    if (previous) this.clientClosing.add(previous);
    previous?.close(4001, 'Network changed');
    this.open(true);
  }

  private open(reconnecting: boolean) {
    if (!this.joined) return;
    this.reconnectPending = reconnecting;
    this.lastPingQueuedAt = undefined;
    this.lastPingNativeSentAt = undefined;
    this.lastPongReceivedAt = undefined;
    this.lastNativeError = undefined;
    if (reconnecting) connectionDiagnostics.record('signaling-reconnect:start');
    if (this.retryTimer) window.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.onState(reconnecting ? 'reconnecting' : 'connecting', this.schedule.attempts);
    let socket: SignalSocket;
    try {
      const separator = this.url.includes('?') ? '&' : '?';
      socket = createSignalSocket(
        `${this.url}${separator}room=${encodeURIComponent(this.joined.roomId)}`,
      );
      this.socket = socket;
      connectionDiagnostics.record('signaling-socket:created', undefined, {
        socketId: socket.correlationId,
        roomId: this.joined.roomId,
        peerId: this.joined.clientId,
      });
    } catch {
      this.scheduleRetry();
      return;
    }

    socket.addEventListener('open', (event) => {
      if (this.socket !== socket) return;
      const handshake = (event as MessageEvent<SignalOpenDetails>).data;
      if (reconnecting) connectionDiagnostics.record('signaling-reconnect:socket-open');
      connectionDiagnostics.record('signaling-socket:open', undefined, {
        socketId: socket.correlationId,
        serverConnectionId: handshake?.serverConnectionId ?? null,
        edgeColo: handshake?.edgeColo ?? null,
        cfRay: handshake?.cfRay ?? null,
      });
      this.onState('connected');
      const message = reconnecting ? { ...this.joined!, type: 'join-room' as const } : this.joined!;
      this.send(message);
      this.lastServerActivity = Date.now();
      this.startHeartbeat(socket);
    });
    socket.addEventListener('message', (event) => {
      const data = (event as MessageEvent<unknown>).data;
      if (this.socket !== socket || typeof data !== 'string') return;
      try {
        const message = parseServerMessage(data);
        connectionDiagnostics.record(`signal-received:${message.type}`, undefined, {
          socketId: socket.correlationId,
        });
        if (message.type === 'pong') {
          this.lastPongReceivedAt = Date.now();
          connectionDiagnostics.record('signaling-pong:received', undefined, {
            pingTimestamp: message.timestamp,
            receivedAt: new Date(this.lastPongReceivedAt).toISOString(),
          });
        }
        if (message.type === 'joined-room' && this.reconnectPending) {
          this.reconnectPending = false;
          connectionDiagnostics.record('signaling-reconnect:success');
        }
        this.lastServerActivity = Date.now();
        this.schedule.reset();
        // SDP state transitions are order-sensitive. EventTarget does not wait
        // for async listeners, so process every server message in wire order.
        this.messageQueue = this.messageQueue
          .then(() => this.onMessage(message))
          .then(() => undefined)
          .catch(() => undefined);
      } catch {
        this.messageQueue = this.messageQueue
          .then(() =>
            this.onMessage({
              type: 'error',
              code: 'INVALID_MESSAGE',
              message: 'Сервер прислал некорректный ответ',
            }),
          )
          .then(() => undefined)
          .catch(() => undefined);
      }
    });
    socket.addEventListener('native-send', (event) => {
      if (this.socket !== socket) return;
      const confirmation = (event as MessageEvent<NativeSendConfirmation>).data;
      if (!confirmation?.messageType) return;
      connectionDiagnostics.record('signaling-native:sent', undefined, {
        socketId: socket.correlationId,
        messageType: confirmation.messageType,
        messageTimestamp: confirmation.timestamp ?? null,
        nativeSentAt: new Date(confirmation.nativeSentAt).toISOString(),
      });
      if (confirmation.messageType !== 'ping' || confirmation.timestamp === undefined) return;
      this.lastPingNativeSentAt = Date.now();
      connectionDiagnostics.record('signaling-ping:native-sent', undefined, {
        pingTimestamp: confirmation.timestamp,
        confirmedAt: new Date(this.lastPingNativeSentAt).toISOString(),
      });
    });
    socket.addEventListener('native-error', (event) => {
      if (this.socket !== socket) return;
      const message = String((event as MessageEvent<unknown>).data ?? 'Unknown native error').slice(
        0,
        1_000,
      );
      this.lastNativeError = message;
      connectionDiagnostics.record('signaling-native:error', undefined, { message });
    });
    socket.addEventListener('close', (event) => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      const native = (event as MessageEvent<SignalCloseDetails>).data;
      const closeCode = native?.code ?? (event as CloseEvent).code ?? 1006;
      const closeReason = native?.reason ?? (event as CloseEvent).reason ?? '';
      const initiatedBy = this.clientClosing.has(socket)
        ? 'client'
        : (native?.initiatedBy ?? (closeCode === 1006 ? 'transport' : 'server'));
      connectionDiagnostics.record('signaling-socket:closed', undefined, {
        socketId: socket.correlationId,
        closeCode,
        closeReason,
        initiatedBy,
        nativeError: this.lastNativeError ?? null,
        lastPingQueuedAt: this.toTimestamp(this.lastPingQueuedAt),
        lastPingNativeSentAt: this.toTimestamp(this.lastPingNativeSentAt),
        lastPongReceivedAt: this.toTimestamp(this.lastPongReceivedAt),
      });
      if (this.heartbeat) window.clearInterval(this.heartbeat);
      this.heartbeat = undefined;
      if (!this.closedByUser) this.scheduleRetry();
    });
    socket.addEventListener('error', () => {
      if (this.socket === socket) socket.close();
    });
  }

  private startHeartbeat(socket: SignalSocket) {
    if (this.heartbeat) window.clearInterval(this.heartbeat);
    this.heartbeat = window.setInterval(() => {
      if (this.socket !== socket) return;
      if (Date.now() - this.lastServerActivity >= SERVER_ACTIVITY_TIMEOUT_MS) {
        connectionDiagnostics.record('signaling-heartbeat:timeout', undefined, {
          inactivityMs: Date.now() - this.lastServerActivity,
        });
        this.clientClosing.add(socket);
        socket.close(4000, 'Heartbeat timeout');
        return;
      }
      const timestamp = Date.now();
      this.lastPingQueuedAt = timestamp;
      connectionDiagnostics.record('signaling-ping:queued', undefined, {
        pingTimestamp: timestamp,
        queuedAt: new Date(timestamp).toISOString(),
      });
      this.send({ type: 'ping', timestamp });
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
    connectionDiagnostics.record('signaling-reconnect:scheduled', undefined, {
      attempt: this.schedule.attempts,
      delayMs: delay,
    });
    this.onState('reconnecting', this.schedule.attempts);
    this.retryTimer = window.setTimeout(() => this.open(true), delay);
  }

  private toTimestamp(value?: number) {
    return value ? new Date(value).toISOString() : null;
  }
}

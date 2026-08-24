import { invoke } from '@tauri-apps/api/core';

export const SIGNAL_SOCKET_OPEN = 1;

export interface SignalSocket extends EventTarget {
  readonly readyState: number;
  readonly correlationId: string;
  send(message: string): void;
  close(code?: number, reason?: string): void;
}

type NativeSignalEvent =
  | {
      kind: 'open';
      serverConnectionId?: string;
      edgeColo?: string;
      cfRay?: string;
    }
  | { kind: 'message'; data: string }
  | { kind: 'sent'; messageType: string; timestamp: number }
  | {
      kind: 'close';
      code: number;
      reason: string;
      initiatedBy: 'client' | 'server' | 'transport';
    }
  | { kind: 'error'; message: string };

export interface NativeSendConfirmation {
  messageType: string;
  timestamp: number;
}

export interface SignalOpenDetails {
  serverConnectionId?: string;
  edgeColo?: string;
  cfRay?: string;
}

export interface SignalCloseDetails {
  code: number;
  reason: string;
  initiatedBy: 'client' | 'server' | 'transport';
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

class NativeSignalSocket extends EventTarget implements SignalSocket {
  readyState: number = WebSocket.CONNECTING;
  readonly correlationId: string;
  private commandQueue: Promise<unknown> = Promise.resolve();
  private closeDispatched = false;

  constructor(url: string, correlationId: string) {
    super();
    this.correlationId = correlationId;
    void this.connect(url);
  }

  send(message: string) {
    if (this.readyState !== SIGNAL_SOCKET_OPEN) throw new Error('Native signaling is not open');
    // Tauri invokes are asynchronous IPC calls. Serialize them so an offer is
    // never overtaken by its answer/ICE candidates on the way to Rust.
    this.commandQueue = this.commandQueue
      .then(() => invoke('signaling_send', { connectionId: this.correlationId, message }))
      .catch((error: unknown) => this.fail(errorText(error)));
  }

  close(code = 1000, reason = '') {
    if (this.readyState === WebSocket.CLOSED || this.readyState === WebSocket.CLOSING) return;
    this.readyState = WebSocket.CLOSING;
    // Flush a queued leave-room before closing the native socket.
    this.commandQueue = this.commandQueue
      .then(() => invoke('signaling_close', { connectionId: this.correlationId }))
      .then(
        () => this.dispatchClose({ code, reason, initiatedBy: 'client' }),
        () => this.dispatchClose({ code, reason, initiatedBy: 'client' }),
      );
  }

  private handle(event: NativeSignalEvent) {
    if (event.kind === 'open') {
      if (this.readyState !== WebSocket.CONNECTING) return;
      this.readyState = SIGNAL_SOCKET_OPEN;
      this.dispatchEvent(
        new MessageEvent<SignalOpenDetails>('open', {
          data: {
            serverConnectionId: event.serverConnectionId,
            edgeColo: event.edgeColo,
            cfRay: event.cfRay,
          },
        }),
      );
      return;
    }
    if (event.kind === 'message') {
      if (this.readyState === SIGNAL_SOCKET_OPEN)
        this.dispatchEvent(new MessageEvent('message', { data: event.data }));
      return;
    }
    if (event.kind === 'sent') {
      if (this.readyState === SIGNAL_SOCKET_OPEN)
        this.dispatchEvent(
          new MessageEvent<NativeSendConfirmation>('native-send', {
            data: { messageType: event.messageType, timestamp: event.timestamp },
          }),
        );
      return;
    }
    if (event.kind === 'error') {
      this.fail(event.message);
      return;
    }
    this.dispatchClose({
      code: event.code,
      reason: event.reason,
      initiatedBy: event.initiatedBy,
    });
  }

  private fail(message = 'Неизвестная ошибка нативного WebSocket') {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSING;
    this.dispatchEvent(new MessageEvent<string>('native-error', { data: message }));
    this.dispatchEvent(new Event('error'));
    this.dispatchClose({ code: 1006, reason: 'Transport error', initiatedBy: 'transport' });
  }

  private dispatchClose(details: SignalCloseDetails) {
    if (this.closeDispatched) return;
    this.closeDispatched = true;
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new MessageEvent<SignalCloseDetails>('close', { data: details }));
  }

  private async connect(url: string) {
    try {
      await invoke('signaling_connect', { connectionId: this.correlationId, url });
      while (this.readyState !== WebSocket.CLOSED) {
        const event = await invoke<NativeSignalEvent>('signaling_receive', {
          connectionId: this.correlationId,
        });
        this.handle(event);
      }
    } catch (error) {
      this.fail(errorText(error));
    }
  }
}

export function createSignalSocket(url: string): SignalSocket {
  const correlationId = crypto.randomUUID();
  const target = new URL(url);
  target.searchParams.set('cid', correlationId);
  if (isTauri()) return new NativeSignalSocket(target.toString(), correlationId);
  const socket = new WebSocket(target.toString()) as WebSocket & { correlationId: string };
  Object.defineProperty(socket, 'correlationId', { value: correlationId });
  return socket;
}

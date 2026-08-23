import { invoke } from '@tauri-apps/api/core';

export const SIGNAL_SOCKET_OPEN = 1;

export interface SignalSocket extends EventTarget {
  readonly readyState: number;
  send(message: string): void;
  close(code?: number, reason?: string): void;
}

type NativeSignalEvent =
  | { kind: 'open' }
  | { kind: 'message'; data: string }
  | { kind: 'close'; reason: string }
  | { kind: 'error'; message: string };

function isTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

class NativeSignalSocket extends EventTarget implements SignalSocket {
  readyState: number = WebSocket.CONNECTING;
  private readonly connectionId = crypto.randomUUID();
  private commandQueue: Promise<unknown> = Promise.resolve();
  private closeDispatched = false;

  constructor(url: string) {
    super();
    void this.connect(url);
  }

  send(message: string) {
    if (this.readyState !== SIGNAL_SOCKET_OPEN) throw new Error('Native signaling is not open');
    // Tauri invokes are asynchronous IPC calls. Serialize them so an offer is
    // never overtaken by its answer/ICE candidates on the way to Rust.
    this.commandQueue = this.commandQueue
      .then(() => invoke('signaling_send', { connectionId: this.connectionId, message }))
      .catch(() => this.fail());
  }

  close() {
    if (this.readyState === WebSocket.CLOSED || this.readyState === WebSocket.CLOSING) return;
    this.readyState = WebSocket.CLOSING;
    // Flush a queued leave-room before closing the native socket.
    this.commandQueue = this.commandQueue
      .then(() => invoke('signaling_close', { connectionId: this.connectionId }))
      .finally(() => this.dispatchClose());
  }

  private handle(event: NativeSignalEvent) {
    if (event.kind === 'open') {
      if (this.readyState !== WebSocket.CONNECTING) return;
      this.readyState = SIGNAL_SOCKET_OPEN;
      this.dispatchEvent(new Event('open'));
      return;
    }
    if (event.kind === 'message') {
      if (this.readyState === SIGNAL_SOCKET_OPEN)
        this.dispatchEvent(new MessageEvent('message', { data: event.data }));
      return;
    }
    if (event.kind === 'error') {
      this.fail();
      return;
    }
    this.dispatchClose();
  }

  private fail() {
    if (this.readyState === WebSocket.CLOSED) return;
    this.dispatchEvent(new Event('error'));
    this.dispatchClose();
  }

  private dispatchClose() {
    if (this.closeDispatched) return;
    this.closeDispatched = true;
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new Event('close'));
  }

  private async connect(url: string) {
    try {
      await invoke('signaling_connect', { connectionId: this.connectionId, url });
      while (this.readyState !== WebSocket.CLOSED) {
        const event = await invoke<NativeSignalEvent>('signaling_receive', {
          connectionId: this.connectionId,
        });
        this.handle(event);
      }
    } catch {
      this.fail();
    }
  }
}

export function createSignalSocket(url: string): SignalSocket {
  return isTauri() ? new NativeSignalSocket(url) : new WebSocket(url);
}

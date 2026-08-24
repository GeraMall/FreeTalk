import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectionDiagnostics } from './connection-diagnostics';
import { SignalingClient, type SignalingState } from './signaling-client';

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly sent: string[] = [];
  readonly correlationId = crypto.randomUUID();
  readyState = FakeWebSocket.CONNECTING;
  closeCode?: number;
  closeReason?: string;

  constructor(readonly url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  send(value: string) {
    this.sent.push(value);
  }

  close(code?: number, reason?: string) {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.closeCode = code;
    this.closeReason = reason;
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(
      new MessageEvent('close', {
        data: { code: code ?? 1000, reason: reason ?? '', initiatedBy: 'client' },
      }),
    );
  }

  receive(value: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }));
  }

  confirmNativeSend(messageType: string, timestamp: number) {
    this.dispatchEvent(new MessageEvent('native-send', { data: { messageType, timestamp } }));
  }

  failNative(message: string) {
    this.dispatchEvent(new MessageEvent('native-error', { data: message }));
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(
      new MessageEvent('close', {
        data: { code: 1006, reason: 'Transport error', initiatedBy: 'transport' },
      }),
    );
  }
}

const join = {
  type: 'create-room' as const,
  roomId: 'ABCDEFGH2345',
  clientId: '2e172506-d310-4e8e-80a6-8b2144d20d90',
  sessionId: '30c6d4fa-3100-43a1-97e0-4ddc2416493e',
  name: 'Test',
};

describe('SignalingClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    FakeWebSocket.instances = [];
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('WebSocket', FakeWebSocket);
    connectionDiagnostics.startSession({ action: 'test' });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('detects a WebSocket that stays open but stops answering heartbeats', () => {
    const states: SignalingState[] = [];
    const client = new SignalingClient('wss://example.test/ws', vi.fn(), (state) =>
      states.push(state),
    );
    client.connect(join);
    const socket = FakeWebSocket.instances[0]!;
    socket.open();

    vi.advanceTimersByTime(45_000);

    expect(socket.closeCode).toBe(4000);
    expect(socket.closeReason).toBe('Heartbeat timeout');
    expect(states).toContain('reconnecting');
    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('keeps a responsive connection alive when pong messages arrive', () => {
    const client = new SignalingClient('wss://example.test/ws', vi.fn(), vi.fn());
    client.connect(join);
    const socket = FakeWebSocket.instances[0]!;
    socket.open();

    for (let cycle = 0; cycle < 5; cycle += 1) {
      vi.advanceTimersByTime(15_000);
      socket.receive({ type: 'pong', timestamp: Date.now() });
    }

    expect(socket.closeCode).toBeUndefined();
    expect(
      socket.sent
        .map((message) => JSON.parse(message) as { type: string })
        .filter((message) => message.type === 'ping'),
    ).toHaveLength(5);
  });

  it('records native ping confirmation, pong time, and transport close evidence', () => {
    const client = new SignalingClient('wss://example.test/ws', vi.fn(), vi.fn());
    client.connect(join);
    const socket = FakeWebSocket.instances[0]!;
    socket.open();

    expect(new URL(socket.url).searchParams.get('cid')).toBe(socket.correlationId);
    expect(
      connectionDiagnostics
        .snapshot()
        .entries.find((entry) => entry.event === 'signaling-socket:created')?.details,
    ).toMatchObject({
      socketId: socket.correlationId,
      roomId: join.roomId,
      peerId: join.clientId,
    });

    vi.advanceTimersByTime(15_000);
    const ping = socket.sent
      .map((value) => JSON.parse(value) as { type: string; timestamp: number })
      .find((message) => message.type === 'ping')!;
    socket.confirmNativeSend('ping', ping.timestamp);
    socket.receive({ type: 'pong', timestamp: ping.timestamp });
    socket.failNative('Connection reset without closing handshake');

    const entries = connectionDiagnostics.snapshot().entries;
    expect(
      entries.find((entry) => entry.event === 'signaling-ping:native-sent')?.details,
    ).toMatchObject({ pingTimestamp: ping.timestamp });
    expect(
      entries.find((entry) => entry.event === 'signaling-pong:received')?.details,
    ).toMatchObject({ pingTimestamp: ping.timestamp });
    expect(
      entries.find((entry) => entry.event === 'signaling-socket:closed')?.details,
    ).toMatchObject({
      closeCode: 1006,
      closeReason: 'Transport error',
      initiatedBy: 'transport',
      nativeError: 'Connection reset without closing handshake',
    });
  });

  it('immediately replaces the socket and rejoins after a network change', () => {
    const client = new SignalingClient('wss://example.test/ws', vi.fn(), vi.fn());
    client.connect(join);
    const first = FakeWebSocket.instances[0]!;
    first.open();

    client.reconnectNow();
    const second = FakeWebSocket.instances[1]!;
    second.open();

    expect(first.closeCode).toBe(4001);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(JSON.parse(second.sent[0]!)).toMatchObject({ type: 'join-room', roomId: join.roomId });
  });

  it('processes asynchronous server messages in wire order', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstFinished = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const client = new SignalingClient(
      'wss://example.test/ws',
      async (message) => {
        if (message.type !== 'pong') return;
        order.push(`start-${message.timestamp}`);
        if (message.timestamp === 1) await firstFinished;
        order.push(`end-${message.timestamp}`);
      },
      vi.fn(),
    );
    client.connect(join);
    const socket = FakeWebSocket.instances[0]!;
    socket.open();

    socket.receive({ type: 'pong', timestamp: 1 });
    socket.receive({ type: 'pong', timestamp: 2 });
    await Promise.resolve();
    expect(order).toEqual(['start-1']);

    releaseFirst();
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2']);
  });

  it('continues processing after a rejected message handler', async () => {
    const handled: number[] = [];
    const client = new SignalingClient(
      'wss://example.test/ws',
      async (message) => {
        if (message.type !== 'pong') return;
        if (message.timestamp === 1) throw new Error('expected handler failure');
        handled.push(message.timestamp);
      },
      vi.fn(),
    );
    client.connect(join);
    const socket = FakeWebSocket.instances[0]!;
    socket.open();

    socket.receive({ type: 'pong', timestamp: 1 });
    socket.receive({ type: 'pong', timestamp: 2 });
    for (let index = 0; index < 12; index += 1) await Promise.resolve();

    expect(handled).toEqual([2]);
  });
});

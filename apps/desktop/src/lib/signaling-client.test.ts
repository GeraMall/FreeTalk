import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignalingClient, type SignalingState } from './signaling-client';

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly sent: string[] = [];
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
    this.dispatchEvent(new Event('close'));
  }

  receive(value: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }));
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

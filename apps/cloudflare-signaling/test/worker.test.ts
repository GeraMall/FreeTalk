import type { ServerMessage } from '@freetalk/protocol';
import { parseDnsIpv4Answers, withCloudflareTurnIpFallbacks } from '@freetalk/config';
import { describe, expect, it } from 'vitest';
import { VoiceRoom } from '../src/worker';

interface TestAttachment {
  joined: boolean;
  roomId: string;
  clientId?: string;
  sessionId?: string;
  name?: string;
  muted?: boolean;
  isOwner?: boolean;
  connectedAt?: number;
  lastSeen: number;
  timestamps: number[];
}

class FakeSocket {
  sent: ServerMessage[] = [];
  closedWith?: [number | undefined, string | undefined];

  constructor(public attachment: TestAttachment) {}

  deserializeAttachment() {
    return this.attachment;
  }

  serializeAttachment(value: TestAttachment) {
    this.attachment = value;
  }

  send(value: string) {
    this.sent.push(JSON.parse(value) as ServerMessage);
  }

  close(code?: number, reason?: string) {
    this.closedWith = [code, reason];
  }
}

function attachment(overrides: Partial<TestAttachment>): TestAttachment {
  return {
    joined: false,
    roomId: 'ABCDEFGHIJKL',
    lastSeen: Date.now(),
    timestamps: [],
    ...overrides,
  };
}

function roomWith(sockets: FakeSocket[]) {
  const storage = new Map<string, unknown>();
  const state = {
    getWebSockets: () => sockets,
    storage: {
      get: async <T>(key: string) => storage.get(key) as T | undefined,
      put: async (key: string, value: unknown) => void storage.set(key, value),
      delete: async (key: string) => void storage.delete(key),
      setAlarm: async () => undefined,
    },
  };
  return new VoiceRoom(state as unknown as DurableObjectState, {} as never);
}

describe('Cloudflare voice room reconnects', () => {
  it('removes the replaced socket before creating the participant snapshot', async () => {
    const current = new FakeSocket(
      attachment({
        joined: true,
        clientId: '286d39ef-61af-4aca-84b8-47f78b0f554a',
        sessionId: 'session-123456789',
        name: 'Gera',
        isOwner: true,
        connectedAt: 1,
      }),
    );
    const replacement = new FakeSocket(attachment({}));
    const room = roomWith([current, replacement]);
    const join = Reflect.get(room, 'join') as (
      socket: WebSocket,
      message: {
        type: 'join-room';
        roomId: string;
        clientId: string;
        sessionId: string;
        name: string;
      },
      value: TestAttachment,
    ) => Promise<void>;

    await join.call(
      room,
      replacement as unknown as WebSocket,
      {
        type: 'join-room',
        roomId: 'ABCDEFGHIJKL',
        clientId: '286d39ef-61af-4aca-84b8-47f78b0f554a',
        sessionId: 'session-123456789',
        name: 'Gera',
      },
      replacement.attachment,
    );

    expect(current.attachment.joined).toBe(false);
    expect(current.closedWith?.[0]).toBe(4001);
    expect(replacement.sent[0]?.type).toBe('ice-config');
    const snapshot = replacement.sent.find((message) => message.type === 'joined-room');
    expect(snapshot?.type).toBe('joined-room');
    if (snapshot?.type === 'joined-room') {
      expect(snapshot.participants).toHaveLength(1);
      expect(snapshot.participants[0]?.id).toBe('286d39ef-61af-4aca-84b8-47f78b0f554a');
    }

    await room.webSocketClose(current as unknown as WebSocket);
    expect(replacement.sent.some((message) => message.type === 'participant-left')).toBe(false);
  });

  it('emits participant-left only once when close and error callbacks both run', async () => {
    const owner = new FakeSocket(
      attachment({
        joined: true,
        clientId: '286d39ef-61af-4aca-84b8-47f78b0f554a',
        sessionId: 'session-123456789',
        name: 'Owner',
        isOwner: true,
        connectedAt: 1,
      }),
    );
    const member = new FakeSocket(
      attachment({
        joined: true,
        clientId: '386d39ef-61af-4aca-84b8-47f78b0f554b',
        sessionId: 'session-223456789',
        name: 'Member',
        connectedAt: 2,
      }),
    );
    const room = roomWith([owner, member]);

    await room.webSocketError(member as unknown as WebSocket);
    await room.webSocketClose(member as unknown as WebSocket);

    expect(member.attachment.joined).toBe(false);
    expect(owner.sent.filter((message) => message.type === 'participant-left')).toHaveLength(1);
  });
});

describe('Cloudflare TURN IP fallback', () => {
  it('accepts only valid IPv4 answers from DNS over HTTPS', () => {
    expect(
      parseDnsIpv4Answers({
        Answer: [
          { type: 1, data: '141.101.90.1' },
          { type: 28, data: '2a06:98c1:3200::1' },
          { type: 1, data: '999.1.1.1' },
          { type: 1, data: '141.101.90.1' },
        ],
      }),
    ).toEqual(['141.101.90.1']);
  });

  it('adds authenticated UDP and TCP IP endpoints without replacing provider URLs', () => {
    const provider: RTCIceServer[] = [
      {
        urls: [
          'turn:turn.cloudflare.com:3478?transport=udp',
          'turns:turn.cloudflare.com:443?transport=tcp',
        ],
        username: 'temporary-user',
        credential: 'temporary-password',
      },
    ];

    const result = withCloudflareTurnIpFallbacks(provider, ['141.101.90.1']);

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(provider[0]);
    expect(result[1]).toEqual({
      urls: [
        'turn:141.101.90.1:3478?transport=udp',
        'turn:141.101.90.1:3478?transport=tcp',
        'turn:141.101.90.1:53?transport=udp',
        'turn:141.101.90.1:80?transport=tcp',
      ],
      username: 'temporary-user',
      credential: 'temporary-password',
    });
  });
});

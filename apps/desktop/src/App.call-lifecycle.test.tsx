// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomActivity, RoomActivityAction, ServerMessage } from '@freetalk/protocol';
import { App } from './App';

const harness = vi.hoisted(() => ({
  home: undefined as
    | undefined
    | {
        onJoinRoom(code: string, chatId?: string): void;
        onActiveChatChange?(id: string): void;
      },
  room: undefined as
    | undefined
    | {
        activity?: RoomActivity;
        activityUnlocked?: boolean;
        conversationHidden?: boolean;
        onTabletVisibilityChange?(visible: boolean): void;
        onActivity?(action: RoomActivityAction): void;
      },
  send: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  token: vi.fn(),
  clients: [] as Array<{ message(message: ServerMessage): Promise<void>; close(): void }>,
}));
vi.mock('./lib/api-client', async (original) => ({
  ...(await original<typeof import('./lib/api-client')>()),
  accountClient: {
    restore: async () => ({
      id: '11111111-1111-4111-8111-111111111111',
      displayName: 'QA',
      username: 'qa',
      email: 'qa@example.invalid',
      emailVerified: true,
      canAccessStore: false,
      avatarUrl: null,
      registeredAt: '2026-01-01T00:00:00Z',
    }),
    request: async () => ({ chats: [], friends: [], calls: [] }),
    realtimeAccessToken: harness.token,
  },
}));
vi.mock('./lib/account-media-cache', () => ({
  setActiveAccountMediaScope: vi.fn(),
  collectAccountMediaUrls: () => [],
  warmAccountMediaCache: async () => {},
  clearAccountMediaCache: async () => {},
}));
vi.mock('./lib/mobile-layout', () => ({ useMobileLayout: () => false }));
vi.mock('./lib/chat-realtime', () => ({
  ChatRealtimeClient: class {
    start() {}
    stop() {}
  },
}));
vi.mock('./lib/service-chat', () => ({
  startServiceDelivery: () => () => {},
  queueCallTimeoutNotice: vi.fn(),
}));
vi.mock('./lib/updater', () => ({
  currentVersion: async () => '0.4.0-beta.196',
  checkForUpdate: async () => ({ kind: 'idle' }),
  installPendingUpdate: async () => {},
}));
vi.mock('./lib/audio-manager', () => ({
  AudioManager: class {
    static listDevices = async () => ({ inputs: [], outputs: [], cameras: [] });
    start = harness.start;
    stop = harness.stop;
    setMuted() {}
    setPushToTalkPressed() {}
    setTypingSuppressed() {}
    getStream() {
      return { getTracks: () => [], getAudioTracks: () => [] };
    }
  },
  monitorRemoteSpeaking: () => () => {},
}));
vi.mock('./lib/video-manager', () => ({
  VideoManager: class {
    dispose() {}
    getTracks() {
      return {};
    }
  },
}));
vi.mock('./lib/peer-manager', () => ({
  PeerManager: class {
    closeAll() {}
    ensure() {}
    collectTelemetry = async () => [];
  },
}));
vi.mock('./lib/signaling-client', () => ({
  SignalingClient: class {
    constructor(
      _url: string,
      public message: (message: ServerMessage) => Promise<void>,
      private state: (value: string) => void,
    ) {
      harness.clients.push(this);
    }
    connect() {
      this.state('connecting');
    }
    send = harness.send;
    close() {
      this.state('offline');
    }
  },
}));
vi.mock('./lib/notification-sounds', async (original) => ({
  ...(await original<typeof import('./lib/notification-sounds')>()),
  NotificationSounds: class {
    prepare = async () => {};
    stop() {}
  },
}));
vi.mock('./components/HomeView', () => ({
  HomeView: (props: NonNullable<typeof harness.home>) => {
    harness.home = props;
    return <main data-testid="home" />;
  },
}));
vi.mock('./components/AccountSidebar', () => ({
  AccountSidebar: () => <aside data-testid="sidebar" />,
}));
vi.mock('./components/RoomView', () => ({
  RoomView: (props: NonNullable<typeof harness.room> & { onLeave(): void }) => {
    harness.room = props;
    return (
      <section data-testid="call">
        <button onClick={props.onLeave}>Leave test call</button>
      </section>
    );
  },
}));
vi.mock('./components/SettingsPanel', () => ({ SettingsPanel: () => null }));
vi.mock('./components/BrowserNotificationPrompt', () => ({
  BrowserNotificationPrompt: () => <div data-testid="notifications" />,
}));

beforeEach(() => {
  harness.home = undefined;
  harness.room = undefined;
  harness.send.mockReset().mockReturnValue(true);
  harness.clients = [];
  harness.start.mockReset().mockResolvedValue(undefined);
  harness.stop.mockReset();
  harness.token.mockReset().mockResolvedValue('test-token');
  localStorage.clear();
  sessionStorage.clear();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: new EventTarget(),
  });
});
afterEach(() => {
  window.dispatchEvent(new Event('beforeunload'));
  cleanup();
  vi.restoreAllMocks();
});

describe('application call ownership', () => {
  it('delivers shared activity to an ordinary account and preserves preferred chat visibility', async () => {
    const page = render(<App />);
    await page.findByTestId('home');
    act(() => harness.home!.onJoinRoom('ABCDEFGH2345', 'chat'));
    await waitFor(() => expect(harness.clients).toHaveLength(1));
    const client = harness.clients[0]!;
    const activity: RoomActivity = {
      open: true,
      revision: 1,
      region: 'RU',
      startedBy: '22222222-2222-4222-8222-222222222222',
      sessionId: '33333333-3333-4333-8333-333333333333',
    };
    await act(async () => client.message({ type: 'activity-state', activity }));
    expect(harness.room!.activity).toEqual(activity);
    expect(harness.room!.activityUnlocked).toBe(true);
    act(() => harness.room!.onActivity!({ kind: 'game', game: 'chess' }));
    expect(harness.send).toHaveBeenCalledWith({
      type: 'activity-action',
      revision: 1,
      action: { kind: 'game', game: 'chess' },
    });
    expect(harness.room!.conversationHidden).toBe(false);
    for (let cycle = 0; cycle < 2; cycle++) {
      act(() => harness.room!.onTabletVisibilityChange!(true));
      expect(harness.room!.conversationHidden).toBe(true);
      act(() => harness.room!.onTabletVisibilityChange!(false));
      expect(harness.room!.conversationHidden).toBe(false);
    }
  });

  it('cancels pending microphone acquisition without resurrecting a call or duplicating the account screen', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let acquired!: () => void;
    harness.start.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          acquired = resolve;
        }),
    );
    const page = render(<App />);
    await page.findByTestId('home');
    const join = harness.home!.onJoinRoom;
    act(() => {
      join('ABCDEFGH2345', 'chat');
      join('ABCDEFGH2345', 'chat');
    });
    await page.findByTestId('call');
    expect(harness.start).toHaveBeenCalledOnce();
    fireEvent.click(page.getByRole('button', { name: 'Leave test call' }));
    await waitFor(() => expect(page.queryByTestId('call')).toBeNull());
    await act(async () => acquired());
    expect(harness.stop).toHaveBeenCalledOnce();
    expect(harness.clients).toHaveLength(0);
    expect(page.getAllByTestId('home')).toHaveLength(1);
    expect(page.getAllByTestId('notifications')).toHaveLength(1);
    expect(errors.mock.calls.flat().join(' ')).not.toContain('same key');
  });

  it('ignores a previous authorization result and a retired signaling error after a new call starts', async () => {
    let authorize!: (token: string) => void;
    harness.token.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          authorize = resolve;
        }),
    );
    const page = render(<App />);
    await page.findByTestId('home');
    act(() => harness.home!.onJoinRoom('ABCDEFGH2345', 'first'));
    await waitFor(() => expect(harness.token).toHaveBeenCalledOnce());
    fireEvent.click(page.getByRole('button', { name: 'Leave test call' }));
    await waitFor(() => expect(page.queryByTestId('call')).toBeNull());
    act(() => harness.home!.onJoinRoom('BCDEFGHJ2345', 'second'));
    await waitFor(() => expect(harness.clients).toHaveLength(1));
    await act(async () => authorize('old-token'));
    expect(harness.clients).toHaveLength(1);
    expect(page.getAllByTestId('call')).toHaveLength(1);
    const old = harness.clients[0]!;
    fireEvent.click(page.getByRole('button', { name: 'Leave test call' }));
    await waitFor(() => expect(page.queryByTestId('call')).toBeNull());
    act(() => harness.home!.onJoinRoom('CDEFGHJK2345', 'third'));
    await waitFor(() => expect(harness.clients).toHaveLength(2));
    await act(async () =>
      old.message({ type: 'error', code: 'ROOM_NOT_FOUND', message: 'Retired call', fatal: true }),
    );
    expect(page.getAllByTestId('call')).toHaveLength(1);
    expect(page.queryByText('Retired call')).toBeNull();
  });
});

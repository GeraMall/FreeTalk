// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import type { ChatRealtimeServerMessage } from '@freetalk/protocol';
import type { AccountUser } from '../lib/api-client';
import {
  activeCallRoomId,
  hasConversationParticipants,
  uniqueCallParticipants,
} from '../lib/call-history';
import { HomeView, RecentRooms, TransientNotice } from './HomeView';
import { SERVICE_CHAT_UPDATED } from '../lib/service-chat';

const homeViewHarness = vi.hoisted(() => ({
  request: vi.fn(),
  ready: undefined as (() => void) | undefined,
  event: undefined as ((event: ChatRealtimeServerMessage) => void) | undefined,
}));

vi.mock('../lib/api-client', () => ({
  accountClient: {
    request: homeViewHarness.request,
    chatHistory: (chatId: string) => homeViewHarness.request(`/v1/chats/${chatId}/messages`),
  },
}));

vi.mock('../lib/chat-realtime', () => ({
  ChatRealtimeClient: class {
    constructor(
      event: (event: ChatRealtimeServerMessage) => void,
      _presence: unknown,
      ready?: () => void,
    ) {
      homeViewHarness.event = event;
      homeViewHarness.ready = ready;
    }
    start() {}
    stop() {}
  },
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  homeViewHarness.request.mockReset();
  homeViewHarness.ready = undefined;
  homeViewHarness.event = undefined;
  localStorage.clear();
});

function mobileMatchMedia() {
  return {
    matches: true,
    media: '(max-width: 760px)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;
}

describe('retained account navigation', () => {
  const user: AccountUser = {
    id: 'self',
    email: 'qa@example.invalid',
    username: 'qa_self',
    displayName: 'QA',
    emailVerified: true,
    avatarUrl: null,
    registeredAt: '2026-08-26T00:00:00.000Z',
  };
  const chats = ['А', 'Б'].map((name, index) => ({
    id: `chat-${index}`,
    type: 'group',
    title: `Чат ${name}`,
    members: [{ id: 'self', username: 'qa_self', displayName: 'QA', role: 'owner' }],
    currentUserRole: 'owner',
  }));
  const friendResult = {
    friends: [
      { id: 'friend', username: 'friend', displayName: 'Тестовый друг', presence: 'online' },
    ],
    pending: [],
    blocked: [],
  };
  const message = {
    id: 'm-1',
    sender_id: 'self',
    username: 'qa_self',
    display_name: 'QA',
    kind: 'text',
    body: 'Сохранённая переписка',
    created_at: '2026-08-26T12:00:00.000Z',
    expires_at: null,
  };
  const renderHome = () =>
    render(
      <StrictMode>
        <HomeView
          user={user}
          busy={false}
          error=""
          onCreateRoom={vi.fn()}
          onJoinRoom={vi.fn()}
          onSettings={vi.fn()}
          onLogout={vi.fn()}
        />
      </StrictMode>,
    );
  const requestCount = (path: string) =>
    homeViewHarness.request.mock.calls.filter(([url]) => url === path).length;
  const baseResponse = (path: string) => {
    if (path === '/v1/chats') return { chats };
    if (path === '/v1/friends') return friendResult;
    if (path === '/v1/history') return { calls: [] };
    if (path.endsWith('/messages')) return { messages: [message], hasMore: false };
    throw Error(`Unexpected request ${path}`);
  };

  it('coalesces repeated call clicks while keeping other chats navigable', async () => {
    let finish!: (value: { call: null }) => void;
    const checking = new Promise<{ call: null }>((resolve) => {
      finish = resolve;
    });
    const created = vi.fn();
    homeViewHarness.request.mockImplementation(async (path: string) => {
      if (path.endsWith('/active-call')) return checking;
      if (path.endsWith('/calls')) return {};
      return baseResponse(path);
    });
    const page = render(
      <HomeView
        user={user}
        busy={false}
        error=""
        initialChatId="chat-0"
        onCreateRoom={created}
        onJoinRoom={vi.fn()}
        onSettings={vi.fn()}
        onLogout={vi.fn()}
      />,
    );
    await page.findByText('Сохранённая переписка');
    await act(async () => {
      await Promise.resolve();
    });
    const call = page.getByRole('button', { name: 'Начать голосовой звонок' });
    const initialLookups = requestCount('/v1/chats/chat-0/active-call');
    fireEvent.click(call);
    fireEvent.click(call);
    expect(requestCount('/v1/chats/chat-0/active-call')).toBe(initialLookups + 1);
    fireEvent.click(page.getByRole('button', { name: 'Чат Б' }));
    await waitFor(() =>
      expect(page.getByRole('button', { name: 'Чат Б' }).getAttribute('aria-current')).toBe('true'),
    );
    await act(async () => finish({ call: null }));
    expect(created).toHaveBeenCalledOnce();
    expect(requestCount('/v1/chats/chat-0/calls')).toBe(1);
  });

  it('refreshes a retained bot snapshot if a notification arrives while another chat is open', async () => {
    let serviceBody = 'Первое уведомление';
    homeViewHarness.request.mockImplementation(async (path: string) =>
      path === '/v1/service-chat/messages'
        ? {
            messages: [
              {
                id: serviceBody,
                author: 'bot',
                kind: 'help',
                body: serviceBody,
                created_at: new Date().toISOString(),
              },
            ],
          }
        : baseResponse(path),
    );
    const page = renderHome();
    await waitFor(() => expect(page.getByRole('button', { name: 'Чат А' })).toBeTruthy());
    fireEvent.click(page.getByRole('button', { name: 'TRLKA' }));
    await page.findByText('Первое уведомление');
    const loaded = requestCount('/v1/service-chat/messages');
    fireEvent.click(page.getByRole('button', { name: 'Чат А' }));
    await page.findByText('Сохранённая переписка');
    serviceBody = 'Новое уведомление';
    act(() => window.dispatchEvent(new Event(SERVICE_CHAT_UPDATED)));
    fireEvent.click(page.getByRole('button', { name: 'TRLKA' }));
    await page.findByText('Новое уведомление');
    expect(requestCount('/v1/service-chat/messages')).toBeGreaterThan(loaded);
  });

  it('finishes a cold Friends load despite repeated clicks, then switches sections without refetching or skeletons', async () => {
    let finish!: (value: typeof friendResult) => void;
    homeViewHarness.request.mockImplementation((path: string) =>
      path === '/v1/friends'
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(baseResponse(path)),
    );
    const view = renderHome();
    await waitFor(() => expect(requestCount('/v1/friends')).toBe(1));
    fireEvent.click(view.getByRole('button', { name: 'Друзья' }));
    fireEvent.click(view.getByRole('button', { name: 'Друзья' }));
    expect(view.getByLabelText('Загрузка списка друзей')).toBeTruthy();
    await act(async () => finish(friendResult));
    expect(await view.findByText('Тестовый друг')).toBeTruthy();
    for (let i = 0; i < 5; i++) {
      fireEvent.click(view.getByRole('button', { name: 'История' }));
      fireEvent.click(view.getByRole('button', { name: 'Главная' }));
      fireEvent.click(view.getByRole('button', { name: 'Друзья' }));
      expect(view.queryByLabelText('Загрузка списка друзей')).toBeNull();
      expect(view.getByText('Тестовый друг')).toBeTruthy();
    }
    await act(async () => undefined);
    expect(requestCount('/v1/chats')).toBe(1);
    expect(requestCount('/v1/friends')).toBe(1);
    expect(requestCount('/v1/history')).toBe(1);
  });

  it('restores a recent chat instantly and ignores a late response from another chat', async () => {
    let finishB!: (value: unknown) => void;
    homeViewHarness.request.mockImplementation((path: string) =>
      path === '/v1/chats/chat-1/messages'
        ? new Promise((resolve) => {
            finishB = resolve;
          })
        : Promise.resolve(baseResponse(path)),
    );
    const view = renderHome();
    fireEvent.click(await view.findByRole('button', { name: 'Чат А' }));
    expect(await view.findByText(message.body)).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Чат А' }));
    fireEvent.click(view.getByRole('button', { name: 'Чат Б' }));
    fireEvent.click(view.getByRole('button', { name: 'Чат А' }));
    expect(view.getByText(message.body)).toBeTruthy();
    await act(async () =>
      finishB({ messages: [{ ...message, id: 'm-b', body: 'Другая переписка' }] }),
    );
    expect(view.queryByText('Другая переписка')).toBeNull();
    expect(requestCount('/v1/chats/chat-0/messages')).toBe(1);
    expect(requestCount('/v1/chats/chat-1/messages')).toBe(1);
  });

  it('invalidates a cached chat when a message is deleted while another chat is open', async () => {
    let deleted = false;
    homeViewHarness.request.mockImplementation(async (path: string) =>
      path === '/v1/chats/chat-0/messages' && deleted
        ? { messages: [], hasMore: false }
        : baseResponse(path),
    );
    const view = renderHome();
    fireEvent.click(await view.findByRole('button', { name: 'Чат А' }));
    expect(await view.findByText(message.body)).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Чат Б' }));
    await waitFor(() => expect(requestCount('/v1/chats/chat-1/messages')).toBe(1));
    deleted = true;
    act(() =>
      homeViewHarness.event?.({
        type: 'message-deleted',
        chatId: 'chat-0',
        messageId: 'm-1',
      } as ChatRealtimeServerMessage),
    );
    fireEvent.click(view.getByRole('button', { name: 'Чат А' }));
    await waitFor(() => expect(requestCount('/v1/chats/chat-0/messages')).toBe(2));
    expect(view.queryByText(message.body)).toBeNull();
  });
});

it('filters call history by month and totals the visible durations', async () => {
  const participants = [{ displayName: 'QA' }, { displayName: 'Макс' }];
  homeViewHarness.request.mockImplementation(async (path: string) => {
    if (path === '/v1/chats') return { chats: [] };
    if (path === '/v1/friends') return { friends: [], pending: [], blocked: [] };
    if (path === '/v1/history') {
      return {
        calls: [
          {
            id: 'new',
            room_id: 'new',
            started_at: '2025-10-15T12:00:00Z',
            duration_seconds: 4200,
            participants,
          },
          {
            id: 'old',
            room_id: 'old',
            started_at: '2025-09-15T12:00:00Z',
            duration_seconds: 1200,
            participants,
          },
        ],
      };
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  const view = render(
    <HomeView
      user={{
        id: 'self',
        email: 'qa@example.invalid',
        username: 'qa_self',
        displayName: 'QA',
        emailVerified: true,
        avatarUrl: null,
        registeredAt: '2025-01-01T00:00:00Z',
      }}
      busy={false}
      error=""
      page="history"
      onCreateRoom={vi.fn()}
      onJoinRoom={vi.fn()}
      onSettings={vi.fn()}
      onLogout={vi.fn()}
    />,
  );
  expect(await view.findByText('2 звонка · 1 ч 30 мин')).toBeTruthy();
  const period = view.getByLabelText('Период звонков');
  fireEvent.click(period);
  fireEvent.click(view.getByRole('button', { name: /октябрь 2025/i }));
  expect(view.getByText('1 звонок · 1 ч 10 мин')).toBeTruthy();
  expect(view.getAllByRole('button', { name: 'Позвонить снова' })).toHaveLength(1);
  expect(period.closest('details')?.open).toBe(false);
  fireEvent.click(period);
  fireEvent.click(view.getByRole('button', { name: 'Все' }));
  expect(view.getByText('2 звонка · 1 ч 30 мин')).toBeTruthy();
});

describe('HomeView chat navigation', () => {
  it('repairs a missed call end after realtime reconnect without clearing the draft', async () => {
    let ended = false;
    const user: AccountUser = {
      id: 'self',
      email: 'qa@example.invalid',
      username: 'qa_self',
      displayName: 'QA',
      emailVerified: true,
      avatarUrl: null,
      registeredAt: '2026-08-26T00:00:00.000Z',
    };
    homeViewHarness.request.mockImplementation(async (path: string) => {
      if (path === '/v1/chats')
        return {
          chats: [
            {
              id: 'chat-1',
              type: 'group',
              title: 'Команда',
              members: [{ id: 'self', username: 'qa_self', displayName: 'QA', role: 'owner' }],
              currentUserRole: 'owner',
            },
          ],
        };
      if (path === '/v1/friends') return { friends: [], pending: [], blocked: [] };
      if (path === '/v1/history') return { calls: [] };
      if (path === '/v1/chats/chat-1/active-call') return { call: null };
      if (path === '/v1/chats/chat-1/messages')
        return {
          messages: [
            {
              id: 'call-1',
              sender_id: 'self',
              username: 'qa_self',
              display_name: 'QA',
              kind: 'call',
              body: 'QA начал звонок',
              created_at: new Date().toISOString(),
              expires_at: null,
              metadata: { roomId: 'ROOM12345678', ended, established: true },
            },
          ],
          hasMore: false,
        };
      throw new Error(`Unexpected request: ${path}`);
    });
    const view = render(
      <HomeView
        user={user}
        busy={false}
        error=""
        page="chats"
        onCreateRoom={vi.fn()}
        onJoinRoom={vi.fn()}
        onSettings={vi.fn()}
        onLogout={vi.fn()}
      />,
    );
    fireEvent.click(await view.findByRole('button', { name: 'Команда' }));
    expect(await view.findByRole('button', { name: 'Присоединиться' })).toBeTruthy();
    const input = view.getByPlaceholderText('Написать сообщение…') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Черновик остаётся' } });
    ended = true;
    await act(async () => homeViewHarness.ready?.());
    expect(await view.findByText('Звонок завершён')).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Присоединиться' })).toBeNull();
    expect(input.value).toBe('Черновик остаётся');
  });

  it('opens the mobile settings menu with one avatar click', async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation(mobileMatchMedia);
    homeViewHarness.request.mockImplementation(async (path: string) => {
      if (path === '/v1/chats') return { chats: [] };
      if (path === '/v1/friends') return { friends: [], pending: [], blocked: [] };
      if (path === '/v1/history') return { calls: [] };
      throw new Error(`Unexpected request: ${path}`);
    });
    const onSettings = vi.fn();
    const user: AccountUser = {
      id: 'self',
      email: 'gera@example.com',
      username: 'german',
      displayName: 'Гера',
      emailVerified: true,
      avatarUrl: null,
      registeredAt: '2026-08-26T00:00:00.000Z',
    };

    try {
      const view = render(
        <HomeView
          user={user}
          busy={false}
          error=""
          onCreateRoom={vi.fn()}
          onJoinRoom={vi.fn()}
          onSettings={onSettings}
          onLogout={vi.fn()}
        />,
      );
      fireEvent.click(await view.findByRole('button', { name: 'Открыть настройки' }));
      expect(onSettings).toHaveBeenCalledOnce();
      expect(onSettings).toHaveBeenCalledWith();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('keeps the mobile chat list loaded when browser history only closes a chat', async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation(mobileMatchMedia);
    window.history.replaceState({ freetalkAccountPage: 'chats' }, '');
    homeViewHarness.request.mockImplementation(async (path: string) => {
      if (path === '/v1/chats') {
        return {
          chats: [
            {
              id: 'chat-1',
              type: 'direct',
              title: null,
              members: [
                { id: 'self', username: 'german', displayName: 'Гера' },
                { id: 'friend-1', username: 'anna', displayName: 'Анна' },
              ],
              lastMessage: 'До встречи',
            },
          ],
        };
      }
      if (path === '/v1/friends') return { friends: [], pending: [], blocked: [] };
      if (path === '/v1/history') return { calls: [] };
      throw new Error(`Unexpected request: ${path}`);
    });
    const user: AccountUser = {
      id: 'self',
      email: 'gera@example.com',
      username: 'german',
      displayName: 'Гера',
      emailVerified: true,
      avatarUrl: null,
      registeredAt: '2026-08-26T00:00:00.000Z',
    };

    try {
      const view = render(
        <HomeView
          user={user}
          busy={false}
          error=""
          page="chats"
          onCreateRoom={vi.fn()}
          onJoinRoom={vi.fn()}
          onSettings={vi.fn()}
          onLogout={vi.fn()}
        />,
      );
      expect(await view.findByRole('button', { name: /Анна/ })).toBeTruthy();

      fireEvent.popState(window, { state: { freetalkAccountPage: 'chats' } });

      expect(view.queryByLabelText('Загрузка чатов')).toBeNull();
      expect(view.getByRole('button', { name: /Анна/ })).toBeTruthy();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('loads chats for the shared sidebar while the home page is open', async () => {
    const user: AccountUser = {
      id: 'self',
      email: 'gera@example.com',
      username: 'german',
      displayName: 'Гера',
      emailVerified: true,
      avatarUrl: null,
      registeredAt: '2026-08-26T00:00:00.000Z',
    };
    homeViewHarness.request.mockImplementation(async (path: string) => {
      if (path === '/v1/chats') {
        return {
          chats: [
            {
              id: 'chat-1',
              type: 'direct',
              title: null,
              members: [
                { id: 'self', username: 'german', displayName: 'Гера' },
                { id: 'friend-1', username: 'anna', displayName: 'Анна' },
              ],
              lastMessage: 'До встречи',
            },
          ],
        };
      }
      if (path === '/v1/friends') return { friends: [], pending: [], blocked: [] };
      if (path === '/v1/history') return { calls: [] };
      throw new Error(`Unexpected request: ${path}`);
    });

    const onSidebarStateChange = vi.fn();
    const { findByRole, getByRole } = render(
      <HomeView
        user={user}
        busy={false}
        error=""
        onCreateRoom={vi.fn()}
        onJoinRoom={vi.fn()}
        onSettings={vi.fn()}
        onLogout={vi.fn()}
        onSidebarStateChange={onSidebarStateChange}
      />,
    );

    expect(await findByRole('button', { name: 'Анна' })).toBeTruthy();
    expect(homeViewHarness.request).toHaveBeenCalledWith('/v1/chats');
    await waitFor(() =>
      expect(onSidebarStateChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          chats: expect.arrayContaining([
            expect.objectContaining({ id: 'chat-1' }),
            expect.objectContaining({ title: 'TRLKA' }),
          ]),
          chatsLoading: false,
          openChat: expect.any(Function),
          createGroup: expect.any(Function),
        }),
      ),
    );

    const resizer = getByRole('separator', { name: 'Изменить ширину боковой панели' });
    const initialWidth = Number(resizer.getAttribute('aria-valuenow'));
    fireEvent.keyDown(resizer, { key: 'ArrowRight' });
    expect(Number(resizer.getAttribute('aria-valuenow'))).toBeGreaterThan(initialWidth);
    expect(Number(localStorage.getItem('freetalkAccountSidebarWidth'))).toBeGreaterThan(
      initialWidth,
    );
  });

  it('keeps history pagination anchored after revealing an older pinned message', async () => {
    const user: AccountUser = {
      id: 'self',
      email: 'gera@example.com',
      username: 'german',
      displayName: 'Гера',
      emailVerified: true,
      avatarUrl: null,
      registeredAt: '2026-08-26T00:00:00.000Z',
    };
    const initialOldest = {
      id: 'page-start',
      sender_id: 'self',
      username: 'german',
      display_name: 'Гера',
      kind: 'text' as const,
      body: 'Начало загруженной страницы',
      created_at: '2026-08-26T10:00:00.000Z',
      expires_at: null,
    };
    const pinned = {
      ...initialOldest,
      id: 'pinned-old',
      body: 'Очень старое закреплённое',
      created_at: '2026-08-20T10:00:00.000Z',
      pinned_at: '2026-08-26T11:00:00.000Z',
    };
    homeViewHarness.request.mockImplementation(async (path: string) => {
      if (path === '/v1/chats') {
        return {
          chats: [
            {
              id: 'chat-1',
              type: 'group',
              title: 'Команда',
              members: [{ id: 'self', username: 'german', displayName: 'Гера', role: 'owner' }],
              currentUserRole: 'owner',
            },
          ],
        };
      }
      if (path === '/v1/friends') return { friends: [], pending: [], blocked: [] };
      if (path === '/v1/history') return { calls: [] };
      if (path === '/v1/chats/chat-1/messages') {
        return {
          messages: [initialOldest],
          pinnedMessage: pinned,
          hasMore: true,
        };
      }
      if (path === '/v1/chats/chat-1/messages/pinned-old') return { message: pinned };
      if (path.startsWith('/v1/chats/chat-1/messages?before=')) {
        return { messages: [], hasMore: false };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    const view = render(
      <HomeView
        user={user}
        busy={false}
        error=""
        page="chats"
        onCreateRoom={vi.fn()}
        onJoinRoom={vi.fn()}
        onSettings={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    fireEvent.click(await view.findByRole('button', { name: 'Команда' }));
    expect(await view.findByText('Начало загруженной страницы')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: /Закреплённое сообщение/ }));
    await waitFor(() =>
      expect(homeViewHarness.request).toHaveBeenCalledWith('/v1/chats/chat-1/messages/pinned-old'),
    );

    const scroller = view.container.querySelector<HTMLElement>('.message-scroll-container')!;
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);

    await waitFor(() =>
      expect(homeViewHarness.request).toHaveBeenCalledWith(
        `/v1/chats/chat-1/messages?before=${encodeURIComponent(initialOldest.created_at)}`,
      ),
    );
  });
});

describe('TransientNotice', () => {
  it('starts a smooth exit and dismisses itself after four seconds', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { getByRole } = render(
      <TransientNotice message="Комната не найдена" onDismiss={onDismiss} />,
    );
    const notice = getByRole('alert');

    act(() => vi.advanceTimersByTime(3_600));
    expect(notice.classList.contains('closing')).toBe(true);
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(400));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('uses the green success treatment for successful actions', () => {
    const { getByRole } = render(
      <TransientNotice message="Аватар группы сохранён" tone="success" onDismiss={vi.fn()} />,
    );
    const notice = getByRole('status');
    expect(notice.classList.contains('success')).toBe(true);
  });
});

describe('RecentRooms', () => {
  it('deduplicates reconnect entries by user and display name', () => {
    expect(
      uniqueCallParticipants([
        { userId: 'user-a', displayName: 'Gera' },
        { userId: 'user-a', displayName: 'Gera' },
        { userId: null, displayName: ' gera ' },
        { userId: 'user-b', displayName: 'Alex' },
      ]).map((participant) => participant.displayName.trim()),
    ).toEqual(['Gera', 'Alex']);
  });

  it('treats only calls with at least two unique participants as conversations', () => {
    expect(hasConversationParticipants([{ userId: 'self', displayName: 'Gera' }])).toBe(false);
    expect(
      hasConversationParticipants([
        { userId: 'self', displayName: 'Gera' },
        { userId: 'self', displayName: 'Gera' },
      ]),
    ).toBe(false);
    expect(
      hasConversationParticipants([
        { userId: 'self', displayName: 'Gera' },
        { userId: 'friend', displayName: 'Alex' },
      ]),
    ).toBe(true);
  });

  it('renders actual call history and never inserts demo rooms', () => {
    const { getByText, queryByText } = render(
      <RecentRooms
        selfId="self"
        loading={false}
        onCreateAgain={vi.fn()}
        calls={[
          {
            id: 'call-1',
            room_id: 'ROOM12345678',
            started_at: '2026-08-26T10:00:00.000Z',
            duration_seconds: 720,
            participants: [
              { userId: 'self', displayName: 'Gera' },
              { userId: 'friend', displayName: 'Alex' },
            ],
          },
        ]}
      />,
    );
    expect(getByText('Комната с Alex')).toBeTruthy();
    expect(getByText(/12 мин/)).toBeTruthy();
    expect(queryByText('Demo room')).toBeNull();
  });

  it('does not render calls where nobody joined the creator', () => {
    const { getByText, queryByText } = render(
      <RecentRooms
        selfId="self"
        loading={false}
        onCreateAgain={vi.fn()}
        calls={[
          {
            id: 'solo-call',
            room_id: 'SOLO12345678',
            started_at: '2026-08-26T10:00:00.000Z',
            duration_seconds: 720,
            participants: [{ userId: 'self', displayName: 'Gera' }],
          },
        ]}
      />,
    );
    expect(getByText('Недавних комнат пока нет')).toBeTruthy();
    expect(queryByText('Приватная комната')).toBeNull();
  });
});

describe('activeCallRoomId', () => {
  it('reuses the current chat call instead of creating a one-second duplicate', () => {
    expect(
      activeCallRoomId([
        {
          kind: 'call',
          metadata: { roomId: 'ENDED1234567', ended: true },
        },
        {
          kind: 'call',
          metadata: { roomId: 'ACTIVE123456', ended: false },
        },
      ]),
    ).toBe('ACTIVE123456');
  });
});

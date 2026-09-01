// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountUser } from '../lib/api-client';
import { AccountSidebar } from './AccountSidebar';
import type { ChatItem } from './ChatsPage';

const realtimeHarness = vi.hoisted(() => ({
  onEvent: undefined as ((event: unknown) => void) | undefined,
  onPresence: undefined as ((status: string) => void) | undefined,
}));

const overlayHarness = vi.hoisted(() => ({
  foreground: true,
  show: vi.fn(),
  onOpen: undefined as ((chatId: string) => void) | undefined,
}));

vi.mock('../lib/chat-realtime', () => ({
  ChatRealtimeClient: class {
    constructor(onEvent: (event: unknown) => void, onPresence?: (status: string) => void) {
      realtimeHarness.onEvent = onEvent;
      realtimeHarness.onPresence = onPresence;
    }
    start() {}
    stop() {}
  },
}));

vi.mock('../lib/chat-notification-overlay', () => ({
  appIsInForeground: () => overlayHarness.foreground,
  showChatNotificationOverlay: overlayHarness.show,
  listenForNotificationOpen: async (onOpen: (chatId: string) => void) => {
    overlayHarness.onOpen = onOpen;
    return () => {
      overlayHarness.onOpen = undefined;
    };
  },
}));

const user: AccountUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'gera@example.com',
  username: 'german',
  displayName: 'Gera',
  emailVerified: true,
  avatarUrl: 'https://example.com/avatar.webp',
  coverUrl: 'https://example.com/cover.webp',
  bio: 'Короткое описание профиля.',
  registeredAt: '2026-08-26T00:00:00.000Z',
};

beforeEach(() => {
  localStorage.clear();
  realtimeHarness.onEvent = undefined;
  realtimeHarness.onPresence = undefined;
  overlayHarness.foreground = true;
  overlayHarness.show.mockReset();
  overlayHarness.onOpen = undefined;
});
afterEach(cleanup);

describe('AccountSidebar in an active room', () => {
  it('switches between the shared sections and the current call', () => {
    const onNavigate = vi.fn();
    const { getByRole } = render(
      <AccountSidebar
        user={user}
        activePage="room"
        roomActive
        onNavigate={onNavigate}
        onSettings={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    fireEvent.click(getByRole('button', { name: 'Друзья' }));
    fireEvent.click(getByRole('button', { name: /Текущий звонок/ }));

    expect(onNavigate).toHaveBeenNthCalledWith(1, 'friends');
    expect(onNavigate).toHaveBeenNthCalledWith(2, 'room');
  });

  it('keeps profile controls available in the shared panel', () => {
    const onSettings = vi.fn();
    const onLogout = vi.fn();
    const { getByRole } = render(
      <AccountSidebar
        user={user}
        activePage="room"
        roomActive
        onNavigate={vi.fn()}
        onSettings={onSettings}
        onLogout={onLogout}
      />,
    );

    fireEvent.click(getByRole('button', { name: 'Открыть свой профиль' }));
    fireEvent.click(getByRole('button', { name: /Редактировать профиль/ }));
    fireEvent.click(getByRole('button', { name: 'Открыть свой профиль' }));
    fireEvent.click(getByRole('button', { name: 'Выйти из аккаунта' }));

    expect(onSettings).toHaveBeenCalledWith('profile');
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it('persists invisible mode from the profile status menu', () => {
    const { getByRole, getByText } = render(
      <AccountSidebar
        user={user}
        activePage="home"
        onNavigate={vi.fn()}
        onSettings={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    fireEvent.click(getByRole('button', { name: 'Открыть свой профиль' }));
    fireEvent.click(getByRole('button', { name: /В сети/ }));
    fireEvent.click(getByRole('menuitemradio', { name: /Невидимый/ }));

    expect(localStorage.getItem('freetalk.presence-mode')).toBe('invisible');
    expect(getByRole('dialog', { name: 'Профиль и статус' })).toBeTruthy();
    expect(getByRole('menu', { name: 'Выбор статуса' })).toBeTruthy();
    expect(getByText('Короткое описание профиля.')).toBeTruthy();
  });

  it('toggles the profile and the whole status control independently', () => {
    const { getByRole, queryByRole } = render(
      <AccountSidebar
        user={user}
        activePage="home"
        onNavigate={vi.fn()}
        onSettings={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    fireEvent.click(getByRole('button', { name: 'Открыть свой профиль' }));
    expect(getByRole('dialog', { name: 'Профиль и статус' })).toBeTruthy();

    const statusControl = getByRole('button', { name: /В сети/ });
    fireEvent.click(statusControl);
    expect(getByRole('menu', { name: 'Выбор статуса' })).toBeTruthy();

    const chevron = statusControl.querySelector('svg:last-child');
    expect(chevron).toBeTruthy();
    fireEvent.click(chevron!);
    expect(queryByRole('menu', { name: 'Выбор статуса' })).toBeNull();
    expect(getByRole('dialog', { name: 'Профиль и статус' })).toBeTruthy();

    fireEvent.click(getByRole('button', { name: 'Закрыть свой профиль' }));
    expect(queryByRole('dialog', { name: 'Профиль и статус' })).toBeNull();
  });

  it('opens the profile only from the avatar and uses the gear for settings', () => {
    const onSettings = vi.fn();
    const { getByRole, getByText, queryByRole } = render(
      <AccountSidebar
        user={user}
        activePage="home"
        onNavigate={vi.fn()}
        onSettings={onSettings}
        onLogout={vi.fn()}
      />,
    );

    fireEvent.click(getByText('Gera'));
    expect(queryByRole('dialog', { name: 'Профиль и статус' })).toBeNull();

    fireEvent.click(getByRole('button', { name: 'Открыть свой профиль' }));
    expect(getByRole('dialog', { name: 'Профиль и статус' })).toBeTruthy();

    fireEvent.click(getByRole('button', { name: 'Закрыть свой профиль' }));
    expect(queryByRole('dialog', { name: 'Профиль и статус' })).toBeNull();

    fireEvent.click(getByRole('button', { name: 'Открыть настройки профиля' }));
    expect(onSettings).toHaveBeenCalledWith('profile');
    expect(queryByRole('dialog', { name: 'Профиль и статус' })).toBeNull();
  });

  it('closes only the appropriate layer for panel clicks, outside clicks and Escape', () => {
    const { getByRole, getByText, queryByRole } = render(
      <AccountSidebar
        user={user}
        activePage="chats"
        onNavigate={vi.fn()}
        onSettings={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    fireEvent.click(getByRole('button', { name: 'Открыть свой профиль' }));
    fireEvent.click(getByRole('button', { name: /В сети/ }));
    fireEvent.pointerDown(getByText('Короткое описание профиля.'));
    expect(queryByRole('menu', { name: 'Выбор статуса' })).toBeNull();
    expect(getByRole('dialog', { name: 'Профиль и статус' })).toBeTruthy();

    fireEvent.click(getByRole('button', { name: /В сети/ }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(queryByRole('menu', { name: 'Выбор статуса' })).toBeNull();
    expect(getByRole('dialog', { name: 'Профиль и статус' })).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(queryByRole('dialog', { name: 'Профиль и статус' })).toBeNull();

    fireEvent.click(getByRole('button', { name: 'Открыть свой профиль' }));
    fireEvent.pointerDown(document.body);
    expect(queryByRole('dialog', { name: 'Профиль и статус' })).toBeNull();
  });

  it('shows an unread chat badge without an in-app notification card', () => {
    const { getByRole, queryByText } = render(
      <AccountSidebar
        user={user}
        activePage="home"
        onNavigate={vi.fn()}
        onSettings={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    act(() =>
      realtimeHarness.onEvent?.({
        type: 'message-created',
        chatId: '22222222-2222-4222-8222-222222222222',
        message: {
          id: '33333333-3333-4333-8333-333333333333',
          kind: 'text',
          body: 'Ты уже заходишь?',
          sender_id: '44444444-4444-4444-8444-444444444444',
          display_name: 'Друг',
          username: 'friend',
          avatar_url: 'https://example.com/friend.webp',
          created_at: '2026-08-28T20:00:00.000Z',
          expires_at: null,
        },
      }),
    );

    expect(getByRole('button', { name: 'Чаты, непрочитанных сообщений: 1' })).toBeTruthy();
    expect(queryByText('Ты уже заходишь?')).toBeNull();
    expect(document.querySelector('.chat-notification-stack')).toBeNull();
  });

  it('shows the external overlay in the background even for the currently open chat', () => {
    overlayHarness.foreground = false;
    render(
      <AccountSidebar
        user={user}
        activePage="chats"
        readingChatId="chat-open"
        onNavigate={vi.fn()}
        onSettings={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    act(() =>
      realtimeHarness.onEvent?.({
        type: 'message-created',
        chatId: 'chat-open',
        message: {
          id: 'message-background',
          kind: 'text',
          body: 'Сообщение в фоне',
          sender_id: 'friend-background',
          display_name: 'Друг',
          created_at: '2026-08-29T20:00:00.000Z',
          expires_at: null,
        },
      }),
    );

    expect(overlayHarness.show).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'chat-open', body: 'Сообщение в фоне' }),
    );
    expect(document.querySelector('.chat-notification-stack')).toBeNull();
  });

  it('keeps the unread badge but suppresses message previews in do-not-disturb mode', () => {
    localStorage.setItem('freetalk.presence-mode', 'dnd');
    const { getByRole, queryByText } = render(
      <AccountSidebar
        user={user}
        activePage="home"
        onNavigate={vi.fn()}
        onSettings={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    act(() =>
      realtimeHarness.onEvent?.({
        type: 'message-created',
        chatId: '55555555-5555-4555-8555-555555555555',
        message: {
          id: '66666666-6666-4666-8666-666666666666',
          kind: 'text',
          body: 'Без всплывающего уведомления',
          sender_id: '77777777-7777-4777-8777-777777777777',
          display_name: 'Друг',
          created_at: '2026-08-28T20:01:00.000Z',
          expires_at: null,
        },
      }),
    );

    expect(getByRole('button', { name: 'Чаты, непрочитанных сообщений: 1' })).toBeTruthy();
    expect(queryByText('Без всплывающего уведомления')).toBeNull();
  });

  it('shows background message previews during a call unless do-not-disturb is enabled', () => {
    overlayHarness.foreground = false;
    const { getByRole } = render(
      <AccountSidebar
        user={user}
        activePage="room"
        roomActive
        onNavigate={vi.fn()}
        onSettings={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    act(() =>
      realtimeHarness.onEvent?.({
        type: 'message-created',
        chatId: '88888888-8888-4888-8888-888888888888',
        message: {
          id: '99999999-9999-4999-8999-999999999999',
          kind: 'text',
          body: 'Сообщение во время звонка',
          sender_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          display_name: 'Друг',
          created_at: '2026-08-28T20:02:00.000Z',
          expires_at: null,
        },
      }),
    );

    expect(getByRole('button', { name: 'Чаты, непрочитанных сообщений: 1' })).toBeTruthy();
    expect(overlayHarness.show).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: '88888888-8888-4888-8888-888888888888',
        body: 'Сообщение во время звонка',
      }),
    );
  });

  it('combines chat search, navigation and group creation in the account sidebar', async () => {
    const onNavigate = vi.fn();
    const onOpenChat = vi.fn();
    const onCreateGroup = vi.fn().mockResolvedValue(true);
    const chats: ChatItem[] = [
      {
        id: 'chat-friend',
        type: 'direct',
        title: null,
        members: [
          { id: user.id, username: user.username, displayName: user.displayName },
          { id: 'friend-1', username: 'anna', displayName: 'Анна', presence: 'online' },
        ],
        lastMessage: 'Увидимся вечером',
      },
      {
        id: 'chat-group',
        type: 'group',
        title: 'Команда',
        members: [{ id: user.id, username: user.username, displayName: user.displayName }],
      },
    ];
    const { getByRole, queryByRole, queryByText } = render(
      <AccountSidebar
        user={user}
        activePage="home"
        chats={chats}
        chatsLoading
        friends={[{ id: 'friend-1', displayName: 'Анна' }]}
        onNavigate={onNavigate}
        onOpenChat={onOpenChat}
        onCreateGroup={onCreateGroup}
        onSettings={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    expect(queryByRole('button', { name: 'Чаты' })).toBeNull();
    expect(getByRole('button', { name: 'Анна' })).toBeTruthy();
    expect(queryByText('Загружаем чаты…')).toBeNull();
    fireEvent.change(getByRole('textbox', { name: 'Поиск по чатам' }), {
      target: { value: 'ком' },
    });
    await waitFor(() => expect(queryByRole('button', { name: 'Анна' })).toBeNull());
    fireEvent.click(getByRole('button', { name: 'Команда' }));
    expect(onNavigate).toHaveBeenCalledWith('chats');
    expect(onOpenChat).toHaveBeenCalledWith('chat-group');

    fireEvent.click(getByRole('button', { name: /Создать групповой чат/ }));
    fireEvent.change(getByRole('textbox', { name: 'Название группы' }), {
      target: { value: 'Проект' },
    });
    fireEvent.click(getByRole('checkbox', { name: /Анна/ }));
    fireEvent.click(getByRole('button', { name: 'Создать группу' }));

    await waitFor(() => expect(onCreateGroup).toHaveBeenCalledWith('Проект', ['friend-1']));
    expect(queryByRole('textbox', { name: 'Название группы' })).toBeNull();
  });
});

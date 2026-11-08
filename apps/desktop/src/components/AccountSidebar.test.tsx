// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
});

beforeEach(() => {
  localStorage.clear();
  vi.mocked(HTMLMediaElement.prototype.play).mockClear();
  realtimeHarness.onEvent = undefined;
  realtimeHarness.onPresence = undefined;
  overlayHarness.foreground = true;
  overlayHarness.show.mockReset();
  overlayHarness.onOpen = undefined;
});

describe('sidebar chat collections', () => {
  it('opens saved messages from the compact control and keeps them out of the chat list', () => {
    const onOpenSavedChat = vi.fn();
    const { getByRole, queryByRole } = render(
      <AccountSidebar
        user={user}
        activePage="chats"
        chats={[{ id: 'saved', type: 'direct', title: null, isSaved: true, members: [] }]}
        onNavigate={vi.fn()}
        onOpenChat={vi.fn()}
        onOpenSavedChat={onOpenSavedChat}
        onCreateGroup={vi.fn()}
        onSettings={vi.fn()}
        onLogout={vi.fn()}
      />,
    );
    fireEvent.click(getByRole('button', { name: 'Избранное' }));
    expect(onOpenSavedChat).toHaveBeenCalledOnce();
    expect(queryByRole('button', { name: 'Личный чат' })).toBeNull();
    expect(getByRole('button', { name: 'Создать групповой чат' })).toBeTruthy();
  });

  it('archives from right-click without opening the chat and restores from the archive', () => {
    const onOpenChat = vi.fn(),
      onArchiveChat = vi.fn();
    const chats: ChatItem[] = [{ id: 'chat', type: 'group', title: 'Команда', members: [] }];
    const props = {
      user,
      activePage: 'chats' as const,
      onNavigate: vi.fn(),
      onOpenChat,
      onArchiveChat,
      onCreateGroup: vi.fn(),
      onSettings: vi.fn(),
      onLogout: vi.fn(),
    };
    const view = render(<AccountSidebar {...props} chats={chats} />);
    fireEvent.contextMenu(view.getByRole('button', { name: 'Команда' }), {
      clientX: 240,
      clientY: 300,
    });
    fireEvent.click(view.getByRole('menuitem', { name: 'В архив' }));
    expect(onOpenChat).not.toHaveBeenCalled();
    expect(onArchiveChat).toHaveBeenCalledWith('chat', true);
    view.rerender(<AccountSidebar {...props} chats={[{ ...chats[0]!, archived: true }]} />);
    expect(view.queryByRole('button', { name: 'Команда' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Архив' }));
    const chat = view.getByRole('button', { name: 'Команда' });
    fireEvent.keyDown(chat, { key: 'F10', shiftKey: true });
    fireEvent.click(view.getByRole('menuitem', { name: 'Вернуть из архива' }));
    expect(onArchiveChat).toHaveBeenCalledWith('chat', false);
    fireEvent.click(view.getByRole('button', { name: 'Вернуться к чатам' }));
  });
});
afterEach(cleanup);

describe('AccountSidebar in an active room', () => {
  it('offers pin, notification mute, deletion and block without acting on destructive selection until confirmed', async () => {
    const manage = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <AccountSidebar
        user={user}
        activePage="chats"
        chats={[
          {
            id: 'chat',
            type: 'direct',
            title: null,
            members: [{ id: 'other', displayName: 'Друг', username: 'friend' }],
          },
        ]}
        onNavigate={vi.fn()}
        onOpenChat={vi.fn()}
        onCreateGroup={vi.fn()}
        onArchiveChat={vi.fn()}
        onManageChat={manage}
        onSettings={vi.fn()}
        onLogout={vi.fn()}
      />,
    );
    fireEvent.contextMenu(view.getByRole('button', { name: 'Друг' }));
    expect(view.getByRole('menuitem', { name: 'Закрепить чат' })).toBeTruthy();
    expect(view.getByRole('menuitem', { name: 'Отключить уведомления' })).toBeTruthy();
    expect(view.getByRole('menuitem', { name: 'Удалить чат' })).toBeTruthy();
    fireEvent.click(view.getByRole('menuitem', { name: 'Заблокировать' }));
    expect(manage).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: 'Заблокировать' }));
    await waitFor(() => expect(manage).toHaveBeenCalledWith('chat', 'block'));
  });
  it.each([{ muted: true }, { archived: true }])(
    'suppresses background notifications for personal preference %j',
    (preference) => {
      overlayHarness.foreground = false;
      render(
        <AccountSidebar
          user={user}
          activePage="room"
          chats={[{ id: 'quiet', type: 'direct', title: null, members: [], ...preference }]}
          onNavigate={vi.fn()}
          onSettings={vi.fn()}
          onLogout={vi.fn()}
        />,
      );
      act(() =>
        realtimeHarness.onEvent?.({
          type: 'message-created',
          chatId: 'quiet',
          message: {
            id: 'message',
            kind: 'text',
            body: 'Тихо',
            sender_id: 'other',
            display_name: 'Друг',
            created_at: new Date().toISOString(),
          },
        }),
      );
      expect(overlayHarness.show).not.toHaveBeenCalled();
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    },
  );
  it('returns to the current call after navigating to another section', () => {
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
    expect(
      getByRole('button', { name: /Текущий звонок/ }).getAttribute('aria-disabled'),
    ).toBeNull();
  });

  it('keeps the current call directly below chat search in the unified sidebar', () => {
    const onNavigate = vi.fn();
    const { getByRole } = render(
      <AccountSidebar
        user={user}
        activePage="room"
        roomActive
        chats={[]}
        friends={[]}
        updateStatus={{ kind: 'available', version: '0.4.0-beta.76' }}
        onNavigate={onNavigate}
        onOpenChat={vi.fn()}
        onCreateGroup={vi.fn().mockResolvedValue(true)}
        onSettings={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    const search = getByRole('textbox', { name: 'Поиск по чатам' });
    const currentCall = getByRole('button', { name: /Текущий звонок/ });
    const update = getByRole('button', { name: 'Обновиться до версии Beta 76' });
    const home = getByRole('button', { name: 'Главная' });

    expect(search.compareDocumentPosition(currentCall) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(currentCall.compareDocumentPosition(update) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(currentCall.compareDocumentPosition(home) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    fireEvent.click(currentCall);
    expect(onNavigate).toHaveBeenCalledWith('room');
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

  it('persists invisible mode from the profile status carousel', () => {
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
    fireEvent.click(getByRole('button', { name: 'Предыдущий статус' }));

    expect(localStorage.getItem('freetalk.presence-mode')).toBe('invisible');
    expect(getByRole('dialog', { name: 'Профиль и статус' })).toBeTruthy();
    expect(getByRole('button', { name: 'Следующий статус' })).toBeTruthy();
    expect(getByText('Короткое описание профиля.')).toBeTruthy();
  });

  it('cycles status in both directions without opening another menu', () => {
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
    fireEvent.click(getByRole('button', { name: 'Следующий статус' }));
    expect(localStorage.getItem('freetalk.presence-mode')).toBe('away');
    fireEvent.click(getByRole('button', { name: 'Предыдущий статус' }));
    expect(localStorage.getItem('freetalk.presence-mode')).toBe('auto');
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

  it('keeps the carousel open for inside clicks and closes on Escape or outside click', () => {
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
    fireEvent.click(getByRole('button', { name: 'Следующий статус' }));
    fireEvent.pointerDown(getByText('Короткое описание профиля.'));
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
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
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
        avatarUrl: 'data:image/png;base64,group-avatar',
        avatarPositionX: 35,
        avatarPositionY: 20,
        avatarScale: 150,
      },
    ];
    const { getByRole, queryByRole, queryByText } = render(
      <AccountSidebar
        user={user}
        activePage="home"
        chats={chats}
        chatsLoading
        friends={[{ id: 'friend-1', displayName: 'Анна', presence: 'online' }]}
        onNavigate={onNavigate}
        onOpenChat={onOpenChat}
        onCreateGroup={onCreateGroup}
        onSettings={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    expect(queryByRole('button', { name: 'Чаты' })).toBeNull();
    expect(
      getByRole('button', { name: 'Анна' }).querySelector('.avatar-presence-badge.online'),
    ).not.toBeNull();
    expect(
      getByRole('button', { name: 'Команда' }).querySelector('.avatar-presence-badge'),
    ).toBeNull();
    expect(getByRole('button', { name: 'Команда' }).querySelector('img')?.style.cssText).toContain(
      'object-position: 35% 20%',
    );
    expect(getByRole('button', { name: 'Команда' }).querySelector('img')?.style.transform).toBe(
      'translate(-7.5%, -15%) scale(1.5)',
    );
    expect(queryByRole('button', { name: 'Открыть полный профиль Анна' })).toBeNull();
    fireEvent.click(getByRole('button', { name: 'Анна' }));
    expect(onNavigate).toHaveBeenCalledWith('chats');
    expect(onOpenChat).toHaveBeenCalledWith('chat-friend');
    expect(queryByText('Загружаем чаты…')).toBeNull();
    fireEvent.change(getByRole('textbox', { name: 'Поиск по чатам' }), {
      target: { value: 'ком' },
    });
    await waitFor(() => expect(queryByRole('button', { name: 'Анна' })).toBeNull());
    fireEvent.click(getByRole('button', { name: 'Команда' }));
    expect(onNavigate).toHaveBeenCalledWith('chats');
    expect(onOpenChat).toHaveBeenCalledWith('chat-group');

    fireEvent.click(getByRole('button', { name: /Создать групповой чат/ }));
    expect(getByRole('dialog', { name: 'Новый групповой чат' })).toBeTruthy();
    expect(getByRole('textbox', { name: 'Поиск участников' })).toBeTruthy();
    fireEvent.change(getByRole('textbox', { name: 'Название группы' }), {
      target: { value: 'Проект' },
    });
    fireEvent.click(getByRole('checkbox', { name: /Анна/ }));
    fireEvent.click(getByRole('button', { name: 'Создать группу' }));

    await waitFor(() => expect(onCreateGroup).toHaveBeenCalledWith('Проект', ['friend-1']));
    expect(queryByRole('textbox', { name: 'Название группы' })).toBeNull();
  });

  it('confirms leaving a group from the hover action without offering it for direct chats', async () => {
    const onLeaveGroup = vi.fn(async () => undefined);
    const chats: ChatItem[] = [
      {
        id: 'chat-friend',
        type: 'direct',
        title: null,
        members: [
          { id: user.id, username: user.username, displayName: user.displayName },
          { id: 'friend-1', username: 'anna', displayName: 'Анна' },
        ],
      },
      {
        id: 'chat-group',
        type: 'group',
        title: 'Команда',
        members: [{ id: user.id, username: user.username, displayName: user.displayName }],
      },
    ];
    const { getByRole, queryByRole } = render(
      <AccountSidebar
        user={user}
        activePage="home"
        chats={chats}
        friends={[]}
        onNavigate={vi.fn()}
        onOpenChat={vi.fn()}
        onCreateGroup={vi.fn(async () => true)}
        onLeaveGroup={onLeaveGroup}
        onSettings={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    expect(queryByRole('button', { name: /Покинуть группу Анна/ })).toBeNull();
    fireEvent.click(getByRole('button', { name: 'Покинуть группу Команда' }));
    expect(getByRole('alertdialog')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Покинуть группу' }));

    await waitFor(() => expect(onLeaveGroup).toHaveBeenCalledWith('chat-group'));
    await waitFor(() => expect(queryByRole('alertdialog')).toBeNull());
  });

  it('offers an available update directly below chat search', () => {
    const onInstallUpdate = vi.fn();
    const { getByRole } = render(
      <AccountSidebar
        user={user}
        activePage="home"
        chats={[]}
        updateStatus={{ kind: 'available', version: '0.4.0-beta.76' }}
        onNavigate={vi.fn()}
        onOpenChat={vi.fn()}
        onCreateGroup={vi.fn().mockResolvedValue(true)}
        onInstallUpdate={onInstallUpdate}
        onSettings={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    fireEvent.click(getByRole('button', { name: 'Обновиться до версии Beta 76' }));
    expect(onInstallUpdate).toHaveBeenCalledOnce();
  });
});

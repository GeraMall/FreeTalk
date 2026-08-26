// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ChatsPage, MessageList, type ChatItem, type MessageItem } from './ChatsPage';

const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
const originalScrollTo = HTMLElement.prototype.scrollTo;

function message(id: string, senderId: string, body = `Сообщение ${id}`): MessageItem {
  return {
    id,
    sender_id: senderId,
    username: senderId,
    display_name: senderId === 'self' ? 'Гера' : 'Алексей',
    kind: 'text',
    body,
    created_at: `2026-08-26T10:${id.padStart(2, '0')}:00.000Z`,
    expires_at: '2026-08-27T10:00:00.000Z',
  };
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      return (this as HTMLElement).classList?.contains('message-scroll-container')
        ? 500 + (this as HTMLElement).querySelectorAll('.message-entry').length * 100
        : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return (this as HTMLElement).classList?.contains('message-scroll-container') ? 200 : 0;
    },
  });
  HTMLElement.prototype.scrollTo = function scrollTo(options?: ScrollToOptions | number) {
    this.scrollTop = typeof options === 'number' ? options : (options?.top ?? 0);
  };
});

afterAll(() => {
  if (originalScrollHeight)
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight);
  if (originalClientHeight)
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
  HTMLElement.prototype.scrollTo = originalScrollTo;
});

afterEach(cleanup);

function view(
  chatId: string,
  messages: MessageItem[],
  sentMessageVersion = 0,
  onJoinCall = vi.fn(),
) {
  return (
    <MessageList
      chatId={chatId}
      userId="self"
      groupChat
      messages={messages}
      loading={false}
      error=""
      sentMessageVersion={sentMessageVersion}
      onRetry={vi.fn()}
      onJoinCall={onJoinCall}
    />
  );
}

describe('MessageList scrolling', () => {
  it('opens each chat at the newest message', () => {
    const { container, rerender } = render(view('chat-a', [message('1', 'friend')]));
    const scroller = container.querySelector<HTMLElement>('.message-scroll-container')!;
    expect(scroller.scrollTop).toBe(scroller.scrollHeight);

    scroller.scrollTop = 120;
    rerender(view('chat-b', [message('2', 'friend')]));
    expect(scroller.scrollTop).toBe(scroller.scrollHeight);
  });

  it('does not interrupt reading old messages and shows the new-message button', () => {
    const initial = [message('1', 'friend'), message('2', 'self')];
    const { container, rerender, getByRole } = render(view('chat-a', initial));
    const scroller = container.querySelector<HTMLElement>('.message-scroll-container')!;
    scroller.scrollTop = 200;
    fireEvent.scroll(scroller);

    rerender(view('chat-a', [...initial, message('3', 'friend')]));
    expect(scroller.scrollTop).toBe(200);
    fireEvent.click(getByRole('button', { name: /Новые сообщения/ }));
    expect(scroller.scrollTop).toBe(scroller.scrollHeight);
  });

  it('scrolls down after sending a local message even when the user was above the end', () => {
    const initial = [message('1', 'friend')];
    const { container, rerender } = render(view('chat-a', initial));
    const scroller = container.querySelector<HTMLElement>('.message-scroll-container')!;
    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);

    rerender(view('chat-a', [...initial, message('2', 'self')], 1));
    expect(scroller.scrollTop).toBe(scroller.scrollHeight);
  });

  it('preserves the visible position when older messages are prepended', () => {
    const initial = [message('2', 'friend'), message('3', 'self')];
    const { container, rerender } = render(view('chat-a', initial));
    const scroller = container.querySelector<HTMLElement>('.message-scroll-container')!;
    scroller.scrollTop = 200;
    fireEvent.scroll(scroller);

    rerender(view('chat-a', [message('1', 'friend'), ...initial]));
    expect(scroller.scrollTop).toBe(300);
  });

  it('loads older messages when the reader reaches the top', async () => {
    const onLoadOlder = vi.fn(async () => undefined);
    const { container } = render(
      <MessageList
        chatId="chat-a"
        userId="self"
        groupChat
        messages={[message('2', 'friend')]}
        loading={false}
        error=""
        sentMessageVersion={0}
        hasMore
        onRetry={vi.fn()}
        onLoadOlder={onLoadOlder}
        onJoinCall={vi.fn()}
      />,
    );
    const scroller = container.querySelector<HTMLElement>('.message-scroll-container')!;
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);
    await waitFor(() => expect(onLoadOlder).toHaveBeenCalledOnce());
  });
});

describe('MessageList rendering', () => {
  it('renders message bubbles, date separators and call cards', () => {
    const onJoinCall = vi.fn();
    const call: MessageItem = {
      ...message('3', 'friend', 'Алексей начал звонок'),
      kind: 'call',
      metadata: { roomId: 'ROOM12345678' },
    };
    const { getByText, getByRole, container } = render(
      view('chat-a', [message('1', 'friend'), message('2', 'self'), call], 0, onJoinCall),
    );

    expect(container.querySelectorAll('.message-bubble').length).toBe(2);
    expect(container.querySelector('.message-date-separator')).not.toBeNull();
    expect(getByText('Алексей начал звонок')).not.toBeNull();
    fireEvent.click(getByRole('button', { name: 'Присоединиться' }));
    expect(onJoinCall).toHaveBeenCalledWith('ROOM12345678');
  });

  it('renders sender avatars inside message groups', () => {
    const withAvatar = {
      ...message('1', 'friend'),
      avatar_url: 'https://api.example.test/avatar.webp',
    };
    const { container } = render(view('chat-a', [withAvatar]));
    expect(container.querySelector('.message-bubble-row img')?.getAttribute('src')).toBe(
      withAvatar.avatar_url,
    );
  });
});

describe('Chat retention controls', () => {
  const ownerChat: ChatItem = {
    id: 'chat-a',
    type: 'group',
    title: 'Команда',
    members: [{ id: 'self', username: 'gera_1', displayName: 'Гера' }],
    retentionHours: 720,
    currentUserRole: 'owner',
  };

  it('lets the owner change retention and requires confirmation before clearing', async () => {
    const onUpdateRetention = vi.fn(async () => undefined);
    const onClearHistory = vi.fn(async () => undefined);
    const { getByRole } = render(
      <ChatsPage
        userId="self"
        chats={[ownerChat]}
        friends={[]}
        activeChatId="chat-a"
        messages={[]}
        chatsLoading={false}
        messagesLoading={false}
        messagesError=""
        sentMessageVersion={0}
        onOpenChat={vi.fn(async () => undefined)}
        onRetryMessages={vi.fn()}
        onSendMessage={vi.fn(async () => true)}
        onCreateGroup={vi.fn(async () => true)}
        onJoinInvite={vi.fn(async () => true)}
        onStartCall={vi.fn(async () => undefined)}
        onCreateInvite={vi.fn(async () => undefined)}
        onUpdateRetention={onUpdateRetention}
        onClearHistory={onClearHistory}
        onAddMember={vi.fn(async () => true)}
        onJoinCall={vi.fn()}
      />,
    );

    fireEvent.click(getByRole('button', { name: 'Действия с чатом' }));
    fireEvent.click(getByRole('button', { name: 'Настройки чата' }));
    fireEvent.change(getByRole('combobox', { name: 'Срок хранения сообщений' }), {
      target: { value: 'forever' },
    });
    expect(onUpdateRetention).toHaveBeenCalledWith(null);
    await waitFor(() =>
      expect(
        (getByRole('combobox', { name: 'Срок хранения сообщений' }) as HTMLSelectElement).disabled,
      ).toBe(false),
    );

    fireEvent.click(getByRole('button', { name: 'Очистить чат' }));
    expect(onClearHistory).not.toHaveBeenCalled();
    fireEvent.click(getByRole('button', { name: 'Подтвердить очистку' }));
    expect(onClearHistory).toHaveBeenCalledOnce();
  });
});

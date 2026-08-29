// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ChatsPage, MessageList, type ChatItem, type MessageItem } from './ChatsPage';
import { accountClient } from '../lib/api-client';

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

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

  it('turns an ended call action red and prevents joining it again', () => {
    const onJoinCall = vi.fn();
    const call: MessageItem = {
      ...message('3', 'friend', 'Алексей начал звонок'),
      kind: 'call',
      metadata: { roomId: 'ROOM12345678', ended: true },
    };
    const { getByText, queryByRole, container } = render(view('chat-a', [call], 0, onJoinCall));

    expect(getByText('Звонок завершён')).toBeTruthy();
    expect(queryByRole('button', { name: 'Присоединиться' })).toBeNull();
    expect(container.querySelector('.system-call-message.ended')).not.toBeNull();
    expect(onJoinCall).not.toHaveBeenCalled();
  });

  it('shows overlapping participant avatars and the final call duration', () => {
    const call: MessageItem = {
      ...message('3', 'friend', 'Алексей начал звонок'),
      kind: 'call',
      metadata: {
        roomId: 'ROOM12345678',
        ended: true,
        startedAt: '2026-08-26T10:00:00.000Z',
        endedAt: '2026-08-26T10:02:05.000Z',
        participants: [
          { userId: 'friend', displayName: 'Алексей', avatarUrl: 'https://example.test/a.jpg' },
          { userId: 'self', displayName: 'Гера' },
        ],
      },
    };
    const { container, getByLabelText } = render(view('chat-a', [call]));

    expect(container.querySelectorAll('.system-call-participant')).toHaveLength(2);
    expect(getByLabelText('Участники: Алексей, Гера')).toBeTruthy();
    expect(getByLabelText('Время разговора 2:05')).toBeTruthy();
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

  it('renders group avatar changes as compact system messages', () => {
    const systemMessage: MessageItem = {
      ...message('4', 'self', 'Гера обновил(а) фотографию группы'),
      kind: 'system',
    };
    const { getByText, container } = render(view('chat-a', [systemMessage]));
    expect(getByText('Гера обновил(а) фотографию группы')).toBeTruthy();
    expect(container.querySelector('.system-message')).not.toBeNull();
  });

  it('turns an in-app group invite link into a join card', async () => {
    const token = 'a'.repeat(32);
    vi.spyOn(accountClient, 'request').mockResolvedValue({
      chat: {
        id: 'group-a',
        title: 'Команда FreeTalk',
        memberCount: 7,
        avatarUrl: null,
        avatarPositionX: 50,
        avatarPositionY: 50,
        avatarScale: 100,
        isMember: false,
      },
    });
    const onJoinInvite = vi.fn(async () => true);
    const invite = message('5', 'friend', `freetalk://chat/${token}`);
    const { findByText, getByRole, container } = render(
      <MessageList
        chatId="chat-a"
        userId="self"
        groupChat
        messages={[invite]}
        loading={false}
        error=""
        sentMessageVersion={0}
        onRetry={vi.fn()}
        onJoinCall={vi.fn()}
        onJoinInvite={onJoinInvite}
      />,
    );

    expect(await findByText('Команда FreeTalk')).toBeTruthy();
    expect(await findByText('7 участников')).toBeTruthy();
    expect(container.querySelector('.invite-message-bubble')).not.toBeNull();
    fireEvent.click(getByRole('button', { name: 'Вступить' }));
    await waitFor(() => expect(onJoinInvite).toHaveBeenCalledWith(token));
  });

  it('loads protected image messages through the authenticated client', async () => {
    const createObjectUrl = vi.fn(() => 'blob:freetalk-photo');
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });
    vi.spyOn(accountClient, 'chatImageBlob').mockResolvedValue(
      new Blob(['photo'], { type: 'image/webp' }),
    );
    const imageMessage: MessageItem = {
      ...message('6', 'friend', 'Смотри'),
      kind: 'image',
      metadata: { width: 1600, height: 900 },
    };
    const { findByAltText, getByRole, queryByRole } = render(view('chat-a', [imageMessage]));

    const image = await findByAltText('Фотография от Алексей');
    expect(image.getAttribute('src')).toBe('blob:freetalk-photo');
    expect(image.closest('.message-bubble')?.classList.contains('image-message-bubble')).toBe(true);
    expect(accountClient.chatImageBlob).toHaveBeenCalledWith(imageMessage.id);
    fireEvent.click(image);
    const viewer = getByRole('dialog', { name: 'Фотография от Алексей' });
    expect(viewer).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.animationEnd(viewer);
    expect(queryByRole('dialog', { name: 'Фотография от Алексей' })).toBeNull();
  });

  it('shows a shimmer placeholder without loading text while a photo is fetched', () => {
    vi.spyOn(accountClient, 'chatImageBlob').mockReturnValue(new Promise(() => {}));
    const imageMessage: MessageItem = {
      ...message('7', 'friend', ''),
      kind: 'image',
      metadata: { width: 1200, height: 800 },
    };
    const { getByRole, queryByText } = render(view('chat-a', [imageMessage]));

    const placeholder = getByRole('status', { name: 'Загружаем фотографию' });
    expect(placeholder.classList.contains('chat-image-loading')).toBe(true);
    expect((placeholder as HTMLElement).style.aspectRatio).toBe('1200 / 800');
    expect(queryByText('Загружаем фотографию…')).toBeNull();
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

  it('opens the group avatar editor and shows the member list in the right panel', async () => {
    const onUpdateGroupAvatar = vi.fn(async () => true);
    const chat: ChatItem = {
      ...ownerChat,
      avatarUrl: 'https://api.example.test/group.webp',
      avatarPositionX: 42,
      avatarPositionY: 61,
      avatarScale: 135,
      members: [
        { id: 'self', username: 'gera_1', displayName: 'Гера', role: 'owner' },
        { id: 'friend', username: 'alex_1', displayName: 'Алексей', role: 'member' },
      ],
    };
    const { getByRole, getByText, getByAltText, queryByRole } = render(
      <ChatsPage
        userId="self"
        chats={[chat]}
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
        onUpdateRetention={vi.fn(async () => undefined)}
        onClearHistory={vi.fn(async () => undefined)}
        onAddMember={vi.fn(async () => true)}
        onUpdateGroupAvatar={onUpdateGroupAvatar}
        onJoinCall={vi.fn()}
      />,
    );

    expect(getByRole('complementary', { name: 'Участники группы' })).toBeTruthy();
    expect(getByText('Участники — 2')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Изменить аватар группы' }));
    expect(getByRole('dialog', { name: 'Аватар группы' })).toBeTruthy();
    const preview = getByAltText('Предпросмотр аватара группы') as HTMLImageElement;
    expect(preview.style.transform).toContain('translate(');
    fireEvent.change(getByRole('slider', { name: 'Размер аватара' }), {
      target: { value: '150' },
    });
    expect(preview.style.transform).toContain('scale(1.5)');
    fireEvent.click(getByRole('button', { name: /Сохранить/ }));
    await waitFor(() =>
      expect(onUpdateGroupAvatar).toHaveBeenCalledWith('chat-a', undefined, 42, 61, 150),
    );
    await waitFor(() => expect(queryByRole('dialog', { name: 'Аватар группы' })).toBeNull());

    fireEvent.click(getByRole('button', { name: 'Изменить аватар группы' }));
    fireEvent.click(getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(queryByRole('dialog', { name: 'Аватар группы' })).toBeNull());

    fireEvent.click(getByRole('button', { name: 'Изменить аватар группы' }));
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(queryByRole('dialog', { name: 'Аватар группы' })).toBeNull());
  });
});

describe('Resizable chat list', () => {
  const chat: ChatItem = {
    id: 'chat-a',
    type: 'direct',
    title: null,
    members: [
      { id: 'self', username: 'gera_1', displayName: 'Гера' },
      { id: 'friend', username: 'alex_1', displayName: 'Алексей' },
    ],
  };

  const renderPage = (onSendImage = vi.fn(async () => true)) =>
    render(
      <ChatsPage
        userId="self"
        chats={[chat]}
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
        onSendImage={onSendImage}
        onCreateGroup={vi.fn(async () => true)}
        onJoinInvite={vi.fn(async () => true)}
        onStartCall={vi.fn(async () => undefined)}
        onCreateInvite={vi.fn(async () => undefined)}
        onUpdateRetention={vi.fn(async () => undefined)}
        onClearHistory={vi.fn(async () => undefined)}
        onAddMember={vi.fn(async () => true)}
        onJoinCall={vi.fn()}
      />,
    );

  it('shrinks only to the left and restores the saved width', () => {
    const first = renderPage();
    const divider = first.getByRole('separator', { name: 'Изменить ширину списка чатов' });
    const pointerEvent = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      return event;
    };
    fireEvent(divider, pointerEvent('pointerdown', 300));
    fireEvent(divider, pointerEvent('pointermove', 220));
    fireEvent(divider, pointerEvent('pointerup', 220));

    expect(localStorage.getItem('freetalkChatSidebarWidth')).toBe('220');
    expect(
      first.container
        .querySelector<HTMLElement>('.messenger-layout')
        ?.style.getPropertyValue('--conversation-sidebar-width'),
    ).toBe('220px');

    first.unmount();
    const second = renderPage();
    expect(
      second.container
        .querySelector<HTMLElement>('.messenger-layout')
        ?.style.getPropertyValue('--conversation-sidebar-width'),
    ).toBe('220px');
  });

  it('prepares and sends an image pasted into the message field', async () => {
    const onSendImage = vi.fn(async () => true);
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 320, height: 180, close })),
    );
    const { getByRole, findByAltText } = renderPage(onSendImage);
    const textarea = getByRole('textbox', { name: 'Сообщение' });
    const image = new File(['photo'], 'clipboard.png', { type: 'image/png' });

    fireEvent.paste(textarea, {
      clipboardData: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }],
      },
    });

    expect(await findByAltText('Предпросмотр отправляемой фотографии')).toBeTruthy();
    fireEvent.change(textarea, { target: { value: 'Из буфера' } });
    fireEvent.click(getByRole('button', { name: 'Отправить сообщение' }));
    await waitFor(() =>
      expect(onSendImage).toHaveBeenCalledWith(
        expect.stringMatching(/^data:image\/png;base64,/),
        'Из буфера',
      ),
    );
    expect(close).toHaveBeenCalledOnce();
  });
});

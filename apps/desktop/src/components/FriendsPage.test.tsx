// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FriendsPage, type FriendItem, type PendingItem } from './FriendsPage';

const friend: FriendItem = {
  id: 'friend-1',
  username: 'alexey',
  display_name: 'Алексей',
  avatarUrl: null,
};
const pending: PendingItem = {
  id: 'request-1',
  username: 'dmitry',
  display_name: 'Дмитрий',
  sender_id: 'friend-2',
  recipient_id: 'self',
};

function callbacks() {
  return {
    onRetry: vi.fn(),
    onAdd: vi.fn().mockResolvedValue(undefined),
    onAccept: vi.fn().mockResolvedValue(undefined),
    onDecline: vi.fn().mockResolvedValue(undefined),
    onMessage: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockResolvedValue(undefined),
    onBlock: vi.fn().mockResolvedValue(undefined),
    onUnblock: vi.fn().mockResolvedValue(undefined),
  };
}

afterEach(cleanup);

describe('FriendsPage', () => {
  it('filters friends and sends an exact username request', async () => {
    const handlers = callbacks();
    const secondFriend = { ...friend, id: 'friend-2', username: 'gera', display_name: 'Гера' };
    const { getByPlaceholderText, getByRole, queryByText } = render(
      <FriendsPage
        userId="self"
        friends={[friend, secondFriend]}
        pending={[]}
        blocked={[]}
        loading={false}
        loadError=""
        {...handlers}
      />,
    );

    fireEvent.change(getByPlaceholderText('Найти по @username'), {
      target: { value: '@alexey' },
    });
    expect(queryByText('Гера')).toBeNull();
    fireEvent.click(getByRole('button', { name: 'Добавить' }));

    await waitFor(() => expect(handlers.onAdd).toHaveBeenCalledWith('alexey'));
  });

  it('keeps secondary friend actions inside the compact menu', () => {
    const handlers = callbacks();
    const { getByText } = render(
      <FriendsPage
        userId="self"
        friends={[friend]}
        pending={[]}
        blocked={[]}
        loading={false}
        loadError=""
        {...handlers}
      />,
    );

    const menu = document.querySelector<HTMLDetailsElement>('.friend-actions-menu')!;
    expect(menu.open).toBe(false);
    fireEvent.click(menu.querySelector('summary')!);
    expect(menu.open).toBe(true);
    expect(getByText('Удалить из друзей')).not.toBeNull();
    expect(getByText('Заблокировать')).not.toBeNull();
  });

  it('shows and accepts incoming requests from the pending filter', async () => {
    const handlers = callbacks();
    const { getByRole, getByText } = render(
      <FriendsPage
        userId="self"
        friends={[]}
        pending={[pending]}
        blocked={[]}
        loading={false}
        loadError=""
        {...handlers}
      />,
    );

    fireEvent.click(getByRole('button', { name: /Ожидают/ }));
    expect(getByText('Входящий запрос')).not.toBeNull();
    fireEvent.click(getByRole('button', { name: 'Принять' }));
    await waitFor(() => expect(handlers.onAccept).toHaveBeenCalledWith('request-1'));
  });

  it('renders loading, error and retry states', () => {
    const handlers = callbacks();
    const { rerender, getByLabelText, getByRole } = render(
      <FriendsPage
        userId="self"
        friends={[]}
        pending={[]}
        blocked={[]}
        loading
        loadError=""
        {...handlers}
      />,
    );
    expect(getByLabelText('Загрузка списка друзей')).not.toBeNull();

    rerender(
      <FriendsPage
        userId="self"
        friends={[]}
        pending={[]}
        blocked={[]}
        loading={false}
        loadError="Сервер недоступен"
        {...handlers}
      />,
    );
    fireEvent.click(getByRole('button', { name: /Повторить/ }));
    expect(handlers.onRetry).toHaveBeenCalledOnce();
  });
});

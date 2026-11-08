// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MessageReceiptMenuItem } from './MessageReadReceipt';
import { accountClient } from '../lib/api-client';
import { emitChatInteraction } from '../lib/chat-interactions';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const readers = [
  { id: 'one', name: 'Даня', readAt: '2026-11-08T15:09:00Z' },
  { id: 'two', name: 'Егорыч', readAt: '2026-11-08T15:11:00Z' },
];
it('shows a group count and avatar stack, opens names and exact times on hover and tap', () => {
  vi.useFakeTimers();
  const view = render(
    <MessageReceiptMenuItem messageId="group" source={{ group: true, readers }} />,
  );
  const row = view.getByRole('menuitem', { name: '2 просмотра' });
  expect(
    view.container.querySelectorAll('.message-receipt-avatars .message-reader-avatar'),
  ).toHaveLength(2);
  fireEvent.mouseEnter(row);
  expect(view.getByRole('dialog', { name: 'Кто просмотрел' })).toBeTruthy();
  expect(view.getByText('Даня')).toBeTruthy();
  expect(view.getByText('Егорыч')).toBeTruthy();
  expect(view.container.ownerDocument.querySelector('time')?.getAttribute('dateTime')).toBe(
    new Date(readers[0].readAt).toISOString(),
  );
  fireEvent.mouseLeave(row);
  act(() => vi.advanceTimersByTime(181));
  expect(view.queryByRole('dialog')).toBeNull();
  fireEvent.click(row);
  expect(view.getByRole('dialog')).toBeTruthy();
  fireEvent.click(row);
  expect(view.getByRole('dialog')).toBeTruthy();
});
it('uses only a noninteractive Seen status in direct messages', () => {
  const view = render(<MessageReceiptMenuItem messageId="dm" source={{ group: false, readers }} />);
  const row = view.getByRole('menuitem', { name: 'Просмотрено' });
  expect(row.getAttribute('aria-disabled')).toBe('true');
  expect(view.container.querySelector('.message-receipt-avatars')).toBeNull();
  fireEvent.mouseEnter(row);
  fireEvent.click(row);
  expect(view.queryByRole('dialog')).toBeNull();
});
it('loads real views for the own message and refreshes only its matching realtime event', async () => {
  const request = vi.spyOn(accountClient, 'request').mockResolvedValue({ readers: [] });
  const view = render(
    <MessageReceiptMenuItem messageId="live" source={{ group: true, chatId: 'chat' }} />,
  );
  await waitFor(() => expect(view.getByRole('menuitem', { name: '0 просмотров' })).toBeTruthy());
  request.mockResolvedValue({ readers });
  act(() => emitChatInteraction({ type: 'chat-reads', chatId: 'elsewhere', messageIds: ['live'] }));
  expect(request).toHaveBeenCalledTimes(1);
  act(() => emitChatInteraction({ type: 'chat-reads', chatId: 'chat', messageIds: ['live'] }));
  await waitFor(() => expect(view.getByRole('menuitem', { name: '2 просмотра' })).toBeTruthy());
  expect(request).toHaveBeenLastCalledWith('/v1/chats/chat/messages/live/readers');
});

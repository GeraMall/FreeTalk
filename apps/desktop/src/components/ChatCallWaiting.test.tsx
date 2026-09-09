// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatCallWaiting } from './ChatCallWaiting';
import { accountClient } from '../lib/api-client';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const call = {
  roomId: 'ABCDEFGHJKLM',
  chatId: 'chat',
  title: 'Алексей',
  startedAt: '2026-09-09T10:00:00.000Z',
  participants: [{ userId: 'a', displayName: 'Алексей', avatarUrl: null }],
};
describe('ChatCallWaiting', () => {
  it('offers late join to an active call independently of an expired invitation', async () => {
    vi.spyOn(accountClient, 'request').mockResolvedValue({ call });
    const join = vi.fn();
    const view = render(<ChatCallWaiting chatId="chat" revision={1} onJoin={join} />);
    fireEvent.click(await view.findByText('Присоединиться'));
    expect(join).toHaveBeenCalledWith(call.roomId);
  });
  it('does not duplicate the joined call and hides ended calls', async () => {
    vi.spyOn(accountClient, 'request').mockResolvedValue({ call });
    const view = render(
      <ChatCallWaiting chatId="chat" joinedRoomId={call.roomId} revision={1} onJoin={vi.fn()} />,
    );
    await waitFor(() => expect(accountClient.request).toHaveBeenCalled());
    expect(view.queryByText('Присоединиться')).toBeNull();
    vi.mocked(accountClient.request).mockResolvedValue({ call: null });
    await act(async () =>
      view.rerender(<ChatCallWaiting chatId="chat" revision={2} onJoin={vi.fn()} />),
    );
    expect(view.queryByText('Присоединиться')).toBeNull();
  });
  it('does not poll or show a stale waiting room while this chat is already joined', async () => {
    const request = vi.spyOn(accountClient, 'request').mockResolvedValue({ call });
    const view = render(
      <ChatCallWaiting
        chatId="chat"
        joinedChatId="chat"
        joinedRoomId="STALE-ROOM-ID"
        revision={1}
        onJoin={vi.fn()}
      />,
    );
    await act(async () => undefined);
    expect(request).not.toHaveBeenCalled();
    expect(view.queryByText('Присоединиться')).toBeNull();
  });
  it('hides a stale call containing only the current user', async () => {
    vi.spyOn(accountClient, 'request').mockResolvedValue({ call });
    const view = render(
      <ChatCallWaiting chatId="chat" currentUserId="a" revision={1} onJoin={vi.fn()} />,
    );
    await waitFor(() => expect(accountClient.request).toHaveBeenCalled());
    expect(view.queryByText('Присоединиться')).toBeNull();
  });
});

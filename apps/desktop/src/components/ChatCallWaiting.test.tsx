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
});

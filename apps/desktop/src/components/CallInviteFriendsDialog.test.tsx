// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CallInviteFriendsDialog } from './CallInviteFriendsDialog';

afterEach(cleanup);

describe('CallInviteFriendsDialog', () => {
  it('marks participants and sends only newly selected friends', async () => {
    const onInvite = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    const onCopyInvite = vi.fn();
    const friends = [
      { id: 'already-here', displayName: 'Анна', presence: 'online' as const },
      { id: 'available', displayName: 'Борис', presence: 'away' as const },
    ];

    const screen = render(
      <CallInviteFriendsDialog
        open
        friends={friends}
        participantAccountIds={['already-here']}
        participantCount={5}
        capacity={8}
        roomId="ROOM123"
        inviteCopied={false}
        onClose={onClose}
        onCopyInvite={onCopyInvite}
        onInvite={onInvite}
      />,
    );

    expect(screen.getByText('Вы можете добавить ещё 3 · 5 из 8')).toBeTruthy();
    expect(screen.getByText('ROOM123')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Копировать' }));
    expect(onCopyInvite).toHaveBeenCalledOnce();
    expect(
      (screen.getByRole('checkbox', { name: 'Анна уже в звонке' }) as HTMLInputElement).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Пригласить Борис' }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));

    await waitFor(() => expect(onInvite).toHaveBeenCalledWith(['available']));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

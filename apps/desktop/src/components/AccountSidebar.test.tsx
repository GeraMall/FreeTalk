// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountUser } from '../lib/api-client';
import { AccountSidebar } from './AccountSidebar';

const user: AccountUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'gera@example.com',
  username: 'german',
  displayName: 'Gera',
  emailVerified: true,
  avatarUrl: null,
  registeredAt: '2026-08-26T00:00:00.000Z',
};

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

    fireEvent.click(getByRole('button', { name: 'Настройки' }));
    fireEvent.click(getByRole('button', { name: 'Выйти' }));

    expect(onSettings).toHaveBeenCalledOnce();
    expect(onLogout).toHaveBeenCalledOnce();
  });
});

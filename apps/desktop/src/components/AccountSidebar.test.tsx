// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountUser } from '../lib/api-client';
import { AccountSidebar } from './AccountSidebar';

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

beforeEach(() => localStorage.clear());
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
});

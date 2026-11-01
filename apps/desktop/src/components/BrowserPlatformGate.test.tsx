// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountClient, type AccountUser } from '../lib/api-client';
import { BrowserPlatformGate } from './BrowserPlatformGate';

const user: AccountUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'test@example.test',
  username: 'test',
  displayName: 'Test',
  emailVerified: true,
  avatarUrl: null,
  registeredAt: '2026-01-01T00:00:00Z',
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('recovers the saved mobile login when the network returns without disturbing an active app', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone Mobile');
  const restore = vi
    .spyOn(accountClient, 'restore')
    .mockRejectedValueOnce(new TypeError('Offline'))
    .mockResolvedValue(user);
  render(
    <BrowserPlatformGate>
      <p>Открытое приложение</p>
    </BrowserPlatformGate>,
  );
  await screen.findByRole('button', { name: 'Повторить подключение' });
  expect(screen.queryByLabelText('Пароль')).toBeNull();
  fireEvent(window, new Event('online'));
  await screen.findByText('Открытое приложение');
  expect(restore).toHaveBeenCalledTimes(2);
  fireEvent(window, new Event('online'));
  expect(restore).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Открытое приложение')).toBeTruthy();
});

it('offers a manual retry after a temporary server failure', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone Mobile');
  vi.spyOn(accountClient, 'restore')
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValue(user);
  render(
    <BrowserPlatformGate>
      <p>Открытое приложение</p>
    </BrowserPlatformGate>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Повторить подключение' }));
  await screen.findByText('Открытое приложение');
});

describe('BrowserPlatformGate', () => {
  it('shows and hides the mobile beta password', async () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile',
    );
    vi.spyOn(accountClient, 'restore').mockResolvedValue(null);
    const view = render(
      <BrowserPlatformGate>
        <div>Приложение</div>
      </BrowserPlatformGate>,
    );

    await waitFor(() => expect(view.getByLabelText('Пароль')).toBeTruthy());
    const password = view.getByLabelText('Пароль') as HTMLInputElement;
    fireEvent.change(password, { target: { value: 'secret-password' } });
    expect(password.type).toBe('password');
    fireEvent.click(view.getByRole('button', { name: 'Показать пароль' }));
    expect(password.type).toBe('text');
    expect(password.value).toBe('secret-password');
    fireEvent.click(view.getByRole('button', { name: 'Скрыть пароль' }));
    expect(password.type).toBe('password');
  });

  it('offers mobile registration with a beta key and password recovery', async () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile',
    );
    vi.spyOn(accountClient, 'restore').mockResolvedValue(null);
    const view = render(
      <BrowserPlatformGate>
        <div>Приложение</div>
      </BrowserPlatformGate>,
    );

    await waitFor(() => expect(view.getByRole('tab', { name: 'Регистрация' })).toBeTruthy());
    expect(view.getByRole('button', { name: 'Забыли пароль?' })).toBeTruthy();
    fireEvent.click(view.getByRole('tab', { name: 'Регистрация' }));
    expect(view.getByLabelText('Ключ мобильной беты')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Зарегистрироваться' })).toBeTruthy();
  });
});

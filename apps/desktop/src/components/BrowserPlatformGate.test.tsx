// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountClient } from '../lib/api-client';
import { BrowserPlatformGate } from './BrowserPlatformGate';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
});

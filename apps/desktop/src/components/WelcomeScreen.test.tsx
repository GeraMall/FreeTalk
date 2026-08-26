// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WelcomeScreen } from './WelcomeScreen';

beforeEach(() => vi.stubEnv('VITE_TURNSTILE_SITE_KEY', ''));
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function props() {
  return {
    error: '',
    busy: false,
    captchaRequired: false,
    updateStatus: { kind: 'idle' as const },
    savedDisplayName: 'Гера',
    onLogin: vi.fn(),
    onRegister: vi.fn().mockResolvedValue(true),
    onResendVerification: vi.fn().mockResolvedValue(true),
    onVerifyEmail: vi.fn().mockResolvedValue(true),
    onGuestJoin: vi.fn(),
    onForgotPassword: vi.fn(),
    onResetPassword: vi.fn(),
    onSettings: vi.fn(),
  };
}

describe('account-first welcome screen', () => {
  it('opens both legal documents without accepting them automatically', () => {
    const view = render(<WelcomeScreen {...props()} />);
    fireEvent.click(view.getByRole('tab', { name: 'Регистрация' }));

    const termsCheckbox = view.getByLabelText('Я принимаю Пользовательское соглашение');
    fireEvent.click(view.getByRole('button', { name: 'Пользовательское соглашение' }));
    expect(
      view.getByRole('region', { name: 'Пользовательское соглашение FreeTalk' }),
    ).not.toBeNull();
    expect((termsCheckbox as HTMLInputElement).checked).toBe(false);

    fireEvent.click(view.getByRole('button', { name: 'Политику конфиденциальности' }));
    expect(
      view.getByRole('region', { name: 'Политика конфиденциальности FreeTalk' }),
    ).not.toBeNull();
    expect(
      (view.getByLabelText('Я принимаю Политику конфиденциальности') as HTMLInputElement).checked,
    ).toBe(false);
  });

  it('allows registration only with a five-character latin username', () => {
    const handlers = props();
    const view = render(<WelcomeScreen {...handlers} />);
    fireEvent.click(view.getByRole('tab', { name: 'Регистрация' }));
    const username = view.getByRole('textbox', { name: /Уникальный @username/ });

    fireEvent.change(username, { target: { value: 'Ге.ra-1_' } });
    expect((username as HTMLInputElement).value).toBe('ra1_');
    expect(view.getByText('Допустимы только a–z, 0–9 и _.')).not.toBeNull();
    expect(
      (view.getByRole('button', { name: 'Создать аккаунт' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.change(username, { target: { value: 'Gera_1' } });
    expect((username as HTMLInputElement).value).toBe('gera_1');
    expect(view.queryByText('Допустимы только a–z, 0–9 и _.')).toBeNull();
  });

  it('collapses a successful registration into a six-digit verification step', async () => {
    const handlers = props();
    const view = render(<WelcomeScreen {...handlers} />);
    fireEvent.click(view.getByRole('tab', { name: 'Регистрация' }));
    fireEvent.change(view.getByLabelText('Почта'), { target: { value: 'gera@example.com' } });
    fireEvent.change(view.getByRole('textbox', { name: /Уникальный @username/ }), {
      target: { value: 'gera_test' },
    });
    fireEvent.change(view.getByLabelText('Пароль'), { target: { value: 'password123' } });
    fireEvent.change(view.getByLabelText('Повторите пароль'), {
      target: { value: 'password123' },
    });
    fireEvent.click(view.getByLabelText(/Пользовательское соглашение/));
    fireEvent.click(view.getByLabelText(/Политику конфиденциальности/));
    fireEvent.click(view.getByRole('button', { name: 'Создать аккаунт' }));

    await waitFor(() => expect(view.getByText('Подтвердите почту')).not.toBeNull());
    expect(view.queryByLabelText('Пароль')).toBeNull();
    const code = view.getByLabelText('Код из письма');
    fireEvent.change(code, { target: { value: '12a34567' } });
    expect((code as HTMLInputElement).value).toBe('123456');
    fireEvent.click(view.getByRole('button', { name: 'Подтвердить и войти' }));
    expect(handlers.onVerifyEmail).toHaveBeenCalledWith('gera@example.com', '123456');
  });

  it('requires local CAPTCHA before sending a FreeUser join', () => {
    const handlers = props();
    const view = render(<WelcomeScreen {...handlers} />);
    fireEvent.change(view.getByLabelText('Код или ссылка комнаты'), {
      target: { value: 'ABCDEFGH2345' },
    });
    const guestJoin = view.getAllByRole('button', { name: 'Войти' }).at(-1)!;
    expect((guestJoin as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(view.getByRole('button', { name: 'Подтвердить локальную CAPTCHA' }));
    expect((guestJoin as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(guestJoin);
    expect(handlers.onGuestJoin).toHaveBeenCalledWith('ABCDEFGH2345', 'local-development');
  });
});

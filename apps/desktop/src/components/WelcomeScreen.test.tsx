// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WelcomeScreen } from './WelcomeScreen';
import { accountClient } from '../lib/api-client';

beforeEach(() => vi.stubEnv('VITE_TURNSTILE_SITE_KEY', ''));
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function props() {
  return {
    error: '',
    busy: false,
    captchaRequired: false,
    updateStatus: { kind: 'idle' as const },
    onLogin: vi.fn(),
    onRegister: vi.fn().mockResolvedValue(true),
    onResendVerification: vi.fn().mockResolvedValue(true),
    onVerifyEmail: vi.fn().mockResolvedValue(true),
    onForgotPassword: vi.fn().mockResolvedValue(true),
    onResetPassword: vi.fn(),
    onSettings: vi.fn(),
  };
}

describe('account-first welcome screen', () => {
  it.each(['', 'neman', '@neman'])(
    'opens password recovery with login %s without sending a username',
    async (login) => {
      const handlers = props();
      const view = render(<WelcomeScreen {...handlers} />);
      fireEvent.change(view.getByRole('textbox', { name: /Почта или @username/ }), {
        target: { value: login },
      });
      const forgot = view.getByRole('button', { name: 'Забыли пароль?' }) as HTMLButtonElement;
      expect(forgot.disabled).toBe(false);
      fireEvent.click(forgot);
      expect(handlers.onForgotPassword).not.toHaveBeenCalled();
      expect((view.getByLabelText('Почта аккаунта') as HTMLInputElement).value).toBe('');
      fireEvent.change(view.getByLabelText('Почта аккаунта'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.click(view.getByRole('button', { name: 'Получить код' }));
      await waitFor(() => expect(view.getByLabelText('Код из письма')).toBeTruthy());
      expect(handlers.onForgotPassword).toHaveBeenCalledExactlyOnceWith('test@example.com');
    },
  );

  it('keeps recovery on the email step after failure and prevents duplicate code requests', async () => {
    const handlers = props();
    let finish!: (ok: boolean) => void;
    handlers.onForgotPassword.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<WelcomeScreen {...handlers} />);
    fireEvent.click(view.getByRole('button', { name: 'Забыли пароль?' }));
    fireEvent.change(view.getByLabelText('Почта аккаунта'), {
      target: { value: 'test@example.com' },
    });
    const send = view.getByRole('button', { name: 'Получить код' });
    fireEvent.click(send);
    fireEvent.click(send);
    expect(handlers.onForgotPassword).toHaveBeenCalledOnce();
    finish(false);
    await waitFor(() => expect(view.getByRole('button', { name: 'Получить код' })).toBeTruthy());
    expect(view.queryByLabelText('Код из письма')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Получить код' }));
    await waitFor(() => expect(view.getByLabelText('Код из письма')).toBeTruthy());
    expect(handlers.onForgotPassword).toHaveBeenCalledTimes(2);
  });
  it('does not create or display a login QR on a phone', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile/15E148 Safari/604.1',
    );
    const startQr = vi.spyOn(accountClient, 'startQrLogin');
    const view = render(<WelcomeScreen {...props()} onQrLogin={async () => {}} />);
    expect(view.queryByRole('region', { name: 'Войти с помощью QR-кода' })).toBeNull();
    expect(startQr).not.toHaveBeenCalled();
  });

  it('keeps QR login available in a narrow desktop window', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    );
    vi.stubGlobal('innerWidth', 390);
    const startQr = vi.spyOn(accountClient, 'startQrLogin').mockReturnValue(new Promise(() => {}));
    const view = render(<WelcomeScreen {...props()} onQrLogin={async () => {}} />);
    expect(view.getByRole('region', { name: 'Войти с помощью QR-кода' })).toBeTruthy();
    expect(startQr).toHaveBeenCalledOnce();
  });
  it('shows and hides the entered login password', () => {
    const view = render(<WelcomeScreen {...props()} />);
    const password = view.getByLabelText('Пароль') as HTMLInputElement;

    fireEvent.change(password, { target: { value: 'secret-password' } });
    expect(password.type).toBe('password');
    fireEvent.click(view.getByRole('button', { name: 'Показать пароль' }));
    expect(password.type).toBe('text');
    expect(password.value).toBe('secret-password');
    fireEvent.click(view.getByRole('button', { name: 'Скрыть пароль' }));
    expect(password.type).toBe('password');
  });

  it('uses the app error for empty login fields on Enter', () => {
    const handlers = props();
    const view = render(<WelcomeScreen {...handlers} />);
    const password = view.getByLabelText('Пароль');
    expect(password.getAttribute('required')).toBeNull();
    expect(password.getAttribute('aria-required')).toBe('true');
    fireEvent.keyDown(password, { key: 'Enter' });
    expect(view.getByRole('alert').textContent).toBe('Проверьте введённые данные.');
    expect(handlers.onLogin).not.toHaveBeenCalled();
  });

  it('resets with six digits and an explicit email even without requesting in this session', () => {
    const handlers = props();
    const view = render(<WelcomeScreen {...handlers} />);
    fireEvent.click(view.getByRole('button', { name: 'У меня есть код сброса' }));
    const submit = view.getByRole('button', {
      name: 'Сохранить новый пароль',
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(view.getByLabelText('Почта аккаунта'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(view.getByLabelText('Новый пароль'), { target: { value: 'Password12345' } });
    fireEvent.change(view.getByLabelText('Код из письма'), { target: { value: '012' } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(view.getByLabelText('Код из письма'), { target: { value: '0a1234567' } });
    expect((view.getByLabelText('Код из письма') as HTMLInputElement).value).toBe('012345');
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(handlers.onResetPassword).toHaveBeenCalledWith(
      '012345',
      'Password12345',
      'test@example.com',
    );
  });
  it('opens both legal documents without accepting them automatically', () => {
    const view = render(<WelcomeScreen {...props()} />);
    fireEvent.click(view.getByRole('tab', { name: 'Регистрация' }));

    const termsCheckbox = view.getByLabelText('Я принимаю Пользовательское соглашение');
    fireEvent.click(view.getByRole('button', { name: 'Пользовательское соглашение' }));
    expect(view.getByRole('region', { name: 'Пользовательское соглашение TRLKA' })).not.toBeNull();
    expect((termsCheckbox as HTMLInputElement).checked).toBe(false);

    fireEvent.click(view.getByRole('button', { name: 'политикой конфиденциальности' }));
    expect(view.getByRole('region', { name: 'Политика конфиденциальности TRLKA' })).not.toBeNull();
    expect(
      (view.getByLabelText('Я ознакомился с политикой конфиденциальности') as HTMLInputElement)
        .checked,
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
    const displayName = view.getByLabelText('Отображаемое имя') as HTMLInputElement;
    expect(displayName.value).toBe('');
    expect(displayName.required).toBe(false);
    fireEvent.change(view.getByLabelText('Почта'), { target: { value: 'gera@example.com' } });
    fireEvent.change(view.getByRole('textbox', { name: /Уникальный @username/ }), {
      target: { value: 'gera_test' },
    });
    fireEvent.change(view.getByLabelText('Пароль'), { target: { value: 'password123' } });
    fireEvent.change(view.getByLabelText('Повторите пароль'), {
      target: { value: 'password123' },
    });
    fireEvent.click(view.getByLabelText(/Пользовательское соглашение/));
    fireEvent.click(view.getByLabelText(/политикой конфиденциальности/));
    const submit = view.getByRole('button', { name: 'Создать аккаунт' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    const pick = (field: string, option: string) => {
      fireEvent.click(view.getByRole('combobox', { name: field }));
      fireEvent.click(view.getByRole('option', { name: option }));
    };
    pick('День', '29');
    pick('Месяц', 'февраль');
    pick('Год', '2001');
    expect(submit.disabled).toBe(true);
    const year = view.getByRole('combobox', { name: 'Год' });
    fireEvent.click(year);
    fireEvent.keyDown(year, { key: 'Escape' });
    expect(year.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(year, { key: 'ArrowDown' });
    fireEvent.keyDown(year, { key: 'Enter' });
    expect(submit.disabled).toBe(false);
    fireEvent.click(view.getByRole('button', { name: 'Создать аккаунт' }));

    await waitFor(() => expect(view.getByText('Подтвердите почту')).not.toBeNull());
    expect(handlers.onRegister).toHaveBeenCalledWith(
      expect.objectContaining({ birthDate: '2000-02-29', displayName: '' }),
    );
    expect(view.queryByLabelText('Пароль')).toBeNull();
    const code = view.getByLabelText('Код из письма');
    fireEvent.change(code, { target: { value: '12a34567' } });
    expect((code as HTMLInputElement).value).toBe('123456');
    fireEvent.click(view.getByRole('button', { name: 'Подтвердить и войти' }));
    expect(handlers.onVerifyEmail).toHaveBeenCalledWith('gera@example.com', '123456');
  });

  it('only offers authenticated entry', () => {
    const view = render(<WelcomeScreen {...props()} />);
    expect(view.queryByText('Гостевой режим')).toBeNull();
    expect(view.queryByLabelText('Код или ссылка комнаты')).toBeNull();
  });
});

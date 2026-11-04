// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const request = vi.hoisted(() => vi.fn());
vi.mock('../lib/api-client', () => ({ accountClient: { request } }));
import { ServiceChat } from './ServiceChat';
const user = { displayName: 'Алекс', username: 'alex', avatarUrl: null };
const welcome = {
  id: 'welcome',
  author: 'bot',
  kind: 'help',
  body: 'Служебный чат TRLKA',
  created_at: '2026-11-02T00:00:00Z',
};
beforeEach(() => {
  vi.stubGlobal('__FREETALK_APP_VERSION__', 'test');
  request.mockReset();
  request.mockResolvedValue({ messages: [welcome] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('service chat', () => {
  it('opens the official bot profile without requesting a user profile', async () => {
    render(<ServiceChat user={user} onBack={() => {}} />);
    await screen.findByText('Служебный чат TRLKA');
    fireEvent.click(screen.getByRole('button', { name: 'Показать профиль' }));
    expect(screen.getByRole('complementary', { name: 'Профиль бота TRLKA' })).toBeTruthy();
    expect(
      screen.getByText('Одно предложение за 24 часа. Об ошибках можно сообщать отдельно.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть профиль TRLKA' }));
    expect(screen.queryByRole('complementary', { name: 'Профиль бота TRLKA' })).toBeNull();
    expect(request.mock.calls.every(([url]) => url.startsWith('/v1/service-chat/messages'))).toBe(
      true,
    );
  });
  it('opens an explicit report flow and sends text with a retry-safe request id', async () => {
    render(<ServiceChat user={user} onBack={() => {}} />);
    await screen.findByText('Служебный чат TRLKA');
    fireEvent.click(screen.getByRole('button', { name: 'Сообщить об ошибке' }));
    await waitFor(() =>
      expect(
        request.mock.calls.some(
          ([url, opts]) =>
            url === '/v1/service-chat/messages' &&
            opts?.method === 'POST' &&
            JSON.parse(opts.body).body === '/bug',
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Сообщить об ошибке' }).hasAttribute('disabled'),
      ).toBe(false),
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Сообщение боту TRLKA' }), {
      target: { value: 'Не включается камера в комнате' },
    });
    request.mockRejectedValueOnce(new Error('Сеть недоступна'));
    fireEvent.click(screen.getByRole('button', { name: 'Отправить сообщение' }));
    await screen.findByText('Сеть недоступна');
    const failed = JSON.parse(request.mock.calls.at(-1)![1].body);
    expect(
      (screen.getByRole('textbox', { name: 'Сообщение боту TRLKA' }) as HTMLTextAreaElement).value,
    ).toBe('Не включается камера в комнате');
    request.mockResolvedValue({ messages: [welcome] });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить сообщение' }));
    await waitFor(() =>
      expect(
        request.mock.calls.some(
          ([url, opts]) =>
            url === '/v1/service-chat/messages' &&
            opts?.method === 'POST' &&
            JSON.parse(opts.body).requestId === failed.requestId,
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(
        (screen.getByRole('textbox', { name: 'Сообщение боту TRLKA' }) as HTMLTextAreaElement)
          .value,
      ).toBe(''),
    );
  });
  it.each([
    ['Подписка', '/subscription'],
    ['Отмена', '/cancel'],
  ])('sends %s as a quick command without erasing the draft', async (label, command) => {
    render(<ServiceChat user={user} onBack={() => {}} />);
    await screen.findByText('Служебный чат TRLKA');
    fireEvent.change(screen.getByRole('textbox', { name: 'Сообщение боту TRLKA' }), {
      target: { value: 'Мой подробный черновик' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: label }));
    });
    expect(
      (screen.getByRole('textbox', { name: 'Сообщение боту TRLKA' }) as HTMLTextAreaElement).value,
    ).toBe('Мой подробный черновик');
    expect(
      request.mock.calls.some(
        ([url, opts]) =>
          url === '/v1/service-chat/messages' &&
          opts?.method === 'POST' &&
          JSON.parse(opts.body).body === command,
      ),
    ).toBe(true);
  });
});

// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const windowApi = vi.hoisted(() => ({
  close: vi.fn().mockResolvedValue(undefined),
  isMaximized: vi.fn<() => Promise<boolean>>(),
  minimize: vi.fn().mockResolvedValue(undefined),
  onResized: vi.fn().mockResolvedValue(vi.fn()),
  toggleMaximize: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => windowApi,
}));

import { CustomTitleBar } from './CustomTitleBar';

beforeEach(() => {
  vi.clearAllMocks();
  windowApi.isMaximized.mockResolvedValue(false);
  windowApi.onResized.mockResolvedValue(vi.fn());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CustomTitleBar', () => {
  it('keeps minimize, maximize and close connected to the native window', async () => {
    const { getByRole } = render(<CustomTitleBar />);
    await waitFor(() => expect(windowApi.isMaximized).toHaveBeenCalled());

    fireEvent.click(getByRole('button', { name: 'Свернуть' }));
    fireEvent.click(getByRole('button', { name: 'Развернуть' }));
    fireEvent.click(getByRole('button', { name: 'Закрыть' }));

    expect(windowApi.minimize).toHaveBeenCalledOnce();
    expect(windowApi.toggleMaximize).toHaveBeenCalledOnce();
    expect(windowApi.close).toHaveBeenCalledOnce();
  });

  it('uses native history for back and forward navigation', () => {
    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
    const forward = vi.spyOn(history, 'forward').mockImplementation(() => undefined);
    const { getByRole } = render(<CustomTitleBar />);

    fireEvent.click(getByRole('button', { name: 'Назад' }));
    fireEvent.click(getByRole('button', { name: 'Вперёд' }));

    expect(back).toHaveBeenCalledOnce();
    expect(forward).toHaveBeenCalledOnce();
  });

  it('toggles maximize on a double click outside window controls', async () => {
    const { container } = render(<CustomTitleBar />);
    await waitFor(() => expect(windowApi.isMaximized).toHaveBeenCalled());
    fireEvent.doubleClick(container.querySelector('.custom-titlebar-drag')!);
    await waitFor(() => expect(windowApi.toggleMaximize).toHaveBeenCalledOnce());
  });

  it('shows restore after the native window reports maximized state', async () => {
    windowApi.isMaximized.mockResolvedValue(true);
    const { getByRole } = render(<CustomTitleBar />);
    expect(await waitFor(() => getByRole('button', { name: 'Восстановить' }))).toBeTruthy();
  });
});

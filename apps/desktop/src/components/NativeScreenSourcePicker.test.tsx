// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => true }));
import { NativeScreenSourcePicker } from './NativeScreenSourcePicker';
import { selectNativeScreen, cancelNativeScreenSelection } from '../lib/native-screen-picker';
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(() => {
  act(() => cancelNativeScreenSelection());
  cleanup();
  vi.resetAllMocks();
});
describe('native capture picker', () => {
  it('keeps quick quality choices across tabs and closes only the dropdown on Escape', async () => {
    invoke.mockResolvedValue('data:image/png;base64,quality');
    const view = render(<NativeScreenSourcePicker />);
    let selected!: ReturnType<typeof selectNativeScreen>;
    act(() => {
      selected = selectNativeScreen(
        [
          { id: 'q', title: 'Quality screen', kind: 'screen' },
          { id: 'w', title: 'Quality window', kind: 'window' },
        ],
        true,
        { screenContentMode: 'balanced', screenResolution: '1080p', screenFrameRate: 30 },
      );
    });
    fireEvent.click(view.getByRole('combobox', { name: 'Тип содержимого' }));
    fireEvent.click(view.getByRole('option', { name: 'Видео · плавное движение' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Максимальное разрешение' }));
    fireEvent.click(view.getByRole('option', { name: '2K · 2560×1440' }));
    const fps = view.getByRole('combobox', { name: 'Частота кадров' });
    fireEvent.keyDown(fps, { key: 'ArrowDown' });
    fireEvent.keyDown(fps, { key: 'Enter' });
    fireEvent.click(fps);
    fireEvent.keyDown(fps, { key: 'Escape' });
    expect(view.queryByRole('listbox')).toBeNull();
    expect(view.getByRole('tab', { name: 'Окна' })).toBeTruthy();
    fireEvent.click(view.getByRole('tab', { name: 'Окна' }));
    fireEvent.click(view.getByRole('button', { name: 'Quality window' }));
    await expect(selected).resolves.toMatchObject({
      kind: 'window',
      quality: { screenContentMode: 'video', screenResolution: '1440p', screenFrameRate: 60 },
    });
  });
  it('loads a local still per source and selects the original source without confusing screen and window IDs', async () => {
    invoke.mockResolvedValue('data:image/png;base64,preview');
    const view = render(<NativeScreenSourcePicker />);
    const sources = [
      { id: '1', title: 'Display', kind: 'screen' as const },
      { id: '1', title: 'Editor', kind: 'window' as const },
    ];
    let selected!: ReturnType<typeof selectNativeScreen>;
    act(() => {
      selected = selectNativeScreen(sources);
      void selected.catch(() => undefined);
    });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('windows_screen_thumbnail', {
        sourceId: '1',
        kind: 'screen',
      }),
    );
    await waitFor(() => expect(document.querySelector('.native-source-preview img')).toBeTruthy());
    fireEvent.click(view.getByRole('tab', { name: 'Окна' }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('windows_screen_thumbnail', {
        sourceId: '1',
        kind: 'window',
      }),
    );
    fireEvent.click(view.getByRole('button', { name: 'Editor' }));
    await expect(selected).resolves.toMatchObject({ ...sources[1], includeAudio: true });
  });
  it('stops requesting more thumbnails when the picker closes', async () => {
    const finishes: Array<(image: string) => void> = [];
    invoke.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finishes.push(resolve);
        }),
    );
    const view = render(<NativeScreenSourcePicker />);
    let selected!: ReturnType<typeof selectNativeScreen>;
    act(() => {
      selected = selectNativeScreen([
        { id: '1', title: 'One', kind: 'screen' },
        { id: '2', title: 'Two', kind: 'screen' },
        { id: '3', title: 'Three', kind: 'screen' },
      ]);
    });
    const cancelled = selected.catch((error: DOMException) => error.name);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    fireEvent.click(view.getAllByRole('button', { name: 'Отмена' })[0]!);
    await act(async () => finishes.forEach((finish) => finish('data:image/png;base64,preview')));
    expect(invoke).toHaveBeenCalledTimes(2);
    await expect(cancelled).resolves.toBe('NotAllowedError');
  });
  it('shares audio by default and preserves an explicit opt-out across source tabs', async () => {
    invoke.mockResolvedValue('data:image/png;base64,audio-preview');
    const view = render(<NativeScreenSourcePicker />);
    let selected!: ReturnType<typeof selectNativeScreen>;
    act(() => {
      selected = selectNativeScreen([
        { id: 'audio', title: 'Audio screen', kind: 'screen' },
        { id: 'audio', title: 'Audio window', kind: 'window' },
      ]);
    });
    const audio = view.getByRole('checkbox', { name: 'Транслировать звук' }) as HTMLInputElement;
    expect(audio.checked).toBe(true);
    fireEvent.click(audio);
    fireEvent.click(view.getByRole('tab', { name: 'Окна' }));
    expect(audio.checked).toBe(false);
    fireEvent.click(view.getByRole('button', { name: 'Audio window' }));
    await expect(selected).resolves.toMatchObject({ kind: 'window', includeAudio: false });
  });
  it('reuses a recent local preview instead of capturing it again on reopening', async () => {
    invoke.mockResolvedValue('data:image/png;base64,cached');
    const view = render(<NativeScreenSourcePicker />);
    const sources = [{ id: 'cache', title: 'Cached window', kind: 'screen' as const }];
    let first!: ReturnType<typeof selectNativeScreen>;
    act(() => {
      first = selectNativeScreen(sources);
    });
    await waitFor(() => expect(document.querySelector('.native-source-preview img')).toBeTruthy());
    fireEvent.click(view.getByRole('button', { name: 'Cached window' }));
    await first;
    invoke.mockClear();
    let second!: ReturnType<typeof selectNativeScreen>;
    act(() => {
      second = selectNativeScreen(sources);
    });
    const cancelled = second.catch(() => undefined);
    await waitFor(() => expect(document.querySelector('.native-source-preview img')).toBeTruthy());
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(view.getAllByRole('button', { name: 'Отмена' })[0]!);
    await cancelled;
  });
});

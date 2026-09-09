// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountClient, type AccountUser } from '../lib/api-client';
import { defaultSettings } from '../lib/settings';
import { SettingsPanel } from './SettingsPanel';
import { NotificationSounds } from '../lib/notification-sounds';
import recordingStartSound from '../assets/recording-start.mp3';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const user: AccountUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'gera@example.com',
  username: 'german',
  displayName: 'Gera',
  emailVerified: true,
  avatarUrl: null,
  coverUrl: null,
  bio: '',
  registeredAt: '2026-08-26T00:00:00.000Z',
};

function renderProfile() {
  const onClose = vi.fn();
  const onSaveProfile = vi.fn().mockResolvedValue(undefined);
  const onSetting = vi.fn();
  const onVideoSetting = vi.fn();
  vi.spyOn(accountClient, 'request').mockResolvedValue({
    sessions: [
      {
        id: 'session-current',
        current: true,
        userAgent: 'FreeTalk/0.4 Windows NT 10.0',
        createdAt: '2026-08-26T00:00:00.000Z',
        lastActiveAt: '2026-09-03T10:00:00.000Z',
        expiresAt: '2026-10-03T10:00:00.000Z',
      },
      {
        id: 'session-mac',
        current: false,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)',
        createdAt: '2026-08-30T00:00:00.000Z',
        lastActiveAt: '2026-09-02T10:00:00.000Z',
        expiresAt: '2026-10-02T10:00:00.000Z',
      },
      {
        id: 'session-windows-old',
        current: false,
        userAgent: 'FreeTalk/0.3 Windows NT 10.0',
        createdAt: '2026-08-20T00:00:00.000Z',
        lastActiveAt: '2026-08-29T10:00:00.000Z',
        expiresAt: '2026-09-29T10:00:00.000Z',
      },
    ],
  });
  const view = render(
    <SettingsPanel
      initialTab="profile"
      settings={{
        ...defaultSettings(),
        displayName: 'Gera',
        avatarDataUrl: 'data:image/png;base64,dGVzdA==',
        participantCardStyle: 'classic',
      }}
      devices={{ inputs: [], outputs: [], cameras: [] }}
      inputLevel={0}
      appVersion="test"
      updateStatus={{ kind: 'idle' }}
      turnAvailable
      outputSupported
      accountUser={user}
      guestMode={false}
      onClose={onClose}
      onInput={vi.fn()}
      onOutput={vi.fn()}
      onCamera={vi.fn()}
      onSetting={onSetting}
      onVideoSetting={onVideoSetting}
      onKey={vi.fn()}
      onReset={vi.fn()}
      onCheckUpdate={vi.fn()}
      onInstallUpdate={vi.fn()}
      onSaveDiagnostics={vi.fn().mockResolvedValue('')}
      onSaveProfile={onSaveProfile}
      onAccountLogout={vi.fn()}
      onDeleteAccount={vi.fn().mockResolvedValue(undefined)}
      onChangePassword={vi.fn().mockResolvedValue(undefined)}
      onClearChatCache={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  return { ...view, onClose, onSaveProfile, onSetting, onVideoSetting };
}

describe('SettingsPanel profile actions', () => {
  it('previews actual event sounds and exposes microphone and ringtone settings', async () => {
    const joined = vi.spyOn(NotificationSounds.prototype, 'playJoined').mockResolvedValue();
    const disconnected = vi
      .spyOn(NotificationSounds.prototype, 'playDisconnected')
      .mockResolvedValue();
    vi.spyOn(NotificationSounds.prototype, 'setOutput').mockResolvedValue([]);
    const audio = vi.spyOn(window, 'Audio').mockImplementation(function () {
      return { play: vi.fn().mockResolvedValue(undefined) } as unknown as HTMLAudioElement;
    });
    const { getByRole, onVideoSetting } = renderProfile();
    fireEvent.click(getByRole('button', { name: 'Видео и звуки' }));
    fireEvent.click(getByRole('button', { name: 'Прослушать звук: Участник подключился' }));
    fireEvent.click(getByRole('button', { name: 'Прослушать звук: Участник отключился' }));
    await waitFor(() => {
      expect(joined).toHaveBeenCalledOnce();
      expect(disconnected).toHaveBeenCalledOnce();
    });
    fireEvent.click(getByRole('button', { name: 'Прослушать звук: Начало записи' }));
    expect(audio).toHaveBeenLastCalledWith(recordingStartSound);
    fireEvent.click(getByRole('button', { name: 'Прослушать звук: Микрофон включён' }));
    expect(audio).toHaveBeenLastCalledWith('/sounds/microphone-enabled.mp3');
    fireEvent.click(getByRole('button', { name: 'Прослушать звук: Микрофон выключен' }));
    expect(audio).toHaveBeenLastCalledWith('/sounds/microphone-disabled.mp3');
    fireEvent.click(getByRole('button', { name: 'Прослушать звук: Входящий звонок' }));
    expect(audio).toHaveBeenLastCalledWith('/sounds/incoming-call.mp3');
    fireEvent.click(getByRole('switch', { name: 'Микрофон выключен' }));
    expect(onVideoSetting).toHaveBeenCalledWith({ microphoneDisabledSound: false });
  });
  it('keeps card styling in the draft until the single done action', async () => {
    const { container, getByRole, onClose, onSaveProfile, onSetting } = renderProfile();

    expect(container.querySelector('.profile-card-preview')).toBeTruthy();
    expect(getByRole('switch', { name: 'Жидкое стекло' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    fireEvent.click(getByRole('switch', { name: 'Жидкое стекло' }));
    fireEvent.click(getByRole('radio', { name: 'Япония' }));
    expect(onSetting).not.toHaveBeenCalled();

    fireEvent.click(getByRole('button', { name: 'Готово' }));
    await waitFor(() => expect(onSaveProfile).toHaveBeenCalledOnce());
    expect(onSetting).toHaveBeenCalledWith({ participantCardStyle: 'avatar-glass' }, false);
    expect(onSetting).toHaveBeenCalledWith({ participantCardDecoration: 'japan' }, false);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('saves the complete draft with the only done button and closes', async () => {
    const { container, getAllByRole, getByRole, getByText, onClose, onSaveProfile } =
      renderProfile();
    const actionBar = container.querySelector('.profile-sticky-actions');
    expect(actionBar).toBeTruthy();
    expect(getByText('Осталось изменений: 5 из 5')).toBeTruthy();
    expect(getByText('Не привязан')).toBeTruthy();
    expect(getByText('ge•••@example.com')).toBeTruthy();
    expect(container.querySelector('.profile-full-preview-frame')).toBeNull();
    expect(getAllByRole('button', { name: 'Готово' })).toHaveLength(1);

    fireEvent.change(getByRole('textbox', { name: /О себе/ }), {
      target: { value: 'Новая информация' },
    });
    fireEvent.click(getByRole('button', { name: 'Готово' }));
    await waitFor(() => expect(onSaveProfile).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes without a save request when the profile has not changed', () => {
    const { getByRole, onClose, onSaveProfile } = renderProfile();
    fireEvent.click(getByRole('button', { name: 'Готово' }));
    expect(onSaveProfile).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('asks what to do when closing with an unsaved profile draft', () => {
    const { getAllByRole, getByRole, onClose } = renderProfile();
    fireEvent.change(getByRole('textbox', { name: /О себе/ }), {
      target: { value: 'Черновик' },
    });

    fireEvent.click(getAllByRole('button', { name: 'Закрыть настройки' }).at(-1)!);
    expect(getByRole('heading', { name: 'Сохранить изменения?' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(getAllByRole('button', { name: 'Отмена' }).at(-1)!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps settings open and explains a failed profile save', async () => {
    const { getByRole, getByText, onClose, onSaveProfile } = renderProfile();
    onSaveProfile.mockRejectedValueOnce(new Error('Сервер временно недоступен'));
    fireEvent.change(getByRole('textbox', { name: /О себе/ }), {
      target: { value: 'Новая информация' },
    });
    fireEvent.click(getByRole('button', { name: 'Готово' }));

    expect(await waitFor(() => getByText('Сервер временно недоступен'))).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('provides local chat appearance controls with a live preview', () => {
    const { container, getByRole, getByText, onSetting } = renderProfile();

    fireEvent.click(getByRole('button', { name: 'Чаты' }));
    expect(getByRole('heading', { name: 'Оформление чатов' })).toBeTruthy();
    expect(container.querySelector('.chat-settings-preview')).toBeTruthy();

    fireEvent.change(getByRole('slider', { name: 'Размер текста сообщений' }), {
      target: { value: '1.2' },
    });
    fireEvent.click(getByRole('radio', { name: 'Компактно' }));

    expect(onSetting).toHaveBeenCalledWith({ chatTextScale: 1.2 }, false);
    expect(onSetting).toHaveBeenCalledWith({ chatMessageStyle: 'compact' }, false);
    expect(getByText('Обои всех чатов')).toBeTruthy();
  });

  it('lets a custom wallpaper fit inside the chat without cropping', () => {
    const view = renderProfile();
    view.rerender(
      <SettingsPanel
        initialTab="chats"
        settings={{
          ...defaultSettings(),
          chatWallpaperDataUrl: 'data:image/png;base64,dGVzdA==',
        }}
        devices={{ inputs: [], outputs: [], cameras: [] }}
        inputLevel={0}
        appVersion="test"
        updateStatus={{ kind: 'idle' }}
        turnAvailable
        outputSupported
        accountUser={user}
        guestMode={false}
        onClose={vi.fn()}
        onInput={vi.fn()}
        onOutput={vi.fn()}
        onCamera={vi.fn()}
        onSetting={view.onSetting}
        onVideoSetting={vi.fn()}
        onKey={vi.fn()}
        onReset={vi.fn()}
        onCheckUpdate={vi.fn()}
        onInstallUpdate={vi.fn()}
        onSaveDiagnostics={vi.fn().mockResolvedValue('')}
        onSaveProfile={vi.fn().mockResolvedValue(undefined)}
        onAccountLogout={vi.fn()}
        onDeleteAccount={vi.fn().mockResolvedValue(undefined)}
        onChangePassword={vi.fn().mockResolvedValue(undefined)}
        onClearChatCache={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(view.getByRole('button', { name: 'Чаты' }));
    fireEvent.click(view.getByRole('radio', { name: 'Показать целиком' }));
    expect(view.onSetting).toHaveBeenCalledWith({ chatWallpaperFit: 'contain' }, false);
  });

  it('uses the FreeTalk-styled done action outside the profile tab', () => {
    const { getByRole } = renderProfile();
    fireEvent.click(getByRole('button', { name: 'Аудио' }));
    expect(getByRole('button', { name: 'Готово' }).classList).toContain('settings-done');
  });

  it('provides Zoom-style local recording settings without the side-by-side option', () => {
    const { getByRole, queryByText, onSetting } = renderProfile();

    fireEvent.click(getByRole('button', { name: 'Запись' }));
    expect(getByRole('heading', { name: 'Локальная запись' })).toBeTruthy();
    fireEvent.click(getByRole('switch', { name: 'Добавить временную метку' }));
    fireEvent.click(getByRole('switch', { name: 'Записывать видео при демонстрации экрана' }));

    expect(onSetting).toHaveBeenCalledWith({ recordingAddTimestamp: true }, false);
    expect(onSetting).toHaveBeenCalledWith({ recordingIncludeSharedVideo: false }, false);
    expect(queryByText(/рядом/i)).toBeNull();
  });

  it('shows active account devices with the current session marked', async () => {
    const { findByText, getByText } = renderProfile();

    expect(await findByText('2 устройства')).toBeTruthy();
    fireEvent.click(getByText('Подключённые устройства'));
    expect(getByText('FreeTalk · Windows')).toBeTruthy();
    expect(getByText('Это устройство')).toBeTruthy();
    expect(getByText('FreeTalk Web · macOS')).toBeTruthy();
  });

  it('combines video, backgrounds and independently controlled event sounds', () => {
    const { getByRole, getByText, onVideoSetting } = renderProfile();

    fireEvent.click(getByRole('button', { name: 'Видео и звуки' }));
    expect(getByRole('heading', { name: 'Видео и звуки' })).toBeTruthy();
    expect(getByText('Фон видео')).toBeTruthy();
    expect(getByRole('button', { name: 'Размытие' })).toBeTruthy();
    fireEvent.click(getByRole('switch', { name: 'Участник подключился' }));
    expect(onVideoSetting).toHaveBeenCalledWith({ participantJoinedSound: false });
  });
});

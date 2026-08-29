// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountUser } from '../lib/api-client';
import { defaultSettings } from '../lib/settings';
import { SettingsPanel } from './SettingsPanel';

afterEach(cleanup);

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
  const view = render(
    <SettingsPanel
      initialTab="profile"
      settings={{ ...defaultSettings(), displayName: 'Gera' }}
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
      onVideoSetting={vi.fn()}
      onKey={vi.fn()}
      onReset={vi.fn()}
      onCheckUpdate={vi.fn()}
      onInstallUpdate={vi.fn()}
      onSaveDiagnostics={vi.fn().mockResolvedValue('')}
      onSaveProfile={onSaveProfile}
      onAccountLogout={vi.fn()}
      onDeleteAccount={vi.fn().mockResolvedValue(undefined)}
      onChangePassword={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  return { ...view, onClose, onSaveProfile, onSetting };
}

describe('SettingsPanel profile actions', () => {
  it('keeps save and done together in the dedicated action bar', async () => {
    const { container, getAllByText, getByRole, getByText, onClose, onSaveProfile } =
      renderProfile();
    const actionBar = container.querySelector('.profile-sticky-actions');
    expect(actionBar).toBeTruthy();
    expect(getByText('Осталось изменений: 5 из 5')).toBeTruthy();
    expect(getAllByText(/до 25 МБ/)).toHaveLength(2);

    fireEvent.change(getByRole('textbox', { name: /О себе/ }), {
      target: { value: 'Новая информация' },
    });
    fireEvent.click(getByRole('button', { name: /Сохранить профиль/ }));
    await waitFor(() => expect(onSaveProfile).toHaveBeenCalledOnce());

    fireEvent.click(getByRole('button', { name: 'Готово' }));
    expect(onClose).toHaveBeenCalledOnce();
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
});

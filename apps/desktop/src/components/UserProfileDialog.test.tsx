// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserProfileDialog, type UserProfileData } from './UserProfileDialog';

const profile: UserProfileData = {
  id: '22222222-2222-4222-8222-222222222222',
  username: 'alexey',
  displayName: 'Алексей',
  bio: 'На связи вечером.',
  avatarUrl: null,
  coverUrl: null,
  registeredAt: '2026-03-12T00:00:00.000Z',
  presence: 'online',
  relationship: 'friend',
  mutualFriendsCount: 1,
  mutualFriends: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      username: 'marina',
      displayName: 'Марина',
      avatarUrl: null,
      presence: 'away',
    },
  ],
  commonChatsCount: 1,
  commonChats: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      type: 'group',
      title: 'Команда',
      avatarUrl: null,
      lastInteractionAt: new Date().toISOString(),
    },
  ],
  sharedCalls: {
    count: 8,
    lastStartedAt: new Date().toISOString(),
    lastDurationSeconds: 2520,
  },
};

afterEach(cleanup);

describe('UserProfileDialog', () => {
  it('switches social tabs and runs existing friend actions', async () => {
    const onMessage = vi.fn();
    const onCall = vi.fn();
    const onOpenChat = vi.fn();
    const { getByRole, getByText } = render(
      <UserProfileDialog
        viewerId="11111111-1111-4111-8111-111111111111"
        target={profile}
        initialProfile={profile}
        actions={{ onMessage, onCall, onOpenChat }}
        onClose={() => {}}
      />,
    );

    fireEvent.click(getByRole('button', { name: 'Написать' }));
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith(profile.id));
    const callButton = getByRole('button', { name: 'Позвонить' }) as HTMLButtonElement;
    await waitFor(() => expect(callButton.disabled).toBe(false));
    fireEvent.click(callButton);
    await waitFor(() => expect(onCall).toHaveBeenCalledWith(profile.id));
    const chatButton = getByRole('button', { name: /Команда/ }) as HTMLButtonElement;
    await waitFor(() => expect(chatButton.disabled).toBe(false));
    fireEvent.click(chatButton);
    await waitFor(() => expect(onOpenChat).toHaveBeenCalledWith(profile.commonChats![0]!.id));

    fireEvent.click(getByRole('tab', { name: 'Активность' }));
    expect(getByText('Последний звонок с вами')).toBeTruthy();
    fireEvent.click(getByRole('tab', { name: 'Общие' }));
    expect(getByText('звонков вместе')).toBeTruthy();
    expect(getByText('8')).toBeTruthy();
  });

  it('shows compact empty states without inventing activity', () => {
    const emptyProfile: UserProfileData = {
      ...profile,
      bio: null,
      mutualFriendsCount: 0,
      mutualFriends: [],
      commonChatsCount: 0,
      commonChats: [],
      sharedCalls: { count: 0, lastStartedAt: null, lastDurationSeconds: null },
      presence: 'offline',
    };
    const { getByRole, getByText } = render(
      <UserProfileDialog
        viewerId="11111111-1111-4111-8111-111111111111"
        target={emptyProfile}
        initialProfile={emptyProfile}
        onClose={() => {}}
      />,
    );

    expect(getByText('Пользователь пока ничего не добавил.')).toBeTruthy();
    expect(getByText('Нет общих друзей.')).toBeTruthy();
    expect(getByText('Нет общих чатов.')).toBeTruthy();
    fireEvent.click(getByRole('tab', { name: 'Активность' }));
    expect(getByText('Недавней активности пока нет.')).toBeTruthy();
  });

  it('uses personal wording and shows the registration date only once for the own profile', () => {
    const ownProfile: UserProfileData = {
      ...profile,
      id: '11111111-1111-4111-8111-111111111111',
      relationship: 'self',
    };
    const { getByRole, getByText } = render(
      <UserProfileDialog
        viewerId={ownProfile.id}
        target={ownProfile}
        initialProfile={ownProfile}
        onClose={() => {}}
      />,
    );

    expect(getByText('ТВОИ ДРУЗЬЯ')).toBeTruthy();
    expect(getByText('ТВОИ ЧАТЫ')).toBeTruthy();
    expect(document.querySelector('.full-profile-since')).not.toBeNull();
    expect(document.querySelector('.full-profile-joined-section')).toBeNull();
    fireEvent.click(getByRole('tab', { name: 'Твои' }));
    expect(getByText('твоих друзей')).toBeTruthy();
    expect(getByText('твоих чатов')).toBeTruthy();
  });
});

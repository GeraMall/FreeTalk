// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activeCallRoomId,
  hasConversationParticipants,
  uniqueCallParticipants,
} from '../lib/call-history';
import { RecentRooms, TransientNotice } from './HomeView';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TransientNotice', () => {
  it('starts a smooth exit and dismisses itself after four seconds', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { getByRole } = render(
      <TransientNotice message="Комната не найдена" onDismiss={onDismiss} />,
    );
    const notice = getByRole('alert');

    act(() => vi.advanceTimersByTime(3_600));
    expect(notice.classList.contains('closing')).toBe(true);
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(400));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('uses the green success treatment for successful actions', () => {
    const { getByRole } = render(
      <TransientNotice message="Аватар группы сохранён" tone="success" onDismiss={vi.fn()} />,
    );
    const notice = getByRole('status');
    expect(notice.classList.contains('success')).toBe(true);
  });
});

describe('RecentRooms', () => {
  it('deduplicates reconnect entries by user and display name', () => {
    expect(
      uniqueCallParticipants([
        { userId: 'user-a', displayName: 'Gera' },
        { userId: 'user-a', displayName: 'Gera' },
        { userId: null, displayName: ' gera ' },
        { userId: 'user-b', displayName: 'Alex' },
      ]).map((participant) => participant.displayName.trim()),
    ).toEqual(['Gera', 'Alex']);
  });

  it('treats only calls with at least two unique participants as conversations', () => {
    expect(hasConversationParticipants([{ userId: 'self', displayName: 'Gera' }])).toBe(false);
    expect(
      hasConversationParticipants([
        { userId: 'self', displayName: 'Gera' },
        { userId: 'self', displayName: 'Gera' },
      ]),
    ).toBe(false);
    expect(
      hasConversationParticipants([
        { userId: 'self', displayName: 'Gera' },
        { userId: 'friend', displayName: 'Alex' },
      ]),
    ).toBe(true);
  });

  it('renders actual call history and never inserts demo rooms', () => {
    const { getByText, queryByText } = render(
      <RecentRooms
        selfId="self"
        loading={false}
        onCreateAgain={vi.fn()}
        calls={[
          {
            id: 'call-1',
            room_id: 'ROOM12345678',
            started_at: '2026-08-26T10:00:00.000Z',
            duration_seconds: 720,
            participants: [
              { userId: 'self', displayName: 'Gera' },
              { userId: 'friend', displayName: 'Alex' },
            ],
          },
        ]}
      />,
    );
    expect(getByText('Комната с Alex')).toBeTruthy();
    expect(getByText(/12 мин/)).toBeTruthy();
    expect(queryByText('Demo room')).toBeNull();
  });

  it('does not render calls where nobody joined the creator', () => {
    const { getByText, queryByText } = render(
      <RecentRooms
        selfId="self"
        loading={false}
        onCreateAgain={vi.fn()}
        calls={[
          {
            id: 'solo-call',
            room_id: 'SOLO12345678',
            started_at: '2026-08-26T10:00:00.000Z',
            duration_seconds: 720,
            participants: [{ userId: 'self', displayName: 'Gera' }],
          },
        ]}
      />,
    );
    expect(getByText('Недавних комнат пока нет')).toBeTruthy();
    expect(queryByText('Приватная комната')).toBeNull();
  });
});

describe('activeCallRoomId', () => {
  it('reuses the current chat call instead of creating a one-second duplicate', () => {
    expect(
      activeCallRoomId([
        {
          kind: 'call',
          metadata: { roomId: 'ENDED1234567', ended: true },
        },
        {
          kind: 'call',
          metadata: { roomId: 'ACTIVE123456', ended: false },
        },
      ]),
    ).toBe('ACTIVE123456');
  });
});

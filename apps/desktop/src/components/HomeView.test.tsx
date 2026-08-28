// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uniqueCallParticipants } from '../lib/call-history';
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
            participants: [{ userId: 'friend', displayName: 'Alex' }],
          },
        ]}
      />,
    );
    expect(getByText('Комната с Alex')).toBeTruthy();
    expect(getByText(/12 мин/)).toBeTruthy();
    expect(queryByText('Demo room')).toBeNull();
  });
});

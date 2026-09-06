// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IncomingCallDialog } from './IncomingCallDialog';

afterEach(cleanup);

describe('IncomingCallDialog', () => {
  it('shows the caller and exposes accept and decline actions', () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    const screen = render(
      <IncomingCallDialog
        invitation={{
          invitationId: '11111111-1111-4111-8111-111111111111',
          roomId: 'ABCDEFGH2345',
          inviter: {
            id: '22222222-2222-4222-8222-222222222222',
            displayName: 'Анна',
            avatarUrl: null,
          },
          expiresAt: new Date(Date.now() + 30_000).toISOString(),
        }}
        secondsLeft={27}
        busy={false}
        onAccept={onAccept}
        onDecline={onDecline}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Анна' })).toBeTruthy();
    expect(screen.getByText('Ответьте в течение 27 сек.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Принять звонок' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отклонить звонок' }));
    expect(onAccept).toHaveBeenCalledOnce();
    expect(onDecline).toHaveBeenCalledOnce();
  });
});

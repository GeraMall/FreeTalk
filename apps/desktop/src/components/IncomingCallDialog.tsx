import { Phone, PhoneOff } from 'lucide-react';
import { createPortal } from 'react-dom';
import { CachedMediaImage } from './CachedMedia';

export interface IncomingCallInvitation {
  invitationId: string;
  roomId: string;
  inviter: { id: string; displayName: string; avatarUrl: string | null };
  expiresAt: string;
}

export function IncomingCallDialog({
  invitation,
  secondsLeft,
  busy,
  onAccept,
  onDecline,
}: {
  invitation: IncomingCallInvitation;
  secondsLeft: number;
  busy: boolean;
  onAccept(): void;
  onDecline(): void;
}) {
  return createPortal(
    <div className="incoming-call-layer">
      <section
        className="incoming-call-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="incoming-call-name"
      >
        <span className="incoming-call-avatar">
          {invitation.inviter.avatarUrl ? (
            <CachedMediaImage src={invitation.inviter.avatarUrl} alt="" />
          ) : (
            invitation.inviter.displayName.trim().charAt(0).toLocaleUpperCase('ru-RU') || '?'
          )}
          <i />
        </span>
        <strong id="incoming-call-name">{invitation.inviter.displayName}</strong>
        <span>Входящий звонок…</span>
        <small>Ответьте в течение {secondsLeft} сек.</small>
        <div className="incoming-call-actions">
          <button
            type="button"
            className="decline"
            disabled={busy}
            aria-label="Отклонить звонок"
            onClick={onDecline}
          >
            <PhoneOff />
            <span>Отклонить</span>
          </button>
          <button
            type="button"
            className="accept"
            disabled={busy}
            aria-label="Принять звонок"
            onClick={onAccept}
          >
            <Phone />
            <span>Принять</span>
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

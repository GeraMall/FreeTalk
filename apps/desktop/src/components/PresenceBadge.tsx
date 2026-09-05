import type { PresenceStatus } from '@freetalk/protocol';

export function PresenceBadge({ status = 'offline' }: { status?: PresenceStatus }) {
  return <span className={`avatar-presence-badge ${status}`} aria-hidden="true" />;
}

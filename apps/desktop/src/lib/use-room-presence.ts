import { useEffect, useState } from 'react';
import type { Participant, PresenceStatus } from '@freetalk/protocol';
import { accountClient } from './api-client';
import { ACCOUNT_PRESENCE_EVENT } from './presence-activity';

export function useRoomPresence(viewerId: string | undefined, participants: Participant[]) {
  const [presence, setPresence] = useState<Record<string, PresenceStatus>>({});
  const accountIds = [...new Set(participants.flatMap((p) => (p.accountId ? [p.accountId] : [])))]
    .sort()
    .join(',');
  useEffect(() => {
    if (!viewerId || !accountIds) return;
    const ids = accountIds.split(',');
    const revisions = new Map<string, number>();
    let disposed = false;
    const receive = (event: Event) => {
      const { userId, status } = (event as CustomEvent<{ userId: string; status: PresenceStatus }>)
        .detail;
      if (!ids.includes(userId)) return;
      revisions.set(userId, (revisions.get(userId) ?? 0) + 1);
      setPresence((current) => ({ ...current, [userId]: status }));
    };
    window.addEventListener(ACCOUNT_PRESENCE_EVENT, receive);
    // One bounded snapshot per roster change; subsequent updates use realtime.
    void Promise.allSettled(
      ids.map(async (id) => {
        const revision = revisions.get(id) ?? 0;
        const { profile } = await accountClient.request<{ profile: { presence?: PresenceStatus } }>(
          `/v1/users/${id}/profile`,
        );
        if (!disposed && profile?.presence && (revisions.get(id) ?? 0) === revision)
          setPresence((current) => ({ ...current, [id]: profile.presence! }));
      }),
    );
    return () => {
      disposed = true;
      window.removeEventListener(ACCOUNT_PRESENCE_EVENT, receive);
    };
  }, [accountIds, viewerId]);
  return presence;
}

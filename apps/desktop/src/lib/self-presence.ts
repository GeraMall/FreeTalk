import type { PresenceStatus } from '@freetalk/protocol';
import { ACCOUNT_PRESENCE_EVENT } from './presence-activity';

export const SELF_PRESENCE_RECONNECT_GRACE_MS = 3_000;

interface Peer {
  status?: PresenceStatus;
  listener?: (status: PresenceStatus) => void;
}

interface AccountPresence {
  peers: Set<Peer>;
  status: PresenceStatus;
  offlineTimer?: number;
}

/** A subscription reconnecting is not evidence that the whole account went offline. */
export class SelfPresenceTracker {
  private accounts = new Map<string, AccountPresence>();

  constructor(private readonly onChange: (userId: string, status: PresenceStatus) => void) {}

  get(userId: string): PresenceStatus {
    return this.accounts.get(userId)?.status ?? 'offline';
  }

  subscribe(userId: string, listener?: (status: PresenceStatus) => void) {
    let account = this.accounts.get(userId);
    if (!account) {
      account = { peers: new Set(), status: 'offline' };
      this.accounts.set(userId, account);
    }
    const entry = account;
    const peer: Peer = { listener };
    entry.peers.add(peer);
    listener?.(entry.status);
    let stopped = false;

    return {
      ready: (status: PresenceStatus) => {
        if (stopped) return;
        peer.status = status;
        this.refresh(userId, entry);
      },
      disconnected: () => {
        if (stopped) return;
        peer.status = undefined;
        this.refresh(userId, entry);
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        if (entry.peers.size === 1) {
          this.cancelOffline(entry);
          this.publish(userId, entry, 'offline');
          entry.peers.delete(peer);
          this.accounts.delete(userId);
        } else {
          entry.peers.delete(peer);
          this.refresh(userId, entry);
        }
      },
    };
  }

  private refresh(userId: string, account: AccountPresence) {
    const statuses = [...account.peers].flatMap((peer) => (peer.status ? [peer.status] : []));
    if (statuses.length) {
      this.cancelOffline(account);
      // Match the server's aggregation across authenticated subscriptions.
      const status = (['online', 'dnd', 'away'] as const).find((item) => statuses.includes(item));
      this.publish(userId, account, status ?? 'offline');
    } else if (account.status !== 'offline' && account.offlineTimer === undefined) {
      account.offlineTimer = window.setTimeout(() => {
        account.offlineTimer = undefined;
        this.publish(userId, account, 'offline');
      }, SELF_PRESENCE_RECONNECT_GRACE_MS);
    }
  }

  private cancelOffline(account: AccountPresence) {
    if (account.offlineTimer !== undefined) window.clearTimeout(account.offlineTimer);
    account.offlineTimer = undefined;
  }

  private publish(userId: string, account: AccountPresence, status: PresenceStatus) {
    if (account.status === status) return;
    account.status = status;
    this.onChange(userId, status);
    for (const peer of account.peers) peer.listener?.(status);
  }
}

export const selfPresence = new SelfPresenceTracker((userId, status) => {
  window.dispatchEvent(new CustomEvent(ACCOUNT_PRESENCE_EVENT, { detail: { userId, status } }));
});

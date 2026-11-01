import { performance } from 'node:perf_hooks';
import { ClusterStore, ClusterUnavailable } from './cluster-store.js';
import { RoomManager, RoomError } from './room-manager.js';

/** Serializes room mutations, persists before acknowledging, and fences partitioned writers. */
export class RoomCluster {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly owned = new Map<string, { epoch: string; deadline: number }>();
  private readonly outboxes = new Map<string, Array<() => void>>();
  private timer?: NodeJS.Timeout;
  private busy = false;
  constructor(
    readonly store: ClusterStore,
    readonly manager: RoomManager,
  ) {}
  async start() {
    await this.store.register();
    this.timer = setInterval(
      () => {
        void this.tick();
      },
      Math.min(3_000, this.store.node.leaseMs / 4),
    );
    this.timer.unref();
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const id of [...this.owned.keys()]) this.fence(id);
  }
  deliver(roomId: string | undefined, send: () => void) {
    const outbox = roomId ? this.outboxes.get(roomId) : undefined;
    if (outbox) outbox.push(send);
    else send();
  }
  run<T>(roomId: string, create: boolean | undefined, work: () => T | Promise<T>): Promise<T> {
    const previous = this.queues.get(roomId) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        let lease = this.owned.get(roomId);
        if (lease && performance.now() >= lease.deadline) {
          this.fence(roomId);
          lease = undefined;
        }
        if (!lease) {
          if (create === undefined)
            throw new ClusterUnavailable('This node no longer owns the room');
          const started = performance.now();
          const acquired = await this.store.acquire(roomId, create);
          lease = { epoch: acquired.epoch, deadline: started + this.store.node.leaseMs - 1_000 };
          if (performance.now() >= lease.deadline)
            throw new ClusterUnavailable('Lease acquisition timed out');
          if (acquired.snapshot) this.manager.restore(acquired.snapshot);
          this.owned.set(roomId, lease);
        }
        const outbox: Array<() => void> = [];
        this.outboxes.set(roomId, outbox);
        try {
          const result = await work();
          if (performance.now() >= lease.deadline)
            throw new ClusterUnavailable('Room lease expired');
          const started = performance.now();
          const snapshot = this.manager.snapshot(roomId);
          await this.store.save(roomId, lease.epoch, snapshot);
          lease.deadline = started + this.store.node.leaseMs - 1_000;
          if (performance.now() >= lease.deadline)
            throw new ClusterUnavailable('Room save timed out');
          if (!snapshot) this.owned.delete(roomId);
          this.outboxes.delete(roomId);
          for (const send of outbox) send();
          return result;
        } catch (error) {
          this.outboxes.delete(roomId);
          if (!(error instanceof RoomError)) this.fence(roomId);
          throw error;
        }
      });
    this.queues.set(roomId, next);
    void next
      .finally(() => {
        if (this.queues.get(roomId) === next) this.queues.delete(roomId);
      })
      .catch(() => {});
    return next;
  }
  private fence(roomId: string) {
    this.owned.delete(roomId);
    this.manager.discard(roomId);
  }
  private async tick() {
    // Local monotonic deadline still applies when the database cannot be contacted.
    for (const [id, lease] of this.owned) if (performance.now() >= lease.deadline) this.fence(id);
    if (this.busy) return;
    this.busy = true;
    try {
      await this.store.heartbeat();
      await Promise.all(
        [...this.owned.keys()].map((id) => this.run(id, undefined, () => {}).catch(() => {})),
      );
    } catch {
      for (const [id, lease] of this.owned) if (performance.now() >= lease.deadline) this.fence(id);
    } finally {
      this.busy = false;
    }
  }
}

import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type pg from 'pg';

/** Active/standby API: prevents separate in-memory chat hubs becoming independent primaries. */
export class ApiLeadership {
  private readonly id = randomUUID();
  private deadline = 0;
  private timer?: NodeJS.Timeout;
  private busy = false;
  private active = false;
  constructor(
    private readonly db: Pick<pg.Pool, 'query'>,
    private readonly onLost: () => void,
  ) {}
  isActive() {
    return performance.now() < this.deadline;
  }
  async start() {
    await this.refresh();
    let ticks = 0;
    this.timer = setInterval(() => {
      if (this.active && !this.isActive()) {
        this.active = false;
        this.onLost();
      }
      if (++ticks % 3 === 0) void this.refresh();
    }, 1_000);
    this.timer.unref();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.deadline = 0;
    this.onLost();
  }
  private async refresh() {
    if (this.busy) return;
    this.busy = true;
    const started = performance.now();
    try {
      const result = await this.db.query(
        `INSERT INTO service_leases(service,instance_id,lease_until)
        VALUES('account-api',$1,clock_timestamp()+interval '15 seconds')
        ON CONFLICT(service) DO UPDATE SET instance_id=$1,lease_until=clock_timestamp()+interval '15 seconds'
        WHERE service_leases.instance_id=$1 OR service_leases.lease_until<clock_timestamp()
        RETURNING instance_id`,
        [this.id],
      );
      this.deadline = result.rowCount ? started + 14_000 : 0;
      if (this.active && !this.isActive()) this.onLost();
      this.active = this.isActive();
    } catch {
      /* Keep only the unexpired local lease; the timer fences on expiry. */
    } finally {
      this.busy = false;
    }
  }
}

// Per-view request coordination. Data stays in React state, never in persistent storage.
export class RetainedRequest {
  private completedAt: number | undefined;
  private pending: Promise<void> | undefined;
  private refresh: Promise<void> | undefined;
  private failed: { at: number; error: unknown } | undefined;

  constructor(private readonly freshForMs = 30_000) {}

  get loaded() {
    return this.completedAt !== undefined;
  }

  run(load: () => Promise<void>, force = false): Promise<void> {
    if (this.pending) {
      if (!force) return this.pending;
      // A mutation must not reuse a snapshot requested before that mutation.
      this.refresh ??= this.pending
        .catch(() => undefined)
        .then(() => this.run(load, true))
        .finally(() => {
          this.refresh = undefined;
        });
      return this.refresh;
    }
    if (!force && this.completedAt !== undefined && Date.now() - this.completedAt < this.freshForMs)
      return Promise.resolve();
    if (!force && this.failed && Date.now() - this.failed.at < 3_000)
      return Promise.reject(this.failed.error);
    const request = Promise.resolve()
      .then(load)
      .then(() => {
        this.completedAt = Date.now();
        this.failed = undefined;
      })
      .catch((error: unknown) => {
        this.failed = { at: Date.now(), error };
        throw error;
      })
      .finally(() => {
        if (this.pending === request) this.pending = undefined;
      });
    this.pending = request;
    return request;
  }
}

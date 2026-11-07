const MOSCOW = 'https://freetalk.185-225-201-129.sslip.io/api';
const PETERSBURG = 'https://freetalk.191-44-38-60.sslip.io/api';
const PRODUCTION_BASES = [MOSCOW, PETERSBURG] as const;
const configuredBase = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8790').replace(/\/$/, '');

/** Only explicitly packaged servers may receive account credentials. */
export class ServerEndpoints {
  private selected: string;
  private checkedUntil = 0;
  private checking?: Promise<string>;
  private readonly unavailableUntil = new Map<string, number>();

  constructor(
    readonly bases: readonly string[],
    private readonly request: typeof fetch = (...args) => fetch(...args),
    private readonly now = () => Date.now(),
  ) {
    if (!bases.length) throw new Error('No TRLKA server configured');
    this.selected = bases[0];
  }

  get current() {
    return this.selected;
  }

  recognizes(base: string) {
    return this.bases.includes(base.replace(/\/$/, ''));
  }

  failed(base: string) {
    if (!this.recognizes(base)) return;
    this.unavailableUntil.set(base, this.now() + 10_000);
    if (base !== this.selected) return;
    this.checkedUntil = 0;
    this.selected =
      this.bases.find(
        (candidate) =>
          candidate !== base && (this.unavailableUntil.get(candidate) ?? 0) <= this.now(),
      ) ??
      this.bases.find((candidate) => candidate !== base) ??
      base;
  }

  async ready() {
    // Preserve custom/local development servers and their existing test contracts.
    if (this.bases.length === 1 || this.checkedUntil > this.now()) return this.selected;
    this.checking ??= this.check().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }

  private async check() {
    const candidates = [this.selected, ...this.bases.filter((base) => base !== this.selected)];
    let lastError: unknown;
    for (const base of candidates) {
      try {
        const response = await this.request(`${base}/health`, {
          method: 'GET',
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          signal: AbortSignal.timeout(3_000),
        });
        if (!response.ok) throw new Error('TRLKA server is not ready');
        const health = (await response.json()) as { ok?: boolean; service?: string };
        if (health.ok !== true || health.service !== 'freetalk-api')
          throw new Error('Invalid TRLKA health response');
        this.selected = base;
        this.checkedUntil = this.now() + 15_000;
        this.unavailableUntil.delete(base);
        return base;
      } catch (error) {
        lastError = error;
        this.failed(base);
      }
    }
    throw lastError ?? new Error('TRLKA servers are unavailable');
  }

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    if (init.signal?.aborted) throw init.signal.reason;
    const base = await this.ready();
    const safeToRetry = ['GET', 'HEAD'].includes((init.method ?? 'GET').toUpperCase());
    try {
      const response = await this.request(`${base}${path}`, { ...init, redirect: 'error' });
      if (![502, 503, 504].includes(response.status)) return response;
      this.failed(base);
      if (!safeToRetry || this.bases.length === 1) return response;
    } catch (error) {
      if (init.signal?.aborted) throw error;
      this.failed(base);
      // A POST may already have committed when its response is lost. Never replay it.
      if (!safeToRetry || this.bases.length === 1) throw error;
    }
    const fallback = await this.ready();
    return this.request(`${fallback}${path}`, { ...init, redirect: 'error' });
  }
}

export const serverEndpoints = new ServerEndpoints(
  PRODUCTION_BASES.includes(configuredBase as typeof MOSCOW | typeof PETERSBURG)
    ? PRODUCTION_BASES
    : [configuredBase],
);

export function knownApiBase(raw: string) {
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.hash) return undefined;
    return serverEndpoints.bases.find((base) => {
      const candidate = new URL(base);
      return url.origin === candidate.origin && url.pathname.startsWith(`${candidate.pathname}/`);
    });
  } catch {
    return undefined;
  }
}

export function currentSocketUrl(raw: string) {
  const url = new URL(raw);
  const httpUrl = new URL(raw);
  httpUrl.protocol = httpUrl.protocol === 'wss:' ? 'https:' : 'http:';
  const api = new URL(serverEndpoints.current);
  const known = serverEndpoints.bases.some((base) => new URL(base).origin === httpUrl.origin);
  if (!known) return { url: raw, base: undefined };
  url.hostname = api.hostname;
  url.port = api.port;
  url.protocol = api.protocol === 'https:' ? 'wss:' : 'ws:';
  return { url: url.toString(), base: serverEndpoints.current };
}

export function currentApiAsset(raw: string) {
  const known = knownApiBase(raw);
  if (!known) return raw;
  const source = new URL(raw);
  if (!source.pathname.startsWith(`${new URL(known).pathname}/v1/`)) return raw;
  source.host = new URL(serverEndpoints.current).host;
  source.protocol = new URL(serverEndpoints.current).protocol;
  return source.toString();
}

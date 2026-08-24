export interface ConnectionDiagnosticEntry {
  sequence: number;
  elapsedMs: number;
  wallTime: string;
  event: string;
  peer?: string;
  details?: Record<string, string | number | boolean | null>;
}

interface DiagnosticExport {
  schema: 1;
  generatedAt: string;
  sessionStartedAt: string;
  entries: ConnectionDiagnosticEntry[];
}

interface DiagnosticGlobal {
  __FREETALK_CONNECTION_DIAGNOSTICS__?: {
    export(): DiagnosticExport;
    clear(): void;
  };
}

const MAX_ENTRIES = 1_500;

class ConnectionDiagnostics {
  private startedAt = performance.now();
  private startedWallTime = Date.now();
  private sequence = 0;
  private entries: ConnectionDiagnosticEntry[] = [];
  private readonly peerAliases = new Map<string, string>();

  constructor() {
    const target = globalThis as typeof globalThis & DiagnosticGlobal;
    target.__FREETALK_CONNECTION_DIAGNOSTICS__ = {
      export: () => this.snapshot(),
      clear: () => this.startSession(),
    };
  }

  startSession(details?: Record<string, string | number | boolean | null>) {
    this.startedAt = performance.now();
    this.startedWallTime = Date.now();
    this.sequence = 0;
    this.entries = [];
    this.peerAliases.clear();
    this.record('session-start', undefined, details);
  }

  record(
    event: string,
    peerId?: string,
    details?: Record<string, string | number | boolean | null>,
  ) {
    const entry: ConnectionDiagnosticEntry = {
      sequence: ++this.sequence,
      elapsedMs: Math.round((performance.now() - this.startedAt) * 10) / 10,
      wallTime: new Date().toISOString(),
      event,
    };
    if (peerId) entry.peer = this.aliasPeer(peerId);
    if (details && Object.keys(details).length) entry.details = { ...details };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
  }

  snapshot(): DiagnosticExport {
    return {
      schema: 1,
      generatedAt: new Date().toISOString(),
      sessionStartedAt: new Date(this.startedWallTime).toISOString(),
      entries: this.entries.map((entry) => ({
        ...entry,
        details: entry.details ? { ...entry.details } : undefined,
      })),
    };
  }

  toText() {
    return JSON.stringify(this.snapshot(), null, 2);
  }

  private aliasPeer(peerId: string) {
    const existing = this.peerAliases.get(peerId);
    if (existing) return existing;
    const alias = `peer-${this.peerAliases.size + 1}`;
    this.peerAliases.set(peerId, alias);
    return alias;
  }
}

export const connectionDiagnostics = new ConnectionDiagnostics();

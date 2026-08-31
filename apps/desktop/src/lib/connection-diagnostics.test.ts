// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { connectionDiagnostics } from './connection-diagnostics';

describe('connection diagnostics', () => {
  it('keeps a relative timeline and anonymises stable peer identifiers', () => {
    connectionDiagnostics.startSession({ action: 'join-room' });
    connectionDiagnostics.record('peer-created', 'real-peer-id', { icePolicy: 'all' });
    connectionDiagnostics.record('connection:connected', 'real-peer-id');

    const report = connectionDiagnostics.snapshot();
    expect(report.schema).toBe(2);
    expect(report.diagnosticSchemaVersion).toBe(2);
    expect(report.appVersion).toBeTypeOf('string');
    expect(report.buildCommit).toBeTypeOf('string');
    expect(report.entries.map((entry) => entry.event)).toEqual([
      'session-start',
      'peer-created',
      'connection:connected',
    ]);
    expect(report.entries[1]?.peer).toBe('peer-1');
    expect(report.entries[2]?.peer).toBe('peer-1');
    expect(JSON.stringify(report)).not.toContain('real-peer-id');
  });

  it('starts a clean session without carrying identifiers from the previous call', () => {
    connectionDiagnostics.startSession();
    connectionDiagnostics.record('peer-created', 'first');
    connectionDiagnostics.startSession();
    connectionDiagnostics.record('peer-created', 'second');

    const report = connectionDiagnostics.snapshot();
    expect(report.entries).toHaveLength(2);
    expect(report.entries[1]?.peer).toBe('peer-1');
    expect(report.entries.map((entry) => entry.sequence)).toEqual([1, 2]);
  });

  it('queues only bounded operational telemetry and drains it once', () => {
    connectionDiagnostics.startSession();
    connectionDiagnostics.record('signaling-reconnect:start', 'secret-peer');
    connectionDiagnostics.record('ice-connection:failed', 'secret-peer');
    connectionDiagnostics.record('ice-restart:recovery:start', 'secret-peer', { attempt: 1 });
    connectionDiagnostics.record('participant-profile', 'secret-peer', { name: 'never sent' });

    const events = connectionDiagnostics.drainTelemetryEvents();
    expect(events.map((event) => event.type)).toEqual([
      'signaling_reconnect',
      'ice_failure',
      'ice_restart',
    ]);
    expect(JSON.stringify(events)).not.toContain('secret-peer');
    expect(JSON.stringify(events)).not.toContain('never sent');
    expect(connectionDiagnostics.drainTelemetryEvents()).toEqual([]);
  });
});

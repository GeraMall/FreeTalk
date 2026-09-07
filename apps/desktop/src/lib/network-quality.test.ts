import { describe, expect, it } from 'vitest';
import type { TelemetryConnectionSample } from '@freetalk/protocol';
import { calculateSignalStrength } from './network-quality';

const sample = (
  rttMs: number,
  packetLossPercent = 0,
  connectionState: RTCPeerConnectionState = 'connected',
): TelemetryConnectionSample => ({
  peerId: '11111111-1111-4111-8111-111111111111',
  connectionType: 'direct',
  localCandidateType: 'host',
  remoteCandidateType: 'host',
  protocol: 'udp',
  connectionState,
  iceState: 'connected',
  rttMs,
  availableOutgoingBitrate: null,
  availableIncomingBitrate: null,
  bytesSent: 1,
  bytesReceived: 1,
  media: [
    {
      source: 'camera',
      direction: 'inbound',
      width: 1280,
      height: 720,
      framesPerSecond: 30,
      bitrate: 1_000_000,
      packetsLost: 0,
      packetLossPercent,
      qualityLimitationReason: 'none',
    },
  ],
});

describe('calculateSignalStrength', () => {
  it('keeps a healthy connection near 100', () => {
    expect(calculateSignalStrength([sample(45)])).toBe(100);
  });

  it('reduces the score for latency and packet loss', () => {
    expect(calculateSignalStrength([sample(350, 3)])).toBeLessThan(75);
  });

  it('uses the weakest peer and reports a disconnected connection as unavailable', () => {
    expect(calculateSignalStrength([sample(40), sample(40, 0, 'disconnected')])).toBe(20);
  });
});

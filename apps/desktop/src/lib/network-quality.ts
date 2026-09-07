import type { TelemetryConnectionSample } from '@freetalk/protocol';

const clampScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

function sampleScore(sample: TelemetryConnectionSample) {
  if (sample.connectionState === 'failed' || sample.connectionState === 'closed') return 0;
  if (sample.connectionState === 'disconnected') return 20;
  if (sample.connectionState === 'connecting' || sample.connectionState === 'new') return 50;

  const rtt = sample.rttMs ?? 0;
  const rttPenalty =
    rtt <= 80
      ? 0
      : rtt <= 200
        ? ((rtt - 80) / 120) * 12
        : rtt <= 500
          ? 12 + ((rtt - 200) / 300) * 28
          : Math.min(65, 40 + ((rtt - 500) / 1_000) * 25);
  const packetLoss = Math.max(0, ...sample.media.map((media) => media.packetLossPercent ?? 0));
  const lossPenalty = Math.min(65, packetLoss * 5);

  return clampScore(100 - rttPenalty - lossPenalty);
}

export function calculateSignalStrength(samples: TelemetryConnectionSample[]) {
  if (samples.length === 0) return 100;
  return Math.min(...samples.map(sampleScore));
}

export function calculatePingMs(samples: TelemetryConnectionSample[]) {
  const values = samples
    .filter((sample) => sample.connectionState === 'connected')
    .map((sample) => sample.rttMs)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return values.length ? Math.max(1, Math.round(Math.max(...values))) : 0;
}

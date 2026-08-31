export type RoomAuthorization =
  | { allowed: true; kind: 'development'; displayName?: string }
  | {
      allowed: true;
      kind: 'registered' | 'guest';
      displayName: string;
      avatar?: string;
      userId?: string;
      anonymousUserId?: string;
      disconnectAt?: string;
    }
  | { allowed: false; reason?: string };

const apiUrl = process.env.ACCOUNT_API_URL?.replace(/\/$/, '');
const internalSecret = process.env.INTERNAL_SIGNALING_SECRET;
const allowInsecureDevelopment = process.env.SIGNALING_ALLOW_INSECURE_DEVELOPMENT === 'true';

export function assertAuthorizationConfigured() {
  if (!apiUrl && !allowInsecureDevelopment)
    throw new Error(
      'ACCOUNT_API_URL is required. Set SIGNALING_ALLOW_INSECURE_DEVELOPMENT=true only for local development.',
    );
  if (apiUrl && !internalSecret)
    throw new Error('INTERNAL_SIGNALING_SECRET is required when ACCOUNT_API_URL is configured');
}

export async function authorizeRoom(
  action: 'create' | 'join',
  roomId: string,
  token?: string,
): Promise<RoomAuthorization> {
  if (!apiUrl)
    return allowInsecureDevelopment
      ? { allowed: true, kind: 'development' }
      : { allowed: false, reason: 'AUTH_UNAVAILABLE' };
  if (!internalSecret) return { allowed: false, reason: 'AUTH_UNAVAILABLE' };
  if (!token) return { allowed: false, reason: 'AUTH_REQUIRED' };
  try {
    const response = await fetch(`${apiUrl}/v1/internal/room-authorize`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-freetalk-internal-secret': internalSecret,
      },
      body: JSON.stringify({ action, roomId, token }),
      signal: AbortSignal.timeout(5_000),
    });
    const result = (await response.json()) as RoomAuthorization;
    if (!response.ok)
      return { allowed: false, reason: 'reason' in result ? result.reason : 'AUTH_REQUIRED' };
    if (!result || result.allowed !== true || !('kind' in result))
      return { allowed: false, reason: 'AUTH_UNAVAILABLE' };
    return result;
  } catch {
    return { allowed: false, reason: 'AUTH_UNAVAILABLE' };
  }
}

export async function recordCallEvent(input: {
  event: 'start' | 'join' | 'leave' | 'end';
  roomId: string;
  displayName?: string;
  userId?: string;
  anonymousUserId?: string;
}) {
  if (!apiUrl || !internalSecret) return;
  const response = await fetch(`${apiUrl}/v1/internal/call-event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-freetalk-internal-secret': internalSecret },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Call event rejected: ${response.status}`);
}

export async function recordTelemetry(input: {
  roomId: string;
  reporterClientId: string;
  userId?: string;
  anonymousUserId?: string;
  report: import('@freetalk/protocol').TelemetryReport;
}) {
  if (!apiUrl || !internalSecret) return;
  const response = await fetch(`${apiUrl}/v1/internal/telemetry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-freetalk-internal-secret': internalSecret },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error(`Telemetry rejected: ${response.status}`);
}

export async function getRegisteredProfile(userId: string) {
  if (!apiUrl || !internalSecret) return null;
  const response = await fetch(
    `${apiUrl}/v1/internal/users/${encodeURIComponent(userId)}/profile`,
    {
      headers: { 'x-freetalk-internal-secret': internalSecret },
      signal: AbortSignal.timeout(5_000),
    },
  );
  if (!response.ok) return null;
  return (await response.json()) as { displayName: string; avatar?: string };
}

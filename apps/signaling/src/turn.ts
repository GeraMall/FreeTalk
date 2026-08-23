import type { ServerMessage } from '@freetalk/protocol';

export async function getIceConfig(): Promise<Extract<ServerMessage, { type: 'ice-config' }>> {
  const iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
  ];
  const keyId = process.env.TURN_KEY_ID;
  const token = process.env.TURN_KEY_API_TOKEN;
  const ttl = Number(process.env.TURN_CREDENTIAL_TTL_SECONDS ?? 86_400);
  if (!keyId || !token) return { type: 'ice-config', iceServers };

  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl }),
    },
  );
  if (!response.ok) throw new Error(`TURN provider returned ${response.status}`);
  const data = (await response.json()) as { iceServers: RTCIceServer[] };
  return {
    type: 'ice-config',
    iceServers: [...iceServers, ...data.iceServers],
    expiresAt: Date.now() + ttl * 1000,
  };
}

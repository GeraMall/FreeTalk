import type { ServerMessage } from '@freetalk/protocol';
import { parseDnsIpv4Answers, withCloudflareTurnIpFallbacks } from '@freetalk/config';

async function turnIpv4Addresses() {
  try {
    const response = await fetch(
      'https://cloudflare-dns.com/dns-query?name=turn.cloudflare.com&type=A',
      { headers: { Accept: 'application/dns-json' } },
    );
    if (!response.ok) return [];
    return parseDnsIpv4Answers(await response.json());
  } catch {
    return [];
  }
}

export async function getIceConfig(): Promise<Extract<ServerMessage, { type: 'ice-config' }>> {
  const iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
  ];
  const keyId = process.env.TURN_KEY_ID;
  const token = process.env.TURN_KEY_API_TOKEN;
  const ttl = Number(process.env.TURN_CREDENTIAL_TTL_SECONDS ?? 86_400);
  if (!keyId || !token) return { type: 'ice-config', iceServers };

  const [response, turnAddresses] = await Promise.all([
    fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl }),
      },
    ),
    turnIpv4Addresses(),
  ]);
  if (!response.ok) throw new Error(`TURN provider returned ${response.status}`);
  const data = (await response.json()) as { iceServers: RTCIceServer[] };
  return {
    type: 'ice-config',
    iceServers: [...iceServers, ...withCloudflareTurnIpFallbacks(data.iceServers, turnAddresses)],
    expiresAt: Date.now() + ttl * 1000,
  };
}

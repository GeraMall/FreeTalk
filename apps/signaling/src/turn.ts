import type { ServerMessage } from '@freetalk/protocol';
import { parseDnsIpv4Answers, withCloudflareTurnIpFallbacks } from '@freetalk/config';
import { localTurnConfig } from './local-turn.js';

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

async function providerIceConfig(): Promise<Extract<ServerMessage, { type: 'ice-config' }>> {
  const iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
  ];
  const keyId = process.env.TURN_KEY_ID;
  const token = process.env.TURN_KEY_API_TOKEN;
  const brokerUrl = process.env.TURN_BROKER_URL;
  const brokerToken = process.env.TURN_BROKER_TOKEN;
  const ttl = Number(process.env.TURN_CREDENTIAL_TTL_SECONDS ?? 86_400);
  if ((!keyId || !token) && brokerUrl && brokerToken) {
    const response = await fetch(brokerUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${brokerToken}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`TURN broker returned ${response.status}`);
    const data = (await response.json()) as Partial<ServerMessage>;
    if (data.type !== 'ice-config' || !Array.isArray(data.iceServers))
      throw new Error('TURN broker returned an invalid response');
    return data as Extract<ServerMessage, { type: 'ice-config' }>;
  }
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

let providerKey = '';
let cached: Awaited<ReturnType<typeof providerIceConfig>> | undefined;
let cachedUntil = 0;
let pending: Promise<Awaited<ReturnType<typeof providerIceConfig>>> | undefined;
let retryAfter = 0;

export async function getIceConfig(): Promise<Extract<ServerMessage, { type: 'ice-config' }>> {
  const local = localTurnConfig();
  // Preserve the old behavior if an independent relay is not configured.
  if (!local) return providerIceConfig();
  const key = [
    process.env.TURN_BROKER_URL,
    process.env.TURN_BROKER_TOKEN,
    process.env.TURN_KEY_ID,
    process.env.TURN_KEY_API_TOKEN,
  ].join('\n');
  if (key !== providerKey) {
    providerKey = key;
    cached = undefined;
    cachedUntil = 0;
    pending = undefined;
    retryAfter = 0;
  }
  // Refresh in the background while the old credentials remain valid. This
  // preserves TLS fallback even for the first join after a refresh deadline.
  if (cached?.expiresAt && cached.expiresAt <= Date.now() + 30_000) cached = undefined;
  if ((!cached || cachedUntil <= Date.now()) && !pending && Date.now() >= retryAfter) {
    const requestKey = key;
    const request = providerIceConfig();
    pending = request;
    void request
      .then((result) => {
        if (providerKey !== requestKey || pending !== request) return;
        cachedUntil = Math.min(
          Date.now() + 300_000,
          (result.expiresAt ?? Date.now() + 60_000) - 30_000,
        );
        cached = cachedUntil > Date.now() ? result : undefined;
      })
      .catch(() => {
        if (providerKey === requestKey) retryAfter = Date.now() + 10_000;
      })
      .finally(() => {
        if (pending === request) pending = undefined;
      });
  }
  // The independently authenticated relay is available immediately, even when
  // the external broker is blocked. Subsequent joins also get cached fallback.
  return {
    type: 'ice-config',
    iceServers: [
      ...local.iceServers,
      ...(cached?.iceServers ?? [{ urls: 'stun:stun.cloudflare.com:3478' }]),
    ],
    expiresAt: Math.min(local.expiresAt!, cached?.expiresAt ?? local.expiresAt!),
  };
}

import { createHmac, randomUUID } from 'node:crypto';
import type { ServerMessage } from '@freetalk/protocol';

/** REST credentials for our independent TURN relay. The shared key never leaves the VPS. */
export function localTurnConfig(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): Extract<ServerMessage, { type: 'ice-config' }> | undefined {
  if (!env.LOCAL_TURN_URLS && !env.LOCAL_TURN_SECRET) return;
  const urls = (env.LOCAL_TURN_URLS ?? '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
  if (
    !urls.length ||
    urls.length > 16 ||
    urls.some((url) => !/^turns?:[^\s/@]+:\d{1,5}(?:\?transport=(?:udp|tcp))?$/.test(url))
  )
    throw new Error('Invalid local TURN URLs');
  const secret = env.LOCAL_TURN_SECRET ?? '';
  if (secret.length < 32) throw new Error('Invalid local TURN secret');
  const expiresAt = now + 86_400_000;
  const username = `${Math.floor(expiresAt / 1000)}:trlka-${randomUUID()}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { type: 'ice-config', iceServers: [{ urls, username, credential }], expiresAt };
}

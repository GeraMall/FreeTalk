// Subscription URLs are supplied by clients. Never let them turn the push worker
// into an HTTP client for arbitrary Internet or internal services.
export function isTrustedPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.port !== '' ||
      url.username !== '' ||
      url.password !== '' ||
      url.hash !== ''
    )
      return false;
    return (
      url.hostname === 'fcm.googleapis.com' ||
      url.hostname === 'updates.push.services.mozilla.com' ||
      url.hostname === 'web.push.apple.com' ||
      /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname)
    );
  } catch {
    return false;
  }
}

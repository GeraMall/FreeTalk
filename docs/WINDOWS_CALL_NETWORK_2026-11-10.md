# Windows call connectivity and screen-share investigation, 10 November 2026

## Confirmed observations

Public desktop remains beta.224. The owner reported calls without audio until
both parties enabled VPN. The supplied diagnostic file is beta.224/source
11faca7ac813, generated at 20:29:26 UTC. Its current connection reached first RTP
in 4.024 seconds; that alone does not establish audible voice. Primary database
telemetry also confirms earlier attempts around 20:24–20:26 with zero transferred
bytes and failed/disconnected states. The failure was real.

The report has 57 ICE candidate errors, including TURN allocation timeouts. It
does not contain native screen-capture or native outbound-video statistics.

## Deployed relay path

Authenticated coturn now runs independently on the existing Moscow primary
185.225.201.129 and Petersburg standby 191.44.38.60. Both expose UDP/TCP 3478 and
UDP relay ports 49160–49671. REST credentials expire after 24 hours; the shared
server-only key is never sent to clients. Private/link-local/loopback/multicast
peer destinations are denied, with per-user and total allocation limits.

Cloudflare remains an additional fallback. Locally generated credentials are
returned immediately while the external provider is refreshed in the background,
so an unavailable broker cannot hold room admission. External credentials are
cached only within their validity, with stale-while-refresh and retry backoff.
The own relays do not provide TURN TLS/443; this is not a guarantee against every
network restriction.

Actual Chromium relay-only checks passed for all four endpoints (Moscow UDP/TCP,
Petersburg UDP/TCP), exchanging a 32 KiB payload in each case. Both candidate
types were relay. Sanitized evidence: outputs/doc-review/turn-ru-result.json.
Private browser scripts contain short-lived test credentials and must not be
published or committed.

Signaling 0.1.21 bundle SHA256:
4c6228c683ede9be8226f6e20f724080bc4b335bae58a394ff42f8946179f54b.
Primary restarted once with the owner's explicit permission for a brief call
reconnection. The standby application was not started. Node-specific location
headers also replace the previously hardcoded VPS-SPB label.

Rollback bundle backups:

- Primary: /root/trlka-ha/local-turn-20261110T204249/server.bundle.mjs
- Standby: /root/trlka-ha/local-turn-20261110T204252/server.bundle.mjs

Root-only configuration is /etc/freetalk/turn-local.env and
/etc/trlka-turn/shared-secret; systemd drop-in is 45-local-turn.conf. Never print
or copy their contents into a diagnostic report.

After deployment the owner confirmed voice worked without VPN. Subsequent HA
export/sync completed; PostgreSQL replica remained streaming/synchronous, primary
API/signaling active, standby application inactive. No DNS, ownership lease,
promotion or fencing action was performed. Backend: 50 tests passed, typecheck
and bundle passed.

## Unresolved Windows game-sharing FPS

FC27 is shared as an entire display. The owner corrected the result to a fall
from about 16 to 4 FPS. Borderless mode did not improve it. This task has NOT yet
fixed low screen-share FPS, and working voice must not be used as evidence that
video performance is fixed.

Private beta.227 adds numeric native capture/processing counters and whitelisted
native outbound encoder/selected route statistics to the existing local report.
It does not include SDP, addresses, credentials or pixels, does not change the
capture/encoder selection, and is intended to distinguish capture, conversion,
encoding and transmission bottlenecks during reproduction on the sender's PC.
Public feeds and Mac/Android packages are unchanged.

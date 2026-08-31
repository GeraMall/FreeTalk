# FreeTalk Admin analytics

FreeTalk Admin is a separate internal Tauri application in `apps/admin`. It is not imported by or bundled into `apps/desktop`.

## Data path

1. A joined FreeTalk client samples `RTCPeerConnection.getStats()` every 10 seconds.
2. Only bounded technical fields are sent through the already-authorized signaling socket. Frames, audio, screen pixels, SDP, IP addresses, message bodies and credentials are never included.
3. Signaling replaces the reporter identity with the identity of the joined socket and removes connection samples for peers that are not currently in the room.
4. Signaling forwards the report best-effort to `/v1/internal/telemetry` using the existing server-only internal secret. A collector failure is ignored and never blocks signaling or media.
5. PostgreSQL stores short-lived bounded samples and minute-level reporter history. The Admin API aggregates those rows and the Admin desktop only talks to that API.

The selected ICE candidate pair is authoritative. A connection is `TURN` only when the selected pair contains a relay candidate. Logical keys use `roomId + sorted(peerA, peerB)` and only the canonical reporter contributes to connection and TURN totals.

TURN traffic is an **estimate**. It is the delta of WebRTC cumulative `bytesSent` and `bytesReceived` counters. Counter resets contribute zero rather than a negative or repeated amount. It is not a Cloudflare invoice value.

## Access and secrets

- The `users.role` column is server-controlled and defaults to `user`.
- Every `/v1/admin/*` route authenticates the normal server session and then requires `role = admin`.
- Create the normal account first, verify it, then grant the role on the server:

  ```powershell
  pnpm --filter @freetalk/api admin:grant admin@example.com
  ```

- The password is never stored by FreeTalk Admin. The access token lives in WebView memory. The refresh token lives only in Rust process memory and is cleared on logout; restarting the app requires a fresh login.
- PostgreSQL credentials, the internal signaling secret, TURN credentials, root access and Cloudflare secrets are not present in the Admin bundle.
- The Tauri capability file is limited to the main window and the window operations needed by single-instance restore.

## Database and deployment

Apply `apps/api/migrations/008_admin_analytics.sql` before deploying the updated API/signaling/client. This work does not run that migration or modify production automatically.

Set `ACCOUNT_API_URL` and `INTERNAL_SIGNALING_SECRET` on signaling. Cloudflare Worker forwarding is optional and uses Worker environment variables only. The desktop build only contains the public API URL.

Raw connection samples are retained for 7 days. Events, minute reporter history, API aggregates and infrastructure samples are retained for 30 days. Message expiry counters are aggregated daily and do not retain message content.

## Build

```powershell
pnpm package:admin:windows
```

Outputs:

- `outputs/FreeTalk_Admin_0.1.0_x64-setup.exe`
- `outputs/FreeTalk_Admin_0.1.0_portable_x64.exe`

## Load harness

The included harness exercises only the analytics collector. It deliberately does not claim to prove full chat/signaling/WebRTC capacity.

```powershell
$env:LOAD_API_URL='http://127.0.0.1:8790'
$env:LOAD_INTERNAL_SECRET='local-test-secret'
$env:LOAD_ADMIN_ACCESS_TOKEN='optional-admin-access-token'
$env:LOAD_DURATION_SECONDS='60'
pnpm load:analytics:100
pnpm load:analytics:500
```

Results are written under `output/load`. Run this only against a dedicated test environment. Never run the 100/500-user harness against production without separate approval.

## Accuracy boundaries

Exact from application storage/state: registered users, registrations, active sessions, active rooms/calls recorded by the call lifecycle, chat/message/image row counts, image bytes, message expiry counters, DB size/connections, API request counts and process/VPS samples.

Derived from reporting clients: selected Direct/TURN path, RTT, bitrate, packet-loss delta, video dimensions/FPS, quality limitation, platform/version and reconnect/ICE events. A client that is offline, too old, or unable to report is absent from these metrics.

Estimated: TURN byte usage and month forecast. No Cloudflare billing API integration is enabled.

Not yet measured by this repository alone: CDN hit ratio, object-storage health, Cloudflare billed TURN bytes, true cross-process signaling socket totals, query P95 without `pg_stat_statements`, and full end-to-end 100/500-user WebSocket/chat/media capacity.

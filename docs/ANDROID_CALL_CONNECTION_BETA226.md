# Android call connection investigation — private beta226

The phone no longer crashes on native startup225, but the user reports remaining
on “connecting”. Desktop sees the participant. Changing Wi-Fi/mobile data did
not help. **The physical-phone root cause is not established.** Do not call this
a confirmed fix for the user's stalled call.

## Routing and evidence

- Android defaults to Moscow185.225.201.129, then Petersburg191.44.38.60.
  Read-only checks found primary API/signaling active and reserve instances
  inactive. The reserve forwards requests; no separate active room was found.
  The endpoint actually used on the physical phone is still unknown.
- Baseline225 code passed two native audio participants on the Android16 emulator.
- Baseline and revised code passed actual Android NativeCallMedia ↔ Chrome
  desktop PeerManager negotiation, including TURN. Revised run used browser-side
  relay and Android-side srflx; ICE and full transport connected, one remote
  audio track,14 RTP packets each direction at the success snapshot.
- These use an instrumentation-only local signaling bridge, not production room
  admission or the physical phone's ARM build/network. Silent RTP is not a
  listening test. Initial release225 startup probe only covered factory/peer/SDP.

## Changes

- Local bounded connection report: signaling endpoint classification, media init,
  SDP/ICE/full transport states, candidate counts, audio packet counters, route
  types. No SDP, IP addresses, TURN credentials, names, room/account IDs or chat
  contents. Report stays in process memory and is exported manually in Settings
  → About. It survives leaving a call, but not terminating the app process.
- Late changed ICE configuration now restarts gathering for unfinished peers.
  Duplicate configuration and established media do not trigger this restart.
- A throttled “Retry connection” action restarts unfinished media without leaving
  the room. It appears after15 seconds; it does not create/rejoin a room.
- The connected label now requires full PeerConnection transport success, rather
  than ICE alone. Call media state is scoped to the room ID.
- Copy WebRTC data-channel buffers before returning from their native callback.
- Five new native interface strings translated into all six additional languages.
- Keep the225 org.jni_zero R8 fix and same application ID/signing key.

## Verification and artifacts

See `outputs/doc-review/android226-*` for local logs. The ordinary suite contains
33 JVM tests and8 emulator checks; the browser interoperability test is opt-in.
One initial full-suite tablet accessibility check timed out; its isolated rerun
passed. Record final suite and exact release-probe results in the artifact's
`verification.json`, including any remaining limitations.

The private APK belongs in
`outputs/android/beta226-preview/Trlka_0.4.0-beta.226_android.apk`.

Packaged source:`c322dacaa6fb680036be75185938296236e61ce6`.
Size:55,766,012bytes. SHA256:
`eece309141a34c61ad38fd6c51482e37d0409b88ed4395598d718020b8c31e97`.
Final33JVM/8emulator checks passed, with the browser test explicitly skipped in
the ordinary suite and run separately. Lint:0errors/35warnings/6hints. Exact
release native factory/audio-peer/SDP probe passed; crash buffer was empty.
Direct225→226 replacement retained package UID and the same signing certificate.
All30 tablet assets remained byte-identical; only native translations changed.
Machine-readable verification:`outputs/android/beta226-preview/verification.json`.

Public web, Windows, Mac and feeds remain224. No server service, DNS, database,
fencing or failover configuration changes are part of this work.

## Phone retest

Install226 over the existing app without uninstalling. Try a call and wait30–45
seconds. If it stalls, optionally use Retry connection once, leave the call, and
save the report in Settings → About **before closing the app process**. Send
that JSON for diagnosis. A successful emulator test is not a guarantee for this
phone.

## Manual browser interoperability fixture

`BrowserCallInteropTest` runs only with `browserInterop=true` instrumentation
arguments. Forward host TCP18898 to emulator TCP18898. Open
`scripts/android/browser-call-interop.html` via the desktop Vite dev server1420
using Playwright CLI. Supply a short-lived ICE config as `window.interopIce` and
optionally set `window.forceRelay=true`; never commit credentials, SDP, full
candidate logs or private injection files. Click the start button and inspect
`window.interopResult`. The fixture uses the real desktop PeerManager, and the
Android half uses real NativeCallMedia, without creating production accounts.

# FreeTalk production deployment report — 2026-08-31

## Decision

- **Admin analytics production deployment: PASS.** The migration, API,
  signaling collector, role boundary, Windows Admin application, privacy
  controls, rollback assets, and failure isolation were verified.
- **FreeTalk `0.4.0-beta.73` cohort smoke: PASS with documented gaps.** Login,
  room creation/join, direct WebRTC audio, camera, screen sharing,
  camera-and-screen together, telemetry, and reconnect were exercised against
  production.
- **Mass updater promotion to `0.4.0-beta.73`: NOT PERFORMED.** The public
  updater remains on `0.4.0-beta.43`. A broad release should be a separate
  operation after the remaining chat/image, forced-TURN, and macOS gaps are
  accepted or closed.

No infrastructure size, paid service, TURN/CDN configuration, or production
capacity setting was changed.

## Production result

| Check                                        | Result | Evidence                                                                        |
| -------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| Pre-deploy inventory and secret-key presence | PASS   | Values were never printed or copied                                             |
| PostgreSQL backup and restore rehearsal      | PASS   | 21/21 tables, 7/7 users, and 191/191 messages restored                          |
| Migration rehearsal                          | PASS   | Candidate API startup succeeded on the restored copy                            |
| Migration `008_admin_analytics`              | PASS   | Applied at `2026-08-31 17:15:33 UTC`                                            |
| Production API                               | PASS   | `0.4.0-beta.15`, local and public health healthy                                |
| Production signaling                         | PASS   | `0.1.1`, local health healthy                                                   |
| Runtime errors after final API deployment    | PASS   | 0 uncaught/fatal/5xx runtime error records                                      |
| Admin authentication boundary                | PASS   | Anonymous 401; verified non-admin 403; forged role headers/query 403; admin 200 |
| Admin live dashboard                         | PASS   | Current user/room/call, Direct/TURN, VPS, API, PostgreSQL, signaling displayed  |
| Stale-room/current-metric handling           | PASS   | Current counters depend on fresh reporters; ended calls remain historical only  |
| Collector failure isolation                  | PASS   | Injected telemetry 503 did not block room authorization                         |
| Admin application isolation                  | PASS   | WebRTC and telemetry continued while Admin was stopped                          |
| Telemetry privacy                            | PASS   | No raw IP, e-mail, chat content, or message body in analytics tables            |
| New API request logging privacy              | PASS   | Remote address and port are redacted after `beta.15`                            |
| Rollback assets                              | PASS   | Database dump and versioned API/signaling copies retained                       |

One signaling journal entry contained a protocol message whose type was
`error`; it was not a process exception or service failure. The stricter
runtime-error search returned zero findings.

## Real Windows `0.4.0-beta.73` smoke

| Flow                             | Result    | Notes                                                                               |
| -------------------------------- | --------- | ----------------------------------------------------------------------------------- |
| Existing-account login           | PASS      | Portable candidate used against production                                          |
| Create room / join peer          | PASS      | Room limit displayed as 8; production peer joined                                   |
| WebRTC transport                 | PASS      | Direct host-host UDP                                                                |
| Remote audio                     | PASS      | One real remote audio track received                                                |
| Camera                           | PASS      | Stabilized at 1280x720, 30 fps, no observed packet loss                             |
| Screen sharing                   | PASS      | 2560x1440, about 55 fps, no observed packet loss                                    |
| Camera and screen simultaneously | PASS      | Two media sources persisted over multiple telemetry reports                         |
| Reconnect                        | PASS      | New valid session rejoined and restored direct media                                |
| Room cleanup                     | PASS      | Room ended and open participant count returned to zero                              |
| Chat text                        | NOT RUN   | Sending a message is an external communication and was not confirmed at action time |
| Chat image                       | NOT RUN   | Upload/send was not confirmed at action time                                        |
| Screen system audio              | NOT RUN   | The selected Windows source supplied no audio track                                 |
| Forced TURN relay                | NOT RUN   | No safe forced-relay production mode was available; real smoke used Direct          |
| macOS arm64/x64 packages         | NOT BUILT | The Windows build host cannot produce/verify macOS packages                         |
| 100/500-client capacity runs     | NOT RUN   | Intentionally excluded; no production load spike was generated                      |

TURN byte totals and CDN hit ratio are therefore unavailable as billing-grade
measurements. No extrapolated estimate is presented as provider usage.

## Resource observation

These are point observations, not a controlled attribution study. Deployment
traffic, artifact transfer, service restarts, WebRTC smoke, and retained
rollback files are included.

| Metric                     |          Before |           After |                          Delta |
| -------------------------- | --------------: | --------------: | -----------------------------: |
| System RAM used            |   479,367,168 B |   538,013,696 B | +58,646,528 B (about 55.9 MiB) |
| Disk used                  | 5,516,574,720 B | 5,752,799,232 B | +236,224,512 B (about 225 MiB) |
| API process memory         |    89,264,128 B |    44,441,600 B |                  -44,822,528 B |
| Signaling process memory   |    90,165,248 B |    50,642,944 B |                  -39,522,304 B |
| API health latency average |        4.652 ms |        1.884 ms |                      -2.768 ms |
| API health latency p95     |       10.033 ms |        3.129 ms |                      -6.904 ms |

The final database size was 13,425,687 bytes. Analytics/telemetry relations
occupied 1,105,920 bytes at final inspection. Disk growth is dominated by
retained rollback/build artifacts rather than analytics data.

## Artifacts

| Artifact                                             |         Size | SHA-256                                                            |
| ---------------------------------------------------- | -----------: | ------------------------------------------------------------------ |
| `FreeTalk_Admin_0.1.0_x64-setup.exe`                 |  2,289,040 B | `0C2CC9509C825A17C9278228C2CF7484F2998D3FE79FB4EC0B44521246964E21` |
| `FreeTalk_Admin_0.1.0_portable_x64.exe`              |  9,175,552 B | `31EF3A10C7AEB342BC9C00D54D9E6DED5B4197B1E063DFA0F8B36A9234B1D0E2` |
| `FreeTalk_0.4.0-beta.73_x64-setup.exe`               |  7,979,631 B | `9C354EAAA6B0A2E2F69D842EC5079F4F247EBC680347202693028C40839A5205` |
| `FreeTalk_0.4.0-beta.73_portable_x64.exe`            | 20,178,944 B | `E87791C1976705F1723BC92112F793DE8B3AB03B4813F5C3D48A9209490615C9` |
| `freetalk-api-0.4.0-beta.15-20260831T191930Z.tar.gz` |     57,820 B | `D9276A7CCE52C75764A4D52B11AC8703F8F6F42DA4B1C547C334ADCF7A1A66B3` |

Windows packages are currently unsigned.

## Backup and rollback

- Database backup:
  `/var/backups/freetalk/pre-admin-analytics-20260831T170045Z.dump`
- Backup size: 2,461,937 bytes.
- Backup SHA-256:
  `71b4b789133d1e95844969f66ba136ca7c3bfd97f01a428520d767e9b09719db`
- Backup permissions: `root:postgres`, mode `0640`.
- Original API rollback:
  `/opt/freetalk/api-rollback-pre-admin-20260831T171632Z`
- Original signaling rollback:
  `/opt/freetalk/server.bundle.rollback-pre-admin-20260831T171702Z.mjs`
- Immediate previous API rollback:
  `/opt/freetalk/api-rollback-0.4.0-beta.15-pre-20260831T192021Z`

The exact database/artifact rollback procedure is recorded in
`PRODUCTION_DEPLOY_2026-08-31.md`. Rollback was rehearsed on a restored copy;
production rollback was not needed.

## Release recommendation

Keep `0.4.0-beta.73` as a controlled candidate for now. Before changing the
public updater, complete or explicitly waive the text/image chat smoke, test a
relay-only path in a non-disruptive environment, decide how macOS artifacts
will be built and signed, and sign the Windows installers if Windows trust
prompts are unacceptable. If those gaps are accepted, promotion should still
be executed as its own release with updater metadata verification and a staged
cohort before all users.

## Follow-up verification and image-cache update

The user subsequently confirmed that chat text, chat images, and screen-recording
audio work in the installed client. These are user-observed PASS results rather
than independently automated production actions.

On the same date, the image path was upgraded for client `0.4.0-beta.74`:

- new uploads include a bounded WebP/JPEG thumbnail of at most 256 KiB;
- the chat feed lazily loads thumbnails up to 800 px before the viewport;
- the full image is fetched only when the viewer is opened;
- authenticated downloads are deduplicated and persisted per account in a
  384 MiB/800-entry IndexedDB LRU cache;
- expired entries and privacy-sensitive account/chat transitions clear cached
  data;
- legacy image messages remain compatible and fall back to their original blob
  on the first load.

Migration `009_chat_image_thumbnails` was rehearsed against a restored database
copy and deployed with API `0.4.0-beta.16`. The public updater was not changed.

Follow-up artifacts:

- `FreeTalk_0.4.0-beta.74_x64-setup.exe` — 7,983,618 bytes, SHA-256
  `1258D1A8154581A1C18AA8E6FAD5A4D18D451E6762A4F25286D5F087CC2AB57E`;
- `FreeTalk_0.4.0-beta.74_portable_x64.exe` — 20,187,648 bytes, SHA-256
  `A511A4CEF6F89F393E3B102BDAB3E3AA7A8B15697E174149B31F21A1DA6B01A6`;
- database backup
  `/var/backups/freetalk/pre-image-cache-20260831T203133Z.dump` — 3,229,005
  bytes, SHA-256
  `ccaef9a1c617ebbe39a353b25df917ee2df35132c99f2ed6ec09a56c15b40baa`;
- immediate API rollback
  `/opt/freetalk/api-rollback-0.4.0-beta.16-pre-20260831T203208Z`.

## Public beta.74 promotion — 2026-09-01

The remaining chat/image smoke was accepted, screen-recording audio was confirmed
by the product owner, and the forced-TURN exercise was explicitly deferred until
there is evidence of a relay-path problem. Desktop `0.4.0-beta.74` was therefore
promoted to the public updater channel.

- Release: `https://github.com/GeraMall/FreeTalk/releases/tag/v0.4.0-beta.74`
- Source commit: `9fb488a`
- GitHub Actions run: `33438161328` — PASS
- Windows x64 NSIS and portable artifacts: PASS
- macOS Apple Silicon app, DMG and updater archive: PASS
- macOS Intel app, DMG and updater archive: PASS
- macOS `/usr/lib/swift` runtime-path verification: PASS on both architectures
- Signed `latest.json`: Windows x64, Darwin arm64 and Darwin x64 entries present;
  every referenced URL returned HTTP 200
- GitHub `releases/latest`: `v0.4.0-beta.74`

The release is updater-signed, but the macOS applications still use ad-hoc code
signing. Developer ID signing and Apple notarization require Apple credentials and
remain a distribution-hardening follow-up; Gatekeeper may require the standard
manual confirmation on first launch.

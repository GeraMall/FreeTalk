# Windows preview beta.202: Saved Messages and Archive

Requested on 7 November 2026. This is a local preview; no public Windows/Mac
release or production web UI deployment is authorized by this request.

## Behavior

- Three matching compact controls beside the chat-list heading: Archive,
  Saved Messages and Create Group. The same actions are available on mobile.
- Saved Messages opens one private, permanent, single-member conversation per
  account. The first opening is empty. Normal text, attachment and forwarding
  message routes provide durable storage. Calls and adding participants are
  unavailable; the API also rejects these actions.
- Right-click a sidebar conversation, or use Shift+F10, to archive it. Open
  Archive to view archived conversations and restore them using the same menu.
  Mobile swipe actions use the same account-specific server preference.
- Concurrent opens return the same saved conversation. The client also
  deduplicates initial creation and repeated archive requests.
- Saved chats are included in lists only for clients sending the collections
  capability header. Older clients therefore do not show an unnamed self-chat.

## Server changes

API beta.50, migration `028_chat_collections.sql`:

- A partial unique index guarantees one saved chat per owner.
- The chat constraint requires a direct conversation with permanent retention.
- `chat_members.archived_at` is personal; it does not remove membership/history
  or change the other members' chat lists.
- Archive updates notify only the account that changed the preference.
- Additive schema changes remain compatible with API beta.49 for rollback.

Production API beta.50 and migration 028 are active. During preparation, SSH
and HTTPS intermittently disconnected, then access recovered. The production
API, signaling and Caddy were active after deployment. Public HTTPS health and
the desktop-origin CORS preflight passed. The new saved-chat route rejected an
unauthenticated request with 401. No production web UI or public updater change
was made.

Prepared activation and rollback:

- `outputs/doc-review/collections-deploy-api50.sh`: checks the previous API
  version, creates a PostgreSQL backup, then invokes the maintained deployment
  script with migration, rehearsal health check and automatic API rollback.
- Artifact: `outputs/production-server/freetalk-api-0.4.0-beta.50-20261107T093249Z.tar.gz`.
- Database backup: `/opt/freetalk/backups/pre-collections-api50-20261107.dump`.
- API rollback: `/opt/freetalk/api-rollback-0.4.0-beta.50-pre-20261107T094758Z`.
- Isolated QA service: `trlka-collections-qa`, directory
  `/opt/freetalk/collections-qa-20261107`, database
  `trlka_collections_qa_20261107`. The QA service was stopped and its database
  removed after validation. Only synthetic users, a group and test notes were
  created there; production data was not copied into it.

## Validation

- API: 138 tests passed (25 files).
- Desktop: 434 tests passed (65 files); the 10 API-client tests passed again
  after adding the legacy-client capability header.
- Modified TypeScript passed ESLint; desktop production build and API build
  passed; formatting and whitespace checks passed.
- Real PostgreSQL and staged API: all 28 migrations applied to a separate empty
  database. Five concurrent saved-chat opens returned one conversation; initial
  history was empty; notes survived a new login; a second user could not read
  them; saved-chat calls/invites were rejected; archiving did not alter the
  other member's list; restoring worked; legacy lists excluded saved chats.
- Browser UI on the staged API: saved-note send/read, right-click archive and
  restore, desktop 800px layout, mobile 390px layout without horizontal overflow.
- Screenshots: `outputs/collections-saved-preview.jpg` and
  `outputs/collections-archive-preview.jpg`.

## Local Windows packaging

The SDK's WebRTC download extracted successfully but its final directory rename
failed with Windows access error 5. All 38,755 archive entries were checked
against extracted sizes and the extracted `webrtc.lib` SHA-256 matched the ZIP
entry: `3E5959B5320579814706848A0641224DB22F03A374493E90CBD235948977F930`.
The verified cache was copied into the shorter `.build-tmp/webrtc-a545de4`
directory and packaging used `LK_CUSTOM_WEBRTC` plus the existing portable
MSVC 14.52 toolchain used for earlier successful builds. This is a local build
environment workaround; no SDK/call code or dependency versions were changed.

Windows installer and portable executable were produced successfully and their
checksums matched the original Tauri bundle/release files. Both report product
version `0.4.0-beta.202`. The outer PowerShell 5 log wrapper treated pnpm stderr
as a native-command error even though the underlying build/copy completed; file
timestamps, product versions and matching hashes verified the resulting output.
The installed running TRLKA process was not replaced or interrupted for a smoke
launch.

- `outputs/Trlka_0.4.0-beta.202_x64-setup.exe`, 47,852,822 bytes,
  SHA-256 `7a740b52da9dc99d4a24b9c66d8332c39014b3bcd229d6cf253185193265635a`.
- `outputs/Trlka_0.4.0-beta.202_portable_x64.exe`, 74,344,448 bytes,
  SHA-256 `1845b792ad225112335a855869ab61d4af88e1ab54f40bfec3bb136faadb5982`.

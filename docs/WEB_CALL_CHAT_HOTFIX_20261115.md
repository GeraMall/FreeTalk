# Mobile web: chat during a call

Published on 15 November 2026 at https://trlka.com/app/ at the owner's explicit request.

Source: `910b338`, branch `release/web-call-chat-20261115`, based on the actual public web source `7811583`. The isolated worktree `D:/FreeTalk-web-call-chat` contains only the call/chat change and its tests (five files). It does not publish the Android preview or other private changes.

The call toolbar exposes the conversation associated with the room. Opening it keeps the call, microphone and signaling mounted. A room without a linked conversation opens its temporary room chat. Mobile layout reserves room for the minimized call and the keyboard.

Validation: 66 targeted tests, TypeScript and production build passed. Public HTTPS index and both generated entry assets were fetched and matched the local build. The reserve received the same index; both HA monitors remained healthy and PostgreSQL replication was streaming with zero lag. API and signaling process IDs and start times were unchanged.

Public index SHA256: `75a29103579957c4c4b65215c5827ead567f3be10d22d4efd936f3b8460caba6`.

Deployment evidence: `outputs/doc-review/web-call-chat-deployment.log` and `outputs/doc-review/web-call-chat-public-verified.log`. Server backup: `/root/trlka-ha/web-call-chat-20261115/index.before.html`.

Desktop/Mac installers and public update feeds remain beta.224. No database, API, signaling, ownership, fencing or DNS changes were made. A physical iPhone conversation was not tested in this environment.

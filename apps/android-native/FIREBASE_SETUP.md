# Android push activation

Project: trlka-b5d34. Android package: io.freetalk.mobile.
The checked-in google-services.json is Firebase client configuration, NOT a
server service-account key. Do not put private keys in this module.

Implemented:

- Firebase Messaging SDK, token registration on login/resume and token refresh
  while the app process has an authenticated API instance.
- Data-only high-priority notifications, account guard, expiry guard, persistent
  message-ID deduplication shared with WebSocket delivery.
- Logout clears the local account binding and displayed notifications.
- Backend session-bound devices and transactionally enqueued deliveries.
- Worker rechecks session, chat membership, expiry and blocking before sending;
  invalid tokens are removed, transient failures retry, queue lifetime is one hour.

Deployment procedure (production completed 2026-09-04; see docs/ANDROID_PUSH_DEPLOY_2026-09-04.md):

1. Apply API migration 010_android_push.sql via the existing migration command.
2. Configure Firebase Admin credentials on the API server using workload identity
   or a dedicated service-account file outside the repository and container image.
   Grant only the FCM message sending permissions needed for this project.
3. Set GOOGLE_APPLICATION_CREDENTIALS to that server-local file when using a key.
   Set FCM_PROJECT_ID=trlka-b5d34 and FCM_ENABLED=true in the API environment.
   Mount the credentials read-only if using containers.
4. Deploy/restart API, install alpha.9, allow Android notifications and sign in.
5. Test between two real accounts: foreground chat, other chat, background,
   locked screen, process recreation, logout and account switch. Verify no duplicates.

The client configuration alone does not activate production message delivery.
Production credentials were supplied separately by the user and deployed through
systemd LoadCredential on 2026-09-04. They are not in this repository.
Google Play services are needed for this FCM integration. Android force-stop,
denied notification permission and device/network restrictions can prevent delivery.
Notification tap currently opens the application, not a specific conversation.
Token rotation while the process is absent is registered on the next foreground
session; persistent background token-registration work is not yet implemented.

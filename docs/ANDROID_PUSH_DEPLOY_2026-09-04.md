# Android push deployment — 2026-09-04

- API beta.19 deployed; local and public API health passed.
- Migration 010_android_push applied; durable queue and device registration active.
- FCM project trlka-b5d34, dedicated trlka-push identity.
- Credentials stored outside application/repository at /etc/freetalk/trlka-push.json,
  root-owned 0600, provided to the unprivileged API through systemd LoadCredential.
- Server-side FCM validate-only request succeeded under the freetalk user with
  credentials loaded by systemd. No user notification was sent by this test.
- Signaling remained active and was not restarted.
- API rollback: /opt/freetalk/api-pre-push-20260904T100923Z.
- Database backup: /var/backups/freetalk/pre-push-20260904T100923Z.dump.
- Initial VPS npm install timed out; retry completed in the same stage.
- At verification, registered Android devices=0 and pending deliveries=0.
  Real-device delivery remains unverified; install native alpha.9, allow
  notifications and sign in/resume so the token registers.
- Temporary root upload copy of the credential removed after comparing against
  the installed credential. Original user download remains untouched.

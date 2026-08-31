# FreeTalk production deployment — 2026-08-31

This runbook records the production baseline and rollback sequence before the
admin analytics migration is applied. Secrets are intentionally omitted.

## Baseline

- Public FreeTalk updater release: `0.4.0-beta.43` (`d8d77f0`).
- Repository worktree version: `0.4.0-beta.73`.
- API health version: `0.4.0-beta.10`.
- API artifact SHA-256: `5f078862ad1983aea0d580469fe6cf979dd6d30ec4822c86ba1b71fb609735e2`.
- Signaling package version: `0.1.0`.
- Signaling artifact SHA-256: `e2655096368bf05e8ce3ea4f5bed1f43d95393fec002463e807d1172da13f987`.
- PostgreSQL: `16.15`; database size before deployment: `11,803,671` bytes.
- Migration 008: not applied (`telemetry_connection_samples` absent and
  `users.role` absent).
- Required `ACCOUNT_API_URL` and `INTERNAL_SIGNALING_SECRET` keys are present in
  the signaling environment. The matching internal secret key is present in the
  API environment. Values were not printed or copied.

## Rollback triggers

Rollback immediately if migration validation, API/signaling startup, health,
authorization boundaries, core login/chat/room smoke tests, or analytics
failure-isolation checks fail.

## Exact rollback sequence

1. Stop `freetalk-signaling` and `freetalk-api`.
2. Preserve the failed artifacts and database for investigation:
   - move `/opt/freetalk/api` to the timestamped failed path;
   - copy `/opt/freetalk/server.bundle.mjs` to a timestamped failed bundle;
   - terminate database sessions and rename database `freetalk` to a
     timestamped `freetalk_failed_*` name.
3. Restore the pre-deploy API directory from its timestamped rollback path.
4. Restore the pre-deploy signaling bundle from its timestamped rollback copy.
5. Create a fresh database named `freetalk`, owned by role `freetalk`, and run
   `pg_restore --exit-on-error --no-owner --dbname=freetalk <backup>` as the
   PostgreSQL administrator.
6. Start `freetalk-api`, then `freetalk-signaling`.
7. Require local and public `/health` PASS plus login and room create/join PASS.
8. Keep the failed database/artifacts until the incident is understood. Delete
   them only through a separately reviewed cleanup.

The production desktop updater remains pinned to `0.4.0-beta.43` during this
deployment. Client `0.4.0-beta.73` is a separate beta smoke-test candidate and
is not published to all users by this runbook.

## Final state

The analytics deployment completed successfully. Production is running API
`0.4.0-beta.15` and signaling `0.1.1`; migration `008_admin_analytics` is
applied. The updater was intentionally left on `0.4.0-beta.43`. See
`PRODUCTION_DEPLOY_REPORT_2026-08-31.md` for the verification matrix, measured
overhead, artifacts, limitations, and release recommendation.

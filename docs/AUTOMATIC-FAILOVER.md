# Automatic reserve switching

Moscow HOSTKEY `185.225.201.129` is the normal primary. Petersburg RUVDS
`191.44.38.60` is the only automatic promotion candidate. The independent
Cloudflare Worker `trlka-ha-witness` serializes ownership in a Durable Object.
This is a single failover followed by operator repair, not automatic failback.

## Safety and availability

- While the reserve is eligible, PostgreSQL uses
  `FIRST 1 (trlka_petersburg)` and `synchronous_commit=on`.
- If replication stops, Moscow first revokes eligibility in the witness and
  only then permits asynchronous commits. The stale reserve cannot promote.
  If the witness is unreachable, it keeps strict synchronous commits.
- After at least 90 seconds of failed private and public primary probes,
  Petersburg checks the replay barrier and a fresh, checksum-verified file
  publication, freezes file synchronization, and records a fencing intent.
- The fencing intent prevents Moscow from changing eligibility concurrently.
  The HOSTKEY API must confirm power-off twice before the witness transfers
  ownership. HTTP timeouts, successful job submission and `POWERING_DOWN` are
  not proof of fencing.
- Only then may PostgreSQL promote and the local API/signaling start. The old
  primary's startup guard requires a fresh proof of current ownership, so a
  restarted old primary cannot start serving writes after ownership moves.
- No controller powers a machine on or performs automatic failback. After a
  failure, an operator must reseed the old primary from the surviving database
  before returning it to service. Do not start its old writable database as a
  second application backend.

Acknowledged database commits are protected by synchronous replication while
the reserve is eligible. In-memory voice rooms are reconstructed by updated
clients; a failure can interrupt calls. This setup does not guarantee zero
downtime or protect against both VPS hosts and the witness failing together.

## Services and files

Both nodes run `trlka-ha-automatic.service`. Configuration is
`/etc/trlka-ha/automatic.json`; `armed:false` is observation only.
The marker `/etc/trlka-ha/automatic-enabled` enables the application startup
guard. `/etc/trlka-ha/automatic-paused` pauses controller actions for operator
repair. A fresh proof lives in `/run/trlka-ha/owner.json` and expires after
150 seconds. The controller is protected by a process lock.

Install `auto_failover.py`, `hostkey_provider.py`, `primary_guard.py`,
`snapshot_manifest.py`, and `regru_dns.py` in `/usr/local/lib/trlka-ha`.
`configure-local-admin.sh` maps only local Unix `root` and `postgres` to the
PostgreSQL administrator using peer authentication. It adds no administrator
TCP listener or database password. This avoids changing Unix UID from the
hardened controller service.

The export/sync services publish code and site files every five minutes.
`manifest.json` covers all regular files and symbolic links in the export.
The reserve verifies it before publishing and records the completed digest in
`/var/lib/trlka-ha-controller/files-ready.json`. A partial or mixed export
cannot authorize promotion. Always export and sync immediately after a server
deployment rather than waiting for the timer. Preserve unrelated Caddy sites
when generating the failover configuration.

## Credentials

- Node-specific witness keys: `/etc/trlka-ha/witness.key`, root-only.
- HOSTKEY key: reserve `/etc/trlka-ha/hostkey-api.key`, restricted at the
  provider to server `83515` and source IP `191.44.38.60`.
- REG.RU credentials: reserve `/etc/trlka-ha/regru-api.json`, root-only.
  Use a separate API password and IP restriction. The provider credential may
  have broader account permissions than this client's fixed `trlka.com` scope.
- Operator witness key: Windows DPAPI-protected
  `~/.ssh/trlka_ha_witness_admin.dpapi`. Do not publish it or copy it to either
  VPS. `/handoff` and `/cancel-fence` are operator-only repair operations.

Neither credentials nor tokens belong in Git, shell arguments, URLs or logs.

## Website DNS limitation

`trlka-ha-dns.timer` on Petersburg reconciles only the apex A record after
fresh witness ownership and local API readiness are confirmed. It adds the
reserve address before removing the exact previous address; unrelated records
are preserved. A lost response is resolved by reading current records on the
next tick. It never automatically switches DNS back to Moscow.

The current REG.RU ordinary DNS service clamps the requested 300-second TTL
to **one hour**; negative TTL is five minutes. Previously cached one-day
records may persist until their old TTL expires. Provider publication delay
and resolver caching also affect website recovery. This DNS arrangement does
not provide immediate website failover. A faster authoritative DNS service or
independent healthy reverse proxy is a separate improvement.

Beta.203 clients contain both fixed HTTPS/WSS server addresses, probe health
without credentials, and can select the alternate server independently of
website DNS. Only safe GET/HEAD requests are replayed; ambiguous POST/PATCH/
DELETE requests are never automatically duplicated. Older clients need the
update to survive loss of the legacy Petersburg frontend.

## Arming and repair

1. Keep the candidate unarmed while preparing guards, file validation and
   provider access. Verify both nodes and backups.
2. Arm Moscow. Verify the witness says `owner=moscow`, `reserveEligible=true`,
   the replica is `sync`, and the service-user startup guard succeeds.
3. Enable startup guards and arm Petersburg only after those checks pass.
4. Before planned application stops, query the protected active-rooms endpoint
   and require zero active calls.
5. After a real failover, keep the old node fenced. Pause its controller,
   preserve the old PGDATA, and reseed it with `pg_basebackup` from the current
   owner over WireGuard. Its application services must remain stopped.
6. To return to Moscow, pause both controllers, stop Petersburg application
   writers, obtain and replay the final WAL barrier on Moscow, and stop the
   Petersburg database. Promote Moscow, perform an administrator witness
   handoff, save its fresh proof, then start its applications. Reseed Petersburg
   before restoring synchronous eligibility and unpausing the candidate.
7. Restore DNS explicitly and check both public endpoints, WSS, replication,
   guards, backups, export/sync and monitor timers. Do not erase old PGDATA
   until the restored system has been verified.

If fencing was started but the provider operation failed, first pause the
candidate and verify it is still in recovery. Verify the old primary's actual
power/data state before using administrator `/cancel-fence` with the current
epoch. This revokes eligibility; Moscow must establish a new sync barrier.
Never clear a fencing intent blindly or use it to run two writable backends.

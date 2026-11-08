# Isolated online/chat capacity lab

This is a synthetic capacity experiment, not a certificate for the production VPS.
No production keys, databases, accounts, DNS, HA configuration or TURN traffic are used.

Run the existing `Checks` workflow on the test branch with `capacity_lab=true`.
It calls `capacity-lab.yml`. PostgreSQL 16, the unmodified real API and a test reverse
proxy share one cgroup: 2 CPU cores of time, 4 GiB RAM, no swap. The generator runs
outside that cgroup. Underlying CPU/storage/network can differ from HOSTKEY.
The gateway uses one synthetic source IP per user because the real API trusts its
loopback reverse proxy and enforces per-IP limits. Limits remain enabled.
The gateway is loopback-only, requires the CI-only guard and must never be deployed.

The database is new and disposable, named `trlka_capacity_<run id>`, port 54329.
All current migrations are applied. Seeded fixtures: 10,000 verified synthetic users,
10,000 valid access-token sessions, 1,000 ten-person groups, 20,000 text messages.
Session validity is checked by the real API. Password login/Argon2 is not exercised.
No normal registration, CAPTCHA, email or real push delivery is performed.

Stages: 100/500/1,000/2,500/5,000/10,000 simultaneous authenticated WebSockets,
at most 100 new connections per second; holds 30/30/45/45/60/180 seconds.
At each stage 10% of users send a message and read history once per 30 seconds;
chat lists load at half that rate. Every message fanout must reach every online
member of its ten-person group. Heartbeats run normally during all holds.

Outputs include achieved simultaneous ready sessions, per-stage failures, HTTP
latencies/statuses, realtime fanout latencies and cgroup CPU/RAM/OOM metrics.
Stop on authentication/connection losses, >1% HTTP failures, repeated unhealthy
API responses, delivery timeouts, near-memory limit or load-generator saturation.
A passed stage requires no errors and HTTP P95 <1 second. A later failed stage does
not erase earlier results. Generator saturation makes the ceiling inconclusive.

The result does **not** cover TLS/Caddy, DDoS filtering, internet latency, HA sync,
large existing data, friends/social graph fanout, files, browser rendering, calls,
screen sharing or TURN. It also does not cover future community servers/bots.
Increasing API/socket capacity says nothing by itself about media capacity.

The cloud lab runs only in a disposable CI VM. The service is stopped in an
`always()` step. Upload only `output/load/capacity-*.json`; never upload synthetic
session fixtures or raw server logs as ordinary reports. Public beta224 and both
production servers remain unchanged. Any production stress test is a separate
operation with monitoring, clear thresholds and a recovery plan.

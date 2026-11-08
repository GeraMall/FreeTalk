# Isolated 10,000-online chat capacity result — 8 November 2026

## Outcome

All six stages passed. The application held 10,000 **simultaneously authenticated**
chat WebSockets for 180 seconds, with normal session heartbeats and active chat
traffic. No authentication failures, socket errors, unexpected disconnects, HTTP
errors or delivery timeouts were observed. This is an isolated chat capacity result,
**not a production HOSTKEY capacity certificate or a call/media capacity test**.

- Source: `e21d96041d19a91782b2a27539735b4c5dfca60b`.
- Successful CI run: https://github.com/GeraMall/FreeTalk/actions/runs/42520535965.
- Actual generator run: 20:32:02–20:40:12 UTC (23:32:02–23:40:12 Moscow), 8 min 11 sec.
- Raw report: `outputs/load/capacity-10000/capacity-10000.json` (also CI artifact).
- Three previous attempts stopped/cancelled during lab setup, **before any capacity
  result**: 42520113817, 42520242638, 42520365048. Fixed system utility PATH,
  PostgreSQL directory access and a bundle import-name collision. These were harness
  setup failures, not production outages or failed load stages.

## Resource and data model

The actual API source, PostgreSQL 16 and a loopback-only test reverse proxy shared
a cgroup capped at **2 CPU cores of time / 4 GiB RAM / no swap**. PostgreSQL shared
buffers: 128 MiB, max connections: 100; the API's normal 12-connection pool and rate
limits remained unchanged. Workspace TS was bundled for Node 22; no tsx runtime.

The generator ran outside the application cgroup, on the same disposable CI VM
(4 CPUs, AMD EPYC 7763, ~16 GiB host memory). Its peak event-loop P99 was 40.4 ms;
peak sampled generator CPU was 146% of one core. The test environment was stopped
successfully by the workflow cleanup step. No live user credentials/data were used.

Fixtures: 10,000 verified synthetic accounts/sessions, 1,000 groups of 10, 20,000
existing text messages. 10% of online users send/read once per 30 seconds; chat
lists load at half that rate. At 10,000 online this is ~83.3 HTTP requests/sec,
including 33.3 new messages/sec. A send succeeds only when its message also reaches
every currently online member of its group. Password login/registration is excluded.

## Measurements

| Online |    Hold | HTTP requests | HTTP P95 | Fanout to all 10, P95 | Peak combined RAM |
| -----: | ------: | ------------: | -------: | --------------------: | ----------------: |
|    100 |  30 sec |            24 |  14.7 ms |               18.3 ms |           291 MiB |
|    500 |  30 sec |           126 |  15.2 ms |               15.6 ms |           301 MiB |
|  1,000 |  45 sec |           375 |  24.0 ms |               29.5 ms |           331 MiB |
|  2,500 |  45 sec |           937 |  48.6 ms |               51.0 ms |           398 MiB |
|  5,000 |  60 sec |         2,500 |  93.3 ms |              104.1 ms |           483 MiB |
| 10,000 | 180 sec |        15,000 | 201.2 ms |              214.8 ms |           678 MiB |

At 10,000: 9,000 successful GETs and 6,000 successful POSTs; HTTP P99 235.1 ms,
max 326.1 ms. Every stage began/ended with its full requested online count. Across
the whole run 7,585 message fanouts completed (75,850 recipient deliveries).
Authentication readiness P95: 145.1 ms; this includes a valid-session lookup, not
Argon2 password verification. Peak sampled combined CPU rate was approximately
69% of one core, or 34.5% of the two-core budget. This is a five-second-sample peak,
not a claim about instantaneous CPU consumption. No OOMs were observed.

## Interpretation and next validation

The result is evidence that the current chat API can handle this 10,000-online
workload in a small synthetic database without a language rewrite. The ceiling was
not reached; do not extrapolate a higher supported-user limit from this run.

The real VPS differs in CPU, storage, network and available memory. TLS/Caddy,
DDoS filtering, internet latency, synchronous HA replication, larger histories,
many chats/friends per account, file delivery, browser startup/rendering, voice,
video, TURN, future servers/bots and multi-hour soak/reconnect storms are excluded.
The CI result therefore does not certify 10,000 real production users or calls.
Before a large launch, repeat a representative workload on separate equivalent
infrastructure with TLS/HA and a larger social/history fixture, then test media and
long-duration recovery separately. Do not create load on the reserve or production
cluster without a specific monitored operation and recovery plan.

No production application, installer/feed, DNS, schema, HA settings or services were
changed or restarted for this test. Public release remains beta224.

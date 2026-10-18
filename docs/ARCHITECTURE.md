# PulseCheck architecture

PulseCheck monitors HTTP endpoints on a schedule, records every check, derives a
status per monitor, opens and resolves incidents, and exposes uptime and latency
analytics. This document explains how the pieces fit together and why the
important decisions were made.

- [1. Repository layout](#1-repository-layout)
- [2. Data model](#2-data-model)
- [3. Request path and API shape](#3-request-path-and-api-shape)
- [4. The monitoring engine](#4-the-monitoring-engine)
- [5. Status model and incidents](#5-status-model-and-incidents)
- [6. Uptime and latency calculations](#6-uptime-and-latency-calculations)
- [7. Configuration and environments](#7-configuration-and-environments)
- [8. Deployment](#8-deployment)
- [9. Known limitations and next steps](#9-known-limitations-and-next-steps)

## 1. Repository layout

npm workspaces monorepo. `packages/shared` is the reason the other two cannot
drift apart: the status rules, uptime maths, window definitions, limits and every
API DTO live there once and are imported by both the server and the web app.

```
.
├── packages/
│   ├── shared/                  # @pulsecheck/shared - no runtime dependencies except zod
│   │   ├── src/api.ts           # API DTOs and the error envelope
│   │   ├── src/limits.ts        # platform limits, forbidden header names
│   │   ├── src/monitor.ts       # zod schemas for monitor configuration
│   │   ├── src/status.ts        # MonitorStatus, error categories, transition rules
│   │   ├── src/uptime.ts        # computeUptime / aggregateUptime / percentile
│   │   ├── src/windows.ts       # time windows and chart bucketing
│   │   └── test/                # unit tests for the above (pure logic)
│   ├── server/                  # @pulsecheck/server - Express API + monitoring engine
│   │   ├── prisma/schema.prisma # data model and migrations
│   │   ├── scripts/             # embedded PostgreSQL manager for local dev
│   │   ├── src/app.ts           # Express app and middleware order
│   │   ├── src/index.ts         # process entry point (HTTP + monitoring + shutdown)
│   │   ├── src/env.ts           # validated environment configuration
│   │   ├── src/middleware/      # request id, bearer auth, rate limits, errors
│   │   ├── src/routes/          # auth, monitors, history, dashboard, meta, health
│   │   ├── src/services/        # user projection, monitor CRUD, mapping, statistics
│   │   ├── src/monitoring/      # ssrf, checker, worker, scheduler
│   │   └── test/                # unit + API integration + engine tests
│   └── web/                     # @pulsecheck/web - React SPA
│       └── src/                 # pages, components, api hooks, lib
├── docs/                        # this document, SECURITY.md, API.md
├── openapi.yaml                 # OpenAPI 3.1 contract
├── docker-compose.yml           # PostgreSQL + API + web deployment starter
└── .env.example                 # every supported variable, placeholders only
```

Dependency direction: `web → shared`, `server → shared`. The shared package
depends on `zod` only, so it can be consumed from a browser bundle without
pulling in Node code.

## 2. Data model

Four application tables (`packages/server/prisma/schema.prisma`) in `public`,
alongside Neon Auth's own tables (`neon_auth`: user, session, account,
verification, jwks, …) on the same branch. Every instant is `timestamptz(6)`,
every primary key is a UUID.

| Model         | Purpose                            | Notable columns / indexes                                                                  |
| ------------- | ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `User`        | Projection of a Neon Auth identity | `id` is the Neon Auth user id and the JWT `sub`; `email` unique; `created_at`/`updated_at` |
| `Monitor`     | Monitoring configuration + state   | `status` (column `current_status`), `next_check_at`, `lease_token`/`lease_expires_at`      |
| `CheckResult` | One attempted check                | `checked_at`, `success`, `http_status_code`, `response_time_ms`, `error_category`          |
| `Incident`    | One outage window                  | `started_at`, `resolved_at`, `initial_status`, `peak_status`, `failed_check_count`         |

The `User` row is created on the first authenticated request and exists only so
monitors and history can carry a foreign key. No password or session material is
stored in the application schema. Concurrent first requests from a freshly
signed-in client race to insert that row; the loser re-reads the row instead of
failing (`packages/server/src/services/auth-service.ts` — `resolveOrCreateUser`).

Indexes exist for the three hot paths: the scheduler's due-monitor scan
(`enabled, next_check_at`), a single monitor's history (`monitor_id, checked_at DESC`),
and retention pruning (`checked_at`).

A monitor's _configuration_ and its _observed state_ share one table. That keeps
the scheduler scan to a single index and guarantees a check cannot observe a
configuration that has already been replaced: the row is locked for the duration
of the write.

## 3. Request path and API shape

Middleware order in `src/app.ts` is deliberate:

```
request id → HTTP logging → helmet → CORS → JSON body (100 kB cap)
  → rate limit → bearer-token resolution → routes → 404 → error handler
```

- The versioned API lives under `/api/v1`. `/health/live` and `/health/ready` sit
  outside the versioned namespace and outside the API rate limiter, so an
  orchestrator's probes can never be throttled.
- The bearer token is resolved before routing. A well-formed
  `Authorization: Bearer <jwt>` is verified against Neon Auth's JWKS
  (`createRemoteJWKSet`, `algorithms: ['EdDSA']`, issuer and audience pinned to
  `new URL(NEON_AUTH_BASE_URL).origin`) and mapped to the local `User` row;
  `requireAuth` turns "no verified token" into a `401 UNAUTHENTICATED`. There is
  no CSRF step, because a browser never attaches a bearer header automatically:
  there is no ambient credential for a cross-site request to reuse. The CORS
  `allowedHeaders` are `content-type`, `authorization`, `x-request-id`.
- Errors are always `{ "error": { "code", "message", "details?", "requestId" } }`.
  Only `AppError` instances are exposed; anything else becomes a generic
  `INTERNAL_ERROR` so SQL, driver messages and stack traces never leak.
- Statistics are aggregated in PostgreSQL (`count(*) FILTER`, `percentile_cont`)
  and transferred as a handful of numbers. A 30-day window on a 30-second
  interval is ~86 000 rows; those must not cross the process boundary.

## 4. The monitoring engine

Three components, all in `src/monitoring/`:

```
scheduler.ts  decides which monitors are due and dispatches them
worker.ts     claims one monitor, runs the check, persists the outcome atomically
checker.ts    performs the HTTP request and classifies the result
ssrf.ts       decides whether an outbound request is allowed at all
```

### 4.1 Scheduling

`MonitorScheduler` is a lease-based loop, not in-memory state:

1. **Advisory lock.** On start it opens a dedicated `pg` connection and calls
   `pg_try_advisory_lock(1347375955)`. Exactly one process in a fleet can hold
   it. A process that cannot acquire it stays alive but dispatches nothing, and
   logs why. The lock is released on shutdown, so a replacement takes over
   automatically. Verified by tests that run a "leader" and a "follower"
   scheduler, stop the leader, and confirm the follower then dispatches.
2. **Row lease.** Before executing a check, the worker claims the monitor with a
   single atomic `updateMany` matching `lease_token IS NULL OR lease_expires_at < now`.
   Even if two schedulers ran, only one can win. An expired lease is reclaimable,
   so a crashed worker cannot stall a monitor forever.
3. **Non-overlapping ticks.** The loop awaits the current batch before starting
   the next one, and a re-entrant `tick()` returns immediately.
4. **Bounded concurrency.** A batch is processed by at most `CHECK_CONCURRENCY`
   runners, so an expiring fleet cannot open unbounded sockets.
5. **Jitter.** `next_check_at` is `completedAt + interval + 0-10% jitter`, so
   sixty-second monitors do not stampede the database or the target on each
   minute boundary.
6. **Single write transaction.** The check result, the derived status, the
   incident bookkeeping and the lease release are written in one transaction
   under `SELECT ... FOR UPDATE` on the monitor row. A crash cannot leave a
   result without its status change, and the lease is released on every path.

Retention runs opportunistically (at most hourly) and deletes old check results
in bounded batches of 5 000. Incidents are kept indefinitely: they are tiny and
they are the audit trail of an outage.

### 4.2 The check itself

- **Timing** uses `performance.now()` (monotonic), so a clock adjustment cannot
  produce a negative or absurd response time.
- **Redirects are followed manually.** `undici.request` never follows redirects
  on its own; each hop is re-validated by the SSRF policy before a new connection
  is made. 301/302 turn POST into GET, and 303 always does.
- **The response body is streamed with a byte cap** (`maxResponseBytes`). A
  declared `content-length` over the cap is rejected before reading a byte, and
  the stream itself is capped. An oversized response is a failure
  (`RESPONSE_TOO_LARGE`), not an out-of-memory event.
- **Failures are results, never exceptions.** A target-side problem is recorded
  as `success: false` with a categorized error, so one broken target cannot stop
  a batch.
- **Nothing from the target is stored** except the status code and a sanitized,
  500-character diagnostic. Response headers and bodies are never persisted or
  logged, and credentials in a URL are redacted from diagnostics.

### 4.3 Error categories

`DNS`, `CONNECT`, `TLS`, `TIMEOUT`, `TOO_MANY_REDIRECTS`, `RESPONSE_TOO_LARGE`,
`BLOCKED_DESTINATION`, `INVALID_URL`, `PROTOCOL`, `UNKNOWN`, `UNEXPECTED_STATUS`.

`UNEXPECTED_STATUS` is the only category that is produced _after_ a valid HTTP
response. The status model below relies on that distinction.

## 5. Status model and incidents

Defined once in `packages/shared/src/status.ts` and used by the worker, the API
and the UI.

| Status     | Meaning                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------ |
| `PENDING`  | The monitor exists; no check has completed yet                                             |
| `HEALTHY`  | The latest check matched every expectation and was within the latency budget               |
| `DEGRADED` | The target answered over HTTP but the response was wrong, or a correct answer was too slow |
| `DOWN`     | The request never produced a usable HTTP response                                          |
| `PAUSED`   | Monitoring is intentionally disabled                                                       |

`statusFromOutcome` precedence: transport failure → `DOWN`; HTTP received but
expectations failed → `DEGRADED`; success slower than `degradedResponseTimeMs` →
`DEGRADED`; otherwise `HEALTHY`. The latency comparison is strict (`>`), so a
check exactly at the threshold is still healthy.

Incident rules (also in `status.ts`, so the API and UI agree):

- an incident **opens** only on `HEALTHY|PENDING → DOWN|DEGRADED`;
- while failing, further failed checks **accumulate** into the same incident
  (`failed_check_count`, `peak_status` takes the more severe status, the latest
  error summary is kept) instead of opening a new one per check;
- an incident **resolves** only on `DOWN|DEGRADED → HEALTHY`;
- a `PAUSED` monitor never opens an incident, and **pausing resolves any open
  incident** with the summary "Monitoring paused by the account owner";
- a check that finishes after the monitor was paused is still recorded (it
  describes a request that really happened) but the monitor stays `PAUSED`;
- resuming sets the monitor back to `PENDING`: history is retained and the status
  is re-derived from the next completed check.

## 6. Uptime and latency calculations

Two different questions, deliberately not conflated:

- **`uptimePercent`** — checks that met expectations, over all checks. Answers
  "was the service meeting its contract?".
- **`availabilityPercent`** — checks that received _any_ HTTP response, over all
  checks. Answers "did the service answer at all?". A 500 counts against uptime
  but not against availability.

Honesty rules that the UI depends on:

- `uptimePercent`, `availabilityPercent`, `avgResponseTimeMs`, `minResponseTimeMs`,
  `maxResponseTimeMs` and `p95ResponseTimeMs` are **`null`** when the window
  contains no checks. A new account shows "no data yet", never `0%`.
- `0%` is reported only for a real window of failed checks.
- Monitors with no checks are **excluded** from the account-wide aggregation
  rather than counted as 0% or 100%.
- Negative and non-finite durations are clamped to `0` instead of poisoning an
  average.

Percentages are rounded to two decimals; latency aggregates to whole
milliseconds. Percentiles: PostgreSQL `percentile_cont` in the API (exact
interpolation over the window), nearest-rank in the shared helper used by tests
and the client. Both stay inside the observed range; the unit tests assert the
two implementations agree on every other aggregate and that both percentiles lie
within `[min, max]`.

Response-time series are bucketed to a **fixed** number of points per window
(60 for 1 h, 48 for 24 h, 56 for 7 d, 60 for 30 d) so charts have a stable shape
and an empty bucket is an explicit `null` rather than a zero.

## 7. Configuration and environments

One validated schema (`packages/server/src/env.ts`) parsed at startup: an invalid
or missing variable fails fast with a readable message instead of producing a
half-configured process. `.env.example` documents every variable with
placeholders only.

- **Development** — `.env` at the repository root (git-ignored), `NODE_ENV=development`,
  pretty logs, `LOG_LEVEL=debug` when needed. A local PostgreSQL cluster is
  available through `npm run db:up` (embedded-postgres, no Docker or system
  install required).
- **Test** — `NODE_ENV=test`, its own cluster on a separate port and data
  directory, `SCHEDULER_ENABLED=false`, and rate limits raised so tests measure
  behaviour rather than throttling.
- **Production** — `NODE_ENV=production`, JSON logs,
  `BLOCK_PRIVATE_NETWORKS=true`, and every connection string supplied through the
  environment.

Auth configuration is the Neon Auth URL pair — `NEON_AUTH_BASE_URL` and
`NEON_AUTH_JWKS_URL` for the server, `VITE_NEON_AUTH_URL` for the SPA. There is
no auth secret to manage, and registration policy is a Neon Auth branch setting
rather than an environment variable.

`DIRECT_URL` wins over `DATABASE_URL` when set, so migrations can bypass a
transaction pooler while the application uses the pooled connection. Empty
strings count as unset.

## 8. Deployment

`docker compose up --build` starts PostgreSQL, the API/worker and the web app;
only the web port is published to the host and the database is reachable only on
the compose network. See the README for the full procedure, including how to run
migrations exactly once per release.

Scaling model: the API is stateless; every replica connects to the same database.
The scheduler is safe to enable everywhere because the advisory lock elects one
dispatcher, and the row leases protect individual checks. Vertical scale of the
worker is bounded by `CHECK_CONCURRENCY` and the database connection pool.

## 9. Known limitations and next steps

- **Checks run in-process.** The API and the monitoring engine share a process
  and a connection pool. A separate worker fleet (with `SCHEDULER_ENABLED=false`
  on API replicas) is the natural next step and needs no schema change.
- **Single-region probing.** Every check originates from one deployment, so
  latency includes that deployment's distance to the target. Multi-region
  probing would add a probe identifier to `CheckResult`.
- **No notification delivery.** Incidents are recorded and displayed but no
  e-mail, webhook or Slack message is sent. The incident lifecycle is the hook
  a notifier would subscribe to.
- **No maintenance windows.** Incidents cannot be suppressed for planned work.
- **Retention is global.** `RETENTION_DAYS` applies to every account; per-plan
  retention would need the value on the account row.
- **Percentile method differs slightly** between the SQL aggregates and the
  shared helper, as documented in §6.
- **Encryption at rest** relies on the database host; request bodies and headers
  are stored as given (headers are never logged).

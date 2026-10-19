# PulseCheck

API monitoring platform. Sign in, add HTTP monitors, and PulseCheck runs real
scheduled health checks against those endpoints, persists every result in
PostgreSQL, and derives uptime, latency, history, and incident data from that
real check history.

No mock data. No simulated checks. A brand-new account sees honest empty states
and `null` uptime (never a fake `0%` or `100%`).

---

## What it does

- **Accounts** — sign-up, sign-in and sign-out are handled by Neon Auth
  (Managed Better Auth) on the same Neon branch as the database. The SPA holds a
  short-lived bearer JWT and the API only ever verifies it, so no password ever
  reaches application code.
- **Monitors** — full CRUD: create, edit, pause, resume, delete. Configure URL,
  method, headers, body, expected status codes, timeout, check interval, and a
  degraded-latency threshold.
- **Real checks** — a PostgreSQL-backed scheduler dispatches outbound HTTP
  requests on a jittered per-monitor schedule and a bounded worker pool runs
  them, records status code, latency, error category, and response size.
- **Analytics** — uptime percentage, average / p95 latency, and response-time
  series computed from persisted check results over selectable windows.
- **Status transitions and incidents** — a monitor moves between `HEALTHY`,
  `DEGRADED`, `DOWN`, and `PENDING`; incidents open on transitions into
  `DEGRADED`/`DOWN` and resolve on return to `HEALTHY`.
- **Dashboard** — aggregate health across all monitors, derived entirely from
  real check history.

---

## Verified state

Everything below was executed on this repository in a local (macOS) environment.

| Check                                                                                                           | Result                            |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `npm run format:check`                                                                                          | pass (all matched files)          |
| `npm run lint`                                                                                                  | pass (no errors, no warnings)     |
| `npm run typecheck`                                                                                             | pass (shared, server, web)        |
| `npm run build`                                                                                                 | pass (shared, server, web)        |
| `npm test` (shared + server + web)                                                                              | **288 tests passed**              |
| Playwright smoke (live stack, chromium)                                                                         | **1 passed**                      |
| Production entry points (`dist/index.js`, `dist/worker.js`) started and health-checked against a local database | **pass** (see docs/DEPLOYMENT.md) |

Deployment configuration (`render.yaml`, `vercel.json`, `docs/DEPLOYMENT.md`) is
written but **not deployed** — the Render and Vercel dashboards require your
account. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the exact steps.

Live verification against the linked Neon branch (real Neon Auth, real Neon Postgres,
no mocks): a new account signed up through Neon Auth, `GET /api/v1/auth/me` verified the
EdDSA JWT through the JWKS and provisioned the local user row, a monitor was created,
the scheduler fetched `https://example.com/` and stored a `200` check result, the
dashboard derived its uptime from that row, unauthenticated and forged-token requests
answered 401, and a second account saw the first account's monitor as 404.

Test inventory (unit + integration, no external network required):

| Package              | Files | Tests |
| -------------------- | ----- | ----- |
| `@pulsecheck/shared` | 4     | 77    |
| `@pulsecheck/server` | 10    | 186   |
| `@pulsecheck/web`    | 5     | 25    |

Server suites: `api/auth` (17), `api/monitors` (36), `api/history` (12),
`api/dashboard` (7), `api/health` (4), `unit/ssrf` (37), `unit/checker` (34),
`unit/worker` (15), `unit/scheduler` (9), `unit/stats` (15).

Two things are **written but not executed**, because the build environment had
no Docker daemon: `docker-compose.yml` and the two `Dockerfile`s. See
[Production deployment](#production-deployment). The Playwright smoke test runs
only against a live API + Vite stack; it self-skips when `PLAYWRIGHT_BASE_URL`
is unset.

---

## Requirements

- **Node.js >= 20.11** (developed on Node 22).
- **PostgreSQL 16+.** For local development you do not need an installed
  PostgreSQL: `npm run db:up` boots an embedded server (see below).
- No Docker required for development.

---

## Quickstart

```bash
# 1. Install dependencies (npm workspaces: shared, server, web).
npm install

# 2. Link the project and provision Postgres + Neon Auth on the branch.
neon auth
neon init -y --org-id <org> --project-id <project> --branch production --services postgres,auth
neon deploy

# 3. Apply the committed migrations to the database.
npm run db:migrate:deploy

# 4. Start the API and the web app together.
npm run dev
```

`neon init` writes `neon.ts` (which declares `auth: true` and the branch policy)
and pulls `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_BRANCH`,
`NEON_AUTH_BASE_URL` and `NEON_AUTH_JWKS_URL` into the repository-root `.env`.
Set `DIRECT_URL` to the unpooled value, and add `VITE_NEON_AUTH_URL` (the same
value as `NEON_AUTH_BASE_URL`) for the browser bundle — Vite reads the
repository-root `.env` as its `envDir`.

- Web app: <http://localhost:5273>
- API: <http://localhost:4100> (the Vite dev server proxies `/api` and `/health`
  to it)

Open the web app, create an account, and add a monitor. Registration policy —
open or closed sign-ups, email verification, trusted origins — is a Neon Auth
branch setting rather than an environment variable. Use `neon neon-auth domain
add https://app.example.com` to allow an origin; `localhost` origins are allowed
by default, which is what the Vite dev server on <http://localhost:5273> relies
on.

### Ports

| Service                    | Port  | Where it is configured                                          |
| -------------------------- | ----- | --------------------------------------------------------------- |
| API                        | 4100  | `PORT` in `.env`, `API_TARGET` in `packages/web/vite.config.ts` |
| Web dev server             | 5273  | `strictPort` in `packages/web/vite.config.ts`                   |
| Dev PostgreSQL (embedded)  | 55432 | `EMBEDDED_PG_PORT` in `.env`                                    |
| Test PostgreSQL (embedded) | 55433 | `packages/server/vitest.config.ts`                              |

---

## Local PostgreSQL

Two options:

**Embedded (zero install, development and CI).** `npm run db:up` downloads and
starts a private PostgreSQL instance under `.pgdata/` on port 55432, using the
`EMBEDDED_PG_*` values from `.env`. It is managed with:

```bash
npm run db:up       # start
npm run db:status   # inspect
npm run db:down     # stop (data is preserved in .pgdata/)
```

`.pgdata/` and `.pgdata-test/` are git-ignored. This is a development
convenience only — production always points `DATABASE_URL` at a real Neon
Postgres database.

**A Neon database.** Point `DATABASE_URL` at the pooled connection string and
`DIRECT_URL` at the unpooled one, for example:

```env
DATABASE_URL=postgresql://user:password@ep-example-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
DIRECT_URL=postgresql://user:password@ep-example.us-east-2.aws.neon.tech/neondb?sslmode=require
```

`neon init` fills both, plus `DATABASE_URL_UNPOOLED`, `NEON_BRANCH`,
`NEON_AUTH_BASE_URL` and `NEON_AUTH_JWKS_URL`. Application traffic uses the
pooled `DATABASE_URL`; migrations and anything needing session state use the
direct `DIRECT_URL`, which `packages/server/prisma.config.ts` prefers when set.

---

## Database migrations

Prisma 7 is configured through `packages/server/prisma.config.ts`; the client is
generated into `packages/server/src/generated/prisma` (git-ignored, and
regenerated by the server `prebuild`/`pretypecheck` hooks).

```bash
npm run db:generate        # regenerate the Prisma client (no DB needed)

# Development: create + apply a migration from schema changes.
npm run db:migrate -w @pulsecheck/server

# Any environment (including production): apply committed migrations only.
npm run db:migrate:deploy

npm run db:seed            # optional demo seed data
```

Committed migrations live in `packages/server/prisma/migrations/`
(`20261018113202_init`). Always apply migrations with `migrate deploy` in
production — never `migrate dev`.

---

## Commands

Run from the repository root.

| Command                | What it does                                        |
| ---------------------- | --------------------------------------------------- |
| `npm run dev`          | API + web dev servers together                      |
| `npm run dev:server`   | API and worker only (`tsx watch`)                   |
| `npm run dev:web`      | Vite dev server only                                |
| `npm run build`        | Production build of shared, server, and web         |
| `npm run typecheck`    | TypeScript check across all workspaces              |
| `npm run lint`         | ESLint (flat config) across the repository          |
| `npm run format`       | Prettier write                                      |
| `npm run format:check` | Prettier check (CI gate)                            |
| `npm test`             | Unit + integration tests for all workspaces         |
| `npm run test:e2e`     | Playwright smoke (requires a live stack, see below) |
| `npm run db:up`        | Start the embedded development database             |
| `npm run db:down`      | Stop the embedded development database              |
| `npm run db:migrate`   | Create + apply a migration (development)            |
| `npm run db:generate`  | Regenerate the Prisma client                        |
| `npm run db:seed`      | Seed demo data                                      |

Package-specific scripts are available with `-w @pulsecheck/<name>`.

---

## Testing

```bash
npm test
```

Server tests start their own embedded PostgreSQL cluster (port 55433, database
`pulsecheck_test`), run `prisma migrate deploy` against it, and shut it down
afterwards. If a cluster is already running on that port it is reused. Tests run
serially (`fileParallelism: false`) because they share that database.

Tests never require outbound internet access: SSRF coverage asserts on address
classification and validation behavior (metadata IPs, forbidden ports,
credentials in URLs, private ranges) rather than making real requests.

### End-to-end smoke test

The smoke test registers an account, creates a monitor, and confirms it appears
in the list. It needs a running API, a running web dev server, and a browser:

```bash
npx playwright install chromium      # once

# In separate terminals:
npm run db:up
npm run dev:server
npm run dev:web

# Then:
PLAYWRIGHT_BASE_URL=http://localhost:5273 npm run test:e2e
```

Without `PLAYWRIGHT_BASE_URL` the spec reports as skipped rather than pretending
to pass.

---

## Production deployment

### Docker Compose

`docker-compose.yml` defines three services:

- `postgres` — PostgreSQL 17 with a named volume and a `pg_isready` healthcheck,
  not published to the host.
- `api` — the API plus the in-process scheduler and worker, built from
  `packages/server/Dockerfile`, with a `/health/ready` healthcheck. Only this
  service and `postgres` are exposed inside the compose network.
- `web` — the built SPA served by nginx, the only service published to the host
  (`WEB_PORT`, default 8080).

```bash
export POSTGRES_PASSWORD="a-strong-password"

docker compose up --build            # apply migrations on start (RUN_MIGRATIONS=true)
# or, with multiple API replicas:
docker compose run --rm api migrate
docker compose up
```

The `api` container runs the scheduler and the worker in-process. The scheduler
holds a PostgreSQL advisory lock, so running more than one `api` replica is safe:
exactly one dispatches checks. With more than one replica, set
`RUN_MIGRATIONS=false` and run `docker compose run --rm api migrate` explicitly.

> **Not verified in this environment.** No Docker daemon was available while
> building this project, so the compose file and both Dockerfiles were written
> but never built or started. Treat them as a reviewed starting point and
> validate them against your own infrastructure.

Production configuration notes:

- All configuration is environment-driven; database and Neon Auth connection
  strings never live in the repository. `.env` is git-ignored and `.env.example`
  contains placeholders only.
- Set `NODE_ENV=production`, `TRUST_PROXY=true` behind a reverse proxy, and
  `LOG_PRETTY=false` for structured JSON logs. There is no auth secret to
  manage: Neon Auth owns credentials and signs the JWTs the API verifies.
- Keep `BLOCK_PRIVATE_NETWORKS=true`. Only ever disable it inside an isolated
  test environment.
- The web image builds the SPA and serves it with nginx (`packages/web/nginx.conf`),
  which proxies `/api` and `/health` to the API.

### Render + Vercel (recommended)

The recommended production target is **Render** for the backend and database and
**Vercel** for the frontend. Full guide: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

- `render.yaml` — Render Blueprint: `pulsecheck-api` (web service),
  `pulsecheck-worker` (background worker, the only scheduler), `pulsecheck-db`
  (PostgreSQL). Deploy via **Render Dashboard → New → Blueprint**.
- `vercel.json` — SPA rewrite so refreshing a nested route does not 404.
- Vercel build: `npm run build` from the repo root, output `packages/web/dist`.

You must still set in the dashboards: `WEB_ORIGIN` (your Vercel URL) and the Neon
Auth URLs on both Render services, `VITE_API_BASE_URL` + `VITE_NEON_AUTH_URL` in
Vercel, add the Vercel origin to Neon Auth's trusted domains, and confirm the
Render instance plans (free tiers sleep or expire — see the deployment guide).

---

## API documentation

- **`openapi.yaml`** — the machine-readable OpenAPI 3.1 contract for every
  endpoint.
- **`docs/API.md`** — a written reference with request/response examples,
  pagination, and error codes.

Endpoints beyond the core spec that were added for completeness:

- `GET /api/v1/incidents` — account-wide incident list.
- `GET /api/v1/meta/limits` — public limits and defaults.
- `GET /api/v1/monitors/meta/methods` — supported HTTP methods.

Health: `GET /health/live` (process liveness) and `GET /health/ready` (checks
PostgreSQL; returns `503` when the database is unreachable).

The only auth route is `GET /api/v1/auth/me`; `POST /auth/register`,
`POST /auth/login` and `POST /auth/logout` no longer exist and answer `404`.
Public, unauthenticated endpoints are `GET /health/live`, `GET /health/ready`,
`GET /api/v1/meta/limits` and the root `GET /`. Everything else under `/api/v1`
requires the bearer token.

---

## Architecture

See **`docs/ARCHITECTURE.md`** for the full picture. Summary:

- **Monorepo** — npm workspaces: `packages/shared` (Zod schemas, status/uptime
  and window logic, API DTOs, shared by server and web), `packages/server`
  (Express + Prisma + scheduler + worker), `packages/web` (React + Vite).
- **Scheduling model** — each monitor row has a `nextCheckAt`. The scheduler
  takes a PostgreSQL advisory lock (`pg_try_advisory_lock`), claims due monitors
  with a per-row lease, and dispatches them to a bounded worker pool. Claiming
  uses `SELECT ... FOR UPDATE` inside the recording transaction, so results,
  status transitions, and incident changes commit atomically. `nextCheckAt` is
  jittered to avoid thundering herds, and old results are pruned under a bounded
  retention policy.
- **Uptime and transitions** — a correct response faster than the degraded
  threshold is `HEALTHY`; a correct but slow response is `DEGRADED`; a wrong but
  reachable status is `DEGRADED`; connection failures, timeouts, and other
  errors are `DOWN`. Uptime is `healthy results / total results` over the window,
  and is `null` (not `0%`) when there is no history. See `packages/shared/src/uptime.ts`
  and `packages/shared/src/status.ts`.

## Security

See **`docs/SECURITY.md`**. Highlights:

- **SSRF defense** — outbound checks refuse loopback, private, link-local
  (including cloud metadata at `169.254.169.254`), unique-local, and other
  non-routable ranges; hostnames are resolved and validated, redirect targets are
  revalidated, and forbidden ports and credentials-in-URL are rejected.
- **Auth** — Neon Auth (Managed Better Auth) owns credentials and sessions; the
  SPA calls it directly and the API only verifies the short-lived EdDSA bearer
  JWT against Neon Auth's JWKS. There are no cookies, no server-side sessions and
  no CSRF tokens: a bearer header is never attached automatically, so no ambient
  credential exists for a cross-site request to ride.
- **Authorization** — every monitor, result, and incident access enforces
  ownership.
- **Secrets** — supplied through environment variables only; never returned in
  API responses and never logged.

---

## Repository structure

```
.
├── packages/
│   ├── shared/        # Zod schemas, status/uptime/window logic, API DTOs
│   ├── server/        # Express API, Prisma schema + migrations, scheduler, worker
│   │   ├── prisma/    # schema.prisma, migrations/, seed
│   │   ├── scripts/   # embedded-pg.ts (dev/test database manager)
│   │   ├── src/       # routes, services, monitoring engine, generated client
│   │   └── test/      # api/, unit/, helpers/, global-setup
│   └── web/           # React + Vite SPA (screens, hooks, components, e2e)
├── docs/              # ARCHITECTURE.md, SECURITY.md, API.md
├── docker-compose.yml # postgres + api + web (written, not executed)
├── openapi.yaml       # OpenAPI 3.1 contract
├── .env.example       # placeholders only
└── INSTRUCTIONS.md    # the specification this project implements
```

---

## Known limitations and future improvements

- **Docker deployment is unverified** — see the note above.
- **Single-process worker** — the worker pool is in-process; a dedicated worker
  service or queue would scale checks further.
- **Retention** is a fixed-day window rather than tiered rollups; long-range
  analytics would benefit from pre-aggregated daily buckets.
- **No multi-user organizations or teams** — monitors are owned by a single
  account.
- **Notifications** (email / webhook / Slack) on incidents are not implemented;
  incidents are stored and displayed but do not page anyone.
- **No 2FA / OAuth** — the Neon Auth branch is used for email + password only.
- **Web bundle** is a single ~1 MB chunk; route-level code splitting would trim
  the initial load.
- **The scheduler is advisory-lock-guarded but not leader-elected with
  heartbeats**; a crashed scheduler's lease expires and another replica takes
  over, which is adequate but not instant.

Commit history: this repository is currently uncommitted by request.

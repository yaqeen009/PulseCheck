# Production deployment guide

PulseCheck deploys as three services: a **React SPA on Vercel**, an **Express
API web service on Render**, and a **monitoring worker on Render**. Neon Auth
(Managed Better Auth) stays on Neon and is configured once; nothing about it is
provisioned by this guide.

All configuration below is repository state. Anything marked **you must do** is
a dashboard action — no Render/Vercel credentials are available to the
repository, so no live service was created or modified.

## 0. What is already done vs. what you must do

Completed and verified in the repository:

- `render.yaml` blueprint for the API web service, the monitoring worker and PostgreSQL.
- `vercel.json` SPA rewrite for nested routes.
- `VITE_API_BASE_URL` support, inlined at build time (build verified with and without it).
- Standalone worker entry (`dist/worker.js`) sharing the API's graceful-shutdown code.
- `Cache-Control: no-store` on every `/api/v1` response.
- Startup guard: a production process refuses a localhost `WEB_ORIGIN`.
- `.env.example` documents every variable; `.env` remains untracked.

You must do in the dashboards:

1. Create the Render Blueprint (or the three services manually) and fill the `sync: false` variables.
2. Create the Vercel project, set `VITE_API_BASE_URL` and `VITE_NEON_AUTH_URL`, and deploy.
3. Add the Vercel origin to Neon Auth's trusted domains.
4. Confirm instance plans: the background worker needs a paid plan and free PostgreSQL expires after 30 days.

---

## 1. Architecture

```
                    ┌─────────────────────────┐
   browser  ───────▶│  Vercel (packages/web)  │  static SPA
                    └───────────┬─────────────┘
                                │ Authorization: Bearer <Neon Auth JWT>
                                │ (VITE_API_BASE_URL, https only)
                                ▼
   Render proxy ──▶┌─────────────────────────┐
                    │  pulsecheck-api (web)  │  Express, no scheduler
                    │  GET /health/live      │
                    │  GET /health/ready     │  ──┐
                    └───────────┬─────────────┘   │ same DB
                                │                 │
                                ▼                 ▼
                    ┌─────────────────────────────────────┐
                    │  Render PostgreSQL (pulsecheck-db)  │
                    │  users, monitors, check_results,    │
                    │  incidents                          │
                    └───────────┬─────────────────────────┘
                                │ advisory lock + row leases
                                ▼
                    ┌─────────────────────────┐
                    │ pulsecheck-worker (bg)  │  the only scheduler
                    └─────────────────────────┘

   Neon Auth (Managed Better Auth) — separate service on Neon, talks to the
   browser directly; the API only verifies its EdDSA JWTs against the JWKS.
```

Why this shape:

- **One scheduler, deployed separately.** Checks must keep running while the API
  redeploys or is idle. The API service runs with `SCHEDULER_ENABLED=false`; the
  `pulsecheck-worker` background service runs `dist/worker.js`, which starts only
  the scheduling engine. Even if two schedulers ever ran, a PostgreSQL advisory
  lock admits exactly one dispatcher and every check claims a row lease, so no
  check executes twice.
- **The API is stateless.** Any instance can die at any time; state lives in
  PostgreSQL. Horizontal scaling of the API is safe (one advisory lock winner).

## 2. Render services

| Service             | Type              | Compute plan | Start command                         |
| ------------------- | ----------------- | ------------ | ------------------------------------- |
| `pulsecheck-api`    | web               | `0.5c-512mb` | `node packages/server/dist/index.js`  |
| `pulsecheck-worker` | background worker | `0.5c-512mb` | `node packages/server/dist/worker.js` |
| `pulsecheck-db`     | PostgreSQL        | `free`       | managed                               |

All three are described in [`render.yaml`](../render.yaml) (Render Blueprint).
Using the Blueprint is the fastest path: **Render Dashboard → New → Blueprint
Repo** and pick this repository.

Plan notes (checked against Render's Blueprint reference and free-tier page):

- Free **web** services spin down after 15 idle minutes and cold-start on the
  next request. That is acceptable here because the dedicated worker runs the
  scheduler; a paid plan (`0.5c-512mb`) removes the cold start.
- Free **background workers** do not exist; the worker needs a paid compute
  plan. `0.5c-512mb` is the cheapest option in the Blueprint reference.
- Free **PostgreSQL** expires **30 days** after creation, is capped at 1 GB,
  has no backups or managed pooling, and only one free instance is allowed per
  workspace. Use a paid plan for production data.

## 3. Vercel project settings

The frontend builds from the repository root (npm workspaces); there is no need
to set a Root Directory.

| Setting          | Value                                                          |
| ---------------- | -------------------------------------------------------------- |
| Framework Preset | Other (no preset needed; the output directory is set manually) |
| Install Command  | `npm install` (default)                                        |
| Build Command    | `npm run build -w @pulsecheck/web` (or `npm run build`)        |
| Output Directory | `packages/web/dist`                                            |
| Root Directory   | _(leave empty)_                                                |

`vercel.json` (already in the repo) rewrites every path to `index.html`, so
refreshing a nested route (`/monitors/123`) serves the SPA instead of a 404.

## 4. Build and start commands

Root scripts (npm workspaces, lockfile-driven):

```bash
npm install          # install all workspaces
npm run build        # shared -> server (tsc) -> web (vite); also runs prisma generate
npm start            # node packages/server/dist/index.js        (web service)
npm run worker       # node packages/server/dist/worker.js       (background worker)
```

Render's Build Command is `npm run build` for both Node services; it compiles
TypeScript and generates the Prisma client (`prebuild` hook) in one step.

## 5. Environment variables

Real environment variables always win over `.env` (the app loads `.env` with
`dotenv` without overwriting), so Render/Vercel values override the local file.

### Vercel (frontend build-time, public — safe to expose in the bundle)

| Variable             | Value                                 | Notes                                                                |
| -------------------- | ------------------------------------- | -------------------------------------------------------------------- |
| `VITE_API_BASE_URL`  | `https://pulsecheck-api.onrender.com` | Must be **https** (mixed content). Empty in dev → same-origin proxy. |
| `VITE_NEON_AUTH_URL` | Neon Auth branch URL                  | Public by design; the SPA talks to Neon Auth directly.               |

**Never put server secrets in `VITE_*` variables** — Vite inlines them into the
browser bundle.

### Render — `pulsecheck-api` (runtime)

| Variable                 | Value                           | Notes                                                                                              |
| ------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------- |
| `NODE_ENV`               | `production`                    | Pino JSON logs, no stack traces, no pretty printing                                                |
| `DATABASE_URL`           | from `pulsecheck-db`            | Render injects the connection string                                                               |
| `WEB_ORIGIN`             | `https://<your-app>.vercel.app` | The **only** origin allowed to call the API (CORS). Add extra origins to `CORS_ORIGINS` if needed  |
| `SCHEDULER_ENABLED`      | `false`                         | The worker owns scheduling                                                                         |
| `WORKER_ENABLED`         | `true`                          | Checks execute (on the worker)                                                                     |
| `TRUST_PROXY`            | `true`                          | Render terminates TLS in front of the service; one proxy hop so rate limiting sees real client IPs |
| `NEON_AUTH_BASE_URL`     | Neon Auth branch URL            | JWT issuer verification                                                                            |
| `NEON_AUTH_JWKS_URL`     | Neon Auth JWKS URL              | Defaults to `<base>/.well-known/jwks.json` if unset                                                |
| `BLOCK_PRIVATE_NETWORKS` | `true`                          | SSRF guard — never disable in production                                                           |
| `LOG_LEVEL`              | `info`                          | Optional                                                                                           |
| `LOG_PRETTY`             | `false`                         | Structured JSON logs for Render log inspection                                                     |

### Render — `pulsecheck-worker` (runtime)

Same as the API except `SCHEDULER_ENABLED=true` and no `WEB_ORIGIN`/CORS needs.

### Local development (`.env`, git-ignored)

`cp .env.example .env`. With Neon linked, `.env` already contains
`DATABASE_URL`, `DIRECT_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL` and
`VITE_NEON_AUTH_URL`. Add `VITE_API_BASE_URL=` (empty) for the dev proxy.
`npm run dev` runs API + web together; the API process runs the scheduler
(`SCHEDULER_ENABLED=true` by default), so no separate worker is needed locally.

## 6. Database provisioning and migrations

Provision the database through the Blueprint, or manually:
**Render Dashboard → New → PostgreSQL** → create `pulsecheck-db` → copy the
**Internal Connection String** into the `pulsecheck-api` service env var
`DATABASE_URL` (Render Blueprint does this automatically via `fromDatabase`).

Migrations are committed under `packages/server/prisma/migrations/` and applied
with Prisma's expand-only `migrate deploy` (never `db push`, never a reset):

```bash
npm run db:migrate:deploy        # == prisma migrate deploy, via DIRECT_URL || DATABASE_URL
```

- The Blueprint runs this as the API service's **preDeploy command**, once per
  deploy, before the new release goes live — never concurrently from instances.
- Apply schema changes the **expand/contract** way: deploy additive migrations
  with the old code first, then the new code, so a rolling deploy never breaks.
- The migrations are non-destructive. **Never** reset or drop the production
  database.

## 7. Worker configuration and scheduling behaviour

- Start command: `node packages/server/dist/worker.js` (`npm run worker`).
- The worker runs no HTTP listener; Render shows it as a background service.
- `GET /health/live`/`/health/ready` are on the API service only.
- Duplicate execution is impossible: the advisory lock
  (`pg_try_advisory_lock(1347375955)`) elects one dispatcher fleet-wide; each
  check also claims a per-monitor row lease with an expiry, so a crashed worker
  loses its lease and the monitor is retried after `leaseExpiresAt`.
- Ticks never overlap within a process; a batch runs with bounded concurrency
  (`CHECK_CONCURRENCY`, default 8).
- Graceful shutdown: on SIGTERM the worker stops the timer, waits up to 15 s for
  in-flight checks, then releases the advisory lock and closes the pool.
- Transient failures (DNS, connect, TLS, timeout, 5xx, …) are recorded as
  failed check results and retried on the next tick — they never crash the loop.
- If you ever prefer to skip the worker service, set `SCHEDULER_ENABLED=true`
  on the API instead (the advisory lock keeps it correct), but then the API
  service must never scale past one instance and free-tier sleep stops checks.

## 8. CORS and authentication

- Auth is **bearer-JWT only** — no cookies, no sessions, no CSRF. The browser
  cannot attach an `Authorization` header cross-site, so there is no ambient
  credential to abuse.
- CORS allows exactly one origin: `WEB_ORIGIN` (your Vercel URL), plus optional
  `CORS_ORIGINS`. No wildcards. `credentials: true` is safe because the origin
  list is explicit.
- Neon Auth must trust the Vercel origin too, or sign-in/sign-up requests are
  blocked by the browser: `neon neon-auth domain add https://<your-app>.vercel.app`
  (or add it in the Neon console under the branch's Auth settings). Localhost
  origins are allowed by default.
- All browser→API traffic is https; `VITE_API_BASE_URL` must be https to avoid
  mixed-content blocks.

## 9. Health checks and verification

| Check     | URL                                                | Expect                                                                        |
| --------- | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| Liveness  | `https://pulsecheck-api.onrender.com/health/live`  | `200 {"status":"ok",...}`                                                     |
| Readiness | `https://pulsecheck-api.onrender.com/health/ready` | `200` with `"checks":{"database":"ok"}` — `503` while Postgres is unreachable |
| API root  | `https://pulsecheck-api.onrender.com/`             | `200 {"name":"PulseCheck API",...}`                                           |

Render's health check path is `/health/ready`. After deploying:

1. `curl` the three URLs above.
2. Confirm Render logs show `PulseCheck API listening` and
   `PulseCheck worker started`.
3. Sign up in the Vercel app, create a monitor, and confirm a `check_results`
   row appears within one interval (Render → `pulsecheck-db` → `check_results`,
   or watch the app UI).
4. Confirm no `Access-Control-Allow-Origin: *` appears in API responses.

## 10. Troubleshooting

| Symptom                                                | Likely cause                                           | Fix                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Vercel app loads but API calls fail with CORS error    | `WEB_ORIGIN` missing or wrong on `pulsecheck-api`      | Set it to the exact Vercel origin (no trailing slash)                                    |
| Sign-in/sign-up blocked (CORS to Neon Auth)            | Vercel origin not trusted by Neon Auth                 | `neon neon-auth domain add https://<your-app>.vercel.app`                                |
| API 502 on every request                               | Service crashed at boot                                | Check Render logs for `Invalid environment configuration` — missing/typo'd env var       |
| `/health/ready` 503                                    | `DATABASE_URL` wrong or DB unreachable                 | Verify the internal connection string; confirm the DB service is in the same region      |
| Checks never run                                       | Worker service down / not deployed                     | Confirm `pulsecheck-worker` is running; its logs should show `monitor scheduler started` |
| `another PulseCheck scheduler holds the advisory lock` | Two schedulers running (expected warning on the loser) | Keep `SCHEDULER_ENABLED=false` on the API                                                |
| Rate limiting triggers behind Render proxy             | `TRUST_PROXY` not set                                  | Set `TRUST_PROXY=true` on the API service                                                |
| Login page shows "Could not load registration policy"  | `VITE_API_BASE_URL` wrong or API unreachable           | Set the exact Render API URL (https) in Vercel                                           |
| Old page after deploy                                  | Browser cached SPA                                     | Vercel sets long-lived caching only on hashed `/assets`; hard-refresh                    |

## 11. Known limitations

- **Neon Auth is not provisioned here.** It stays on Neon; the API only needs its
  URLs. Neon's own branch/database lifecycle is managed in the Neon console.
- **Render free web tier sleeps** after 15 idle minutes; the worker is paid-tier
  regardless. Use a paid compute plan on the API to avoid cold starts.
- **Render PostgreSQL free tier expires after 30 days** and is capped at 1 GB
  with no backups — use a paid plan for production.
- **`docker-compose.yml` and the two `Dockerfiles` are unexecuted** (no Docker
  daemon available) and are not part of the Render/Vercel path.
- **Neon Auth JWTs expire after 15 minutes**; the client refreshes and retries
  once on 401. Verified for the sign-in race; idle-tab expiry follows the same
  path.

# PulseCheck API guide

The machine-readable contract is [`openapi.yaml`](../openapi.yaml). This page is
the walkthrough: how to authenticate, what the endpoints return, and the
behaviours that are easy to get wrong.

- [Base URL and conventions](#base-url-and-conventions)
- [Authentication](#authentication)
- [Errors](#errors)
- [Monitors](#monitors)
- [History, analytics and incidents](#history-analytics-and-incidents)
- [Dashboard](#dashboard)
- [Meta and health](#meta-and-health)
- [Complete endpoint list](#complete-endpoint-list)

## Base URL and conventions

- All application endpoints live under `/api/v1`; health probes are at `/health/*`.
- Everything is JSON. Request bodies are capped at 100 kB.
- All timestamps are ISO-8601 UTC strings with milliseconds.
- Ids are UUIDs. A non-UUID path parameter is a `400`, not a `404`.

## Authentication

Bearer tokens, not session cookies. Sign-up, sign-in and sign-out happen in the
SPA against Neon Auth (Managed Better Auth); the API never sees a password.

```bash
# 1. Sign in through the SPA, then copy the short-lived JWT it holds for the
#    Neon Auth session (or call Neon Auth directly) into a shell variable.
TOKEN=<jwt>

# 2. Send it on every request to the API:
curl -i http://localhost:4100/api/v1/auth/me \
  -H "authorization: Bearer $TOKEN"
```

- The JWT is EdDSA (Ed25519), issued by Neon Auth, valid 15 minutes, with `sub`
  (the Neon Auth user id), `email`, `name` and `emailVerified` claims. `iss` and
  `aud` are both the origin of the Auth URL.
- The API verifies the signature against Neon Auth's JWKS and pins the
  issuer/audience, so a token minted elsewhere is rejected.
- A missing or invalid token on a protected route returns `401 UNAUTHENTICATED`.

```json
{
  "user": {
    "id": "…",
    "email": "ops@example.com",
    "createdAt": "2026-10-18T11:00:00.000Z"
  }
}
```

There is **no CSRF step**: a browser never attaches an `Authorization` header on
its own, so no ambient credential exists for a cross-site request to reuse.

`POST /api/v1/auth/register`, `POST /api/v1/auth/login` and
`POST /api/v1/auth/logout` no longer exist and answer `404 NOT_FOUND`; Neon Auth
owns those flows. The only auth route here is `GET /api/v1/auth/me`, which
returns the caller's local projection of the Neon Auth identity.

## Errors

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": {
      "issues": [{ "path": "body", "message": "A request body is not supported for GET requests" }]
    },
    "requestId": "3f9c1c8e-…"
  }
}
```

| Code                  | HTTP | Meaning                                                      |
| --------------------- | ---- | ------------------------------------------------------------ |
| `VALIDATION_ERROR`    | 400  | Body/query/path failed validation; see `details.issues`      |
| `UNAUTHENTICATED`     | 401  | Missing or invalid bearer token                              |
| `FORBIDDEN`           | 403  | Reserved for policy refusals (ownership uses 404)            |
| `NOT_FOUND`           | 404  | Missing **or** owned by another account; also removed routes |
| `CONFLICT`            | 409  | A patch that makes the merged config invalid                 |
| `LIMIT_EXCEEDED`      | 409  | Monitor limit for the account reached                        |
| `PAYLOAD_TOO_LARGE`   | 413  | Body over the 100 kB parser cap                              |
| `RATE_LIMITED`        | 429  | Too many requests                                            |
| `INTERNAL_ERROR`      | 500  | Unexpected fault; the details stay in the server logs        |
| `SERVICE_UNAVAILABLE` | 503  | A dependency is down (see `/health/ready`)                   |

## Monitors

Create (`POST /api/v1/monitors`) — only `name` and `url` are required:

```bash
curl -i -X POST http://localhost:4100/api/v1/monitors \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"Public API","url":"https://example.com/health","intervalSeconds":60}'
```

```json
{
  "name": "Public API",
  "url": "https://example.com/health",
  "method": "GET",
  "intervalSeconds": 60,
  "timeoutMs": 5000,
  "expectedStatusMin": 200,
  "expectedStatusMax": 299,
  "degradedResponseTimeMs": 1500,
  "headers": { "x-api-key": "…" },
  "body": null,
  "enabled": true
}
```

Rules worth knowing:

- `expectedStatusMin/Max` accept 100-599 and must not be inverted.
- A `body` is only allowed for `POST`, `PUT`, `PATCH`, `DELETE`.
- `degradedResponseTimeMs` cannot exceed `timeoutMs`.
- Header names must be valid RFC 7230 tokens; values must not contain CR/LF.
  Hop-by-hop and engine-managed names (`host`, `content-length`, `connection`,
  `cookie`, …) are refused.
- A new monitor is `PENDING` until its first check completes, or `PAUSED` when
  created with `"enabled": false`.
- A `url` pointing at a private, loopback, link-local or metadata address is
  accepted by validation but **blocked when the check runs**
  (`BLOCKED_DESTINATION`, status `DOWN`) - the SSRF policy is enforced at
  connect time, not only at configuration time.

Update (`PATCH /api/v1/monitors/{id}`) is a partial update:

- omitting a field leaves it untouched; `"body": null` clears the body;
- a patch that would make the **merged** configuration invalid is rejected with
  `409 CONFLICT`;
- changing the URL/method/headers/body, or re-enabling a paused monitor,
  schedules a check immediately instead of waiting out the old interval.

Pause and resume:

- `POST /api/v1/monitors/{id}/pause` → `PAUSED`, monitoring stops, and any open
  incident is resolved with the summary "Monitoring paused by the account owner".
- `POST /api/v1/monitors/{id}/resume` → `PENDING`, monitoring restarts now;
  history is retained.

Listing supports `search` (name or URL), `status` (`PENDING|HEALTHY|DEGRADED|DOWN|PAUSED|ALL`),
`sort` (`name|status|lastCheckedAt|createdAt`) and `order` (`asc|desc`).

## History, analytics and incidents

```bash
# Newest-first check history, optionally filtered by success
curl -H "authorization: Bearer $TOKEN" \
  'http://localhost:4100/api/v1/monitors/<id>/checks?page=1&pageSize=50&success=false'

# Uptime and latency aggregates for a window (1h | 24h | 7d | 30d, default 24h)
curl -H "authorization: Bearer $TOKEN" \
  'http://localhost:4100/api/v1/monitors/<id>/uptime?window=7d'

# Bucketed response-time series for charts
curl -H "authorization: Bearer $TOKEN" \
  'http://localhost:4100/api/v1/monitors/<id>/response-times?window=24h'

# Incidents for one monitor, or for the whole account
curl -H "authorization: Bearer $TOKEN" 'http://localhost:4100/api/v1/monitors/<id>/incidents?status=open'
curl -H "authorization: Bearer $TOKEN" 'http://localhost:4100/api/v1/incidents?status=resolved'
```

Reading the aggregates:

- `uptimePercent` = checks that **met expectations** / all checks.
- `availabilityPercent` = checks that **received any HTTP response** / all checks,
  so a 500 counts against uptime but not against availability.
- Both are `null` - never `0` - when the window contains no checks.
- `p95ResponseTimeMs` is `null` for an empty window.
- Response-time points are a fixed number of buckets per window (60 for `1h`,
  48 for `24h`, 56 for `7d`, 60 for `30d`); an empty bucket has `checks: 0` and
  `null` metrics, so a chart shows a gap rather than a dip to zero.

Status vocabulary: `PENDING`, `HEALTHY`, `DEGRADED` (HTTP answered but the
expectation failed, or a correct answer was too slow), `DOWN` (no usable HTTP
response), `PAUSED`. See [ARCHITECTURE.md §5](ARCHITECTURE.md#5-status-model-and-incidents)
for the incident rules.

An incident DTO is honest about its state: `ongoing: true` and `durationMs: null`
while it is open, `failedCheckCount` accumulates for the whole outage,
`peakStatus` keeps the most severe status seen, and `initialStatus` is the status
the monitor moved into when the incident opened.

## Dashboard

```bash
curl -H "authorization: Bearer $TOKEN" http://localhost:4100/api/v1/dashboard/summary
curl -H "authorization: Bearer $TOKEN" http://localhost:4100/api/v1/dashboard/recent-activity
```

`summary` returns monitor status counts, account-wide uptime for the last 24
hours, open incidents, incidents in the last 24 hours, a 24-hour check success
rate, and the five slowest monitors (only monitors with at least three checks in
the window). A brand-new account gets zeroes, `successRatePercent: null`,
`uptimePercent: null` and an empty `slowestMonitors` array - the UI renders an
empty state instead of a fake chart.

## Meta and health

```bash
curl http://localhost:4100/api/v1/meta/limits      # public
curl http://localhost:4100/health/live
curl http://localhost:4100/health/ready           # 503 when PostgreSQL is down
curl http://localhost:4100/                        # public: API banner, no auth
```

Public, unauthenticated endpoints are `GET /health/live`, `GET /health/ready`,
`GET /api/v1/meta/limits` and the root `GET /`. Everything else under `/api/v1`
requires the bearer token.

`GET /api/v1/meta/limits` returns the effective limits, form defaults, supported
time windows and bucket counts, so the web app never hardcodes a rule the server
would reject. It is public on purpose: validation messages render before login.

## Complete endpoint list

| Method   | Path                                   | Auth | Notes                                                 |
| -------- | -------------------------------------- | ---- | ----------------------------------------------------- |
| `GET`    | `/api/v1/auth/me`                      | ✔    | `{ user }` only; the local projection of the identity |
| `GET`    | `/api/v1/monitors`                     | ✔    | `search`, `status`, `sort`, `order`                   |
| `POST`   | `/api/v1/monitors`                     | ✔    | 201                                                   |
| `GET`    | `/api/v1/monitors/{id}`                | ✔    |                                                       |
| `PATCH`  | `/api/v1/monitors/{id}`                | ✔    | Partial; `409` if the merge is invalid                |
| `DELETE` | `/api/v1/monitors/{id}`                | ✔    | 204; cascades history and incidents                   |
| `POST`   | `/api/v1/monitors/{id}/pause`          | ✔    | Resolves open incidents                               |
| `POST`   | `/api/v1/monitors/{id}/resume`         | ✔    | Back to `PENDING`                                     |
| `GET`    | `/api/v1/monitors/meta/methods`        | ✔    | Supported HTTP methods for the form                   |
| `GET`    | `/api/v1/monitors/{id}/checks`         | ✔    | `page`, `pageSize`, `success`                         |
| `GET`    | `/api/v1/monitors/{id}/uptime`         | ✔    | `window`                                              |
| `GET`    | `/api/v1/monitors/{id}/response-times` | ✔    | `window`                                              |
| `GET`    | `/api/v1/monitors/{id}/incidents`      | ✔    | `page`, `pageSize`, `status`                          |
| `GET`    | `/api/v1/incidents`                    | ✔    | Account-wide, includes `monitorName`                  |
| `GET`    | `/api/v1/dashboard/summary`            | ✔    |                                                       |
| `GET`    | `/api/v1/dashboard/recent-activity`    | ✔    |                                                       |
| `GET`    | `/api/v1/meta/limits`                  | –    | Public platform metadata                              |
| `GET`    | `/health/live`                         | –    | Process liveness                                      |
| `GET`    | `/health/ready`                        | –    | 200/503 with a database check                         |
| `GET`    | `/`                                    | –    | Public API banner                                     |

Anything else under the API namespace returns `404 NOT_FOUND` with a request id.

# PulseCheck security notes

What is protected, how, and what is deliberately out of scope. Every claim here
is backed by code in `packages/server/src` and by tests in
`packages/server/test/unit/ssrf.test.ts`, `test/unit/checker.test.ts` and
`test/api/auth.test.ts`.

- [1. Authentication](#1-authentication)
- [2. Bearer auth, CORS and CSRF](#2-bearer-auth-cors-and-csrf)
- [3. Authorization and ownership](#3-authorization-and-ownership)
- [4. SSRF defence](#4-ssrf-defence)
- [5. Outbound request hygiene](#5-outbound-request-hygiene)
- [6. Input validation](#6-input-validation)
- [7. Abuse control](#7-abuse-control)
- [8. Secrets, logging and data exposure](#8-secrets-logging-and-data-exposure)
- [9. Transport and headers](#9-transport-and-headers)
- [10. What is out of scope](#10-what-is-out-of-scope)

## 1. Authentication

- **Identity is Neon Auth (Managed Better Auth), on the same Neon branch as the
  database.** The SPA calls Neon Auth directly for sign-up, sign-in, sign-out and
  JWT minting (`packages/web/src/lib/auth-client.ts`). The PulseCheck API never
  sees a password and stores no credential material.
- **The API verifies a bearer JWT, not a session.** The SPA sends
  `Authorization: Bearer <jwt>`. The token is EdDSA (Ed25519), issued by Neon
  Auth, valid 15 minutes, and carries `sub` (the Neon Auth user id), `email`,
  `name`, `emailVerified`, and `iss`/`aud` both equal to the origin of the Auth
  URL.
- **Verification is local and pinned.** `packages/server/src/auth/token-verifier.ts`
  verifies the signature against the JWKS (`createRemoteJWKSet` on
  `NEON_AUTH_JWKS_URL`), accepts only `algorithms: ['EdDSA']`, and pins the issuer
  and audience to `new URL(NEON_AUTH_BASE_URL).origin`. A token that tries to
  downgrade the algorithm, or was minted for another issuer, is rejected.
- **The middleware is forgiving by design.** `createAttachAuth`
  (`packages/server/src/middleware/auth.ts`) attaches `request.auth` only when a
  verified token maps to a local user; a missing or invalid token simply leaves it
  unset, and verification failures are never surfaced as `500`. `requireAuth`
  turns "no verified token" into the `401 UNAUTHENTICATED`.
- **Token refresh.** The client retries a request once when it answers `401` while
  a token was attached (`packages/web/src/lib/api-client.ts`). This covers the
  moment after sign-in before Neon Auth's session is readable, and the 15-minute
  expiry while the browser session is still valid. After the retry a `401` clears
  cached state and routes to `/login`.
- **Registration controls live in Neon Auth, not the environment.**
  `ALLOW_REGISTRATION` and `REGISTRATION_EMAIL_ALLOWLIST` are gone. Open or closed
  sign-ups, email verification and trusted origins are a Neon Auth branch setting:
  `neon neon-auth domain list`, `neon neon-auth domain add https://app.example.com`.
  Localhost origins are allowed by default, which is what the Vite dev server on
  `http://localhost:5273` relies on.

## 2. Bearer auth, CORS and CSRF

- **No cookies, no server-side sessions, no CSRF tokens.** The previous design
  stored opaque session tokens in `HttpOnly` cookies and paired them with
  double-submit CSRF. None of that exists now: the API reads a bearer header, and
  Neon Auth keeps the session.
- **Why CSRF protection is unnecessary rather than merely removed.** A browser
  never attaches an `Authorization` header automatically. There is no ambient
  credential for a cross-site request to ride, so a forged request arrives
  unauthenticated and is answered `401`. Removing the cookies removed the threat,
  not just the defence.
- **CORS.** Only `WEB_ORIGIN` plus `CORS_ORIGINS` are allowed, with
  `credentials: true`; the allowed headers list is explicit
  (`content-type`, `authorization`, `x-request-id`).

## 3. Authorization and ownership

- Every monitor read and write filters on the authenticated user id **inside the
  query**, so another account's monitor is indistinguishable from a missing one:
  the API answers `404 NOT_FOUND`, never `403 FORBIDDEN`, and never leaks
  existence.
- The same applies to check history, uptime, response times and incidents
  (`getMonitorOrThrow` runs before any aggregate query).
- `/incidents` and `/dashboard/*` scope their queries by `monitor: { userId }`.
- Tests assert isolation for monitor CRUD, pause/resume/delete, check history,
  incident listings and dashboard metrics.

## 4. SSRF defence

Monitoring means asking a server to fetch a URL a user chose, which is the SSRF
threat model. Four layers, because no single check is sufficient:

1. **URL policy** (`assertUrlAllowed`) — only `http`/`https`, no embedded
   credentials, no blocked low ports (everything under 1024 except 80 and 443),
   port in range, hostname present. `REQUIRE_HTTPS_TARGETS=true` refuses `http`
   entirely.
2. **Address classification before connecting** (`resolveDestination`) — the
   hostname is resolved and **every** answer must be globally routable. A
   hostname answering with both a public and a private address is rejected
   outright, which is the classic rebinding/dns-poisoning setup.
3. **Guarded lookup at connect time** (`createGuardedLookup`) — the same
   classification runs inside the DNS lookup used by the HTTP client's `connect`
   options, so the address that is actually connected to is validated at the
   moment the socket opens. This closes the DNS-rebinding window between the
   pre-flight check and the connection.
4. **Manual redirects** — every hop repeats steps 1-3 before a new connection is
   made. A redirect into `10.0.0.0/8`, to port 25, or to a URL with credentials
   is refused (all three are tested).

What is refused: loopback (`127.0.0.0/8`, `::1`), private ranges (`10/8`,
`172.16/12`, `192.168/16`), link-local (`169.254.0.0/16`, which includes the
cloud metadata endpoint `169.254.169.254`, and `fe80::/10`), unique-local
(`fc00::/7`), carrier-grade NAT (`100.64/10`), multicast, reserved, unspecified,
broadcast, and the `6to4`, `Teredo` and `NAT64` prefixes. IPv4-mapped IPv6
addresses are unwrapped first, so `::ffff:127.0.0.1` is judged as `127.0.0.1`.

Only ipaddr.js's `unicast` range is accepted, which is allow-list rather than
deny-list: an unfamiliar range is refused by default.

`BLOCK_PRIVATE_NETWORKS=false` disables layers 2-4 and exists only for tests that
monitor a loopback mock server. It must never be set in production, and the
default is `true` in `.env.example`, `docker-compose.yml` and the code.

## 5. Outbound request hygiene

- **Bounded response body.** A declared `content-length` over the cap is rejected
  before reading; the stream itself is capped while being drained. An oversized
  response is `RESPONSE_TOO_LARGE`, not memory exhaustion. The same applies to
  the stored request body (`maxRequestBodyBytes`).
- **Redirect cap.** `maxRedirects` (default 5) prevents redirect loops.
- **Header injection.** Custom header names must match the RFC 7230 token
  grammar, values must not contain CR/LF/NUL, and hop-by-hop and
  engine-managed names (`host`, `content-length`, `connection`, `cookie`,
  `transfer-encoding`, `expect`, `upgrade`, …) cannot be set at all.
- **Connection reuse bound.** One shared agent with explicit connection limits
  and timeouts sized from `maxTimeoutMs` and `checkConcurrency`.
- **Timeouts.** Every check has an explicit request timeout (default 10 s,
  capped at `MAX_TIMEOUT_MS`), enforced with an `AbortController`.

## 6. Input validation

- Every request body and query string is validated by a **strict** zod schema
  (unknown keys are rejected, so a client cannot inject fields such as `userId`
  or `status`).
- Path parameters are validated as UUIDs before reaching a query.
- Pagination is bounded (`page >= 1`, `pageSize <= 200`), and time windows come
  from a fixed set so a client cannot request an unbounded scan.
- The **same** schemas are exported from `@pulsecheck/shared` and rendered by the
  web forms, so client and server cannot drift apart.
- Body size is capped (100 kB at the parser, 16 kB per monitored request body).

## 7. Abuse control

- **Credential endpoints are no longer ours to rate-limit.** Neon Auth owns
  registration and login, so the old `authLimiter` (and `RATE_LIMIT_AUTH_MAX` /
  `RATE_LIMIT_AUTH_WINDOW_MINUTES`) is gone. Neon Auth applies its own limits.
- `apiLimiter` is a coarse per-IP ceiling for the API, configured by
  `RATE_LIMIT_API_MAX` and `RATE_LIMIT_API_WINDOW_MINUTES` and raised
  automatically in tests. Behind a proxy, set `TRUST_PROXY=true` so the real
  client address is used.
- Monitor count per account is capped (`maxMonitorsPerUser`, default 25) and
  enforced before the insert (tested by shrinking the limit at runtime).

## 8. Secrets, logging and data exposure

- `.env` is git-ignored; `.env.example` contains placeholders only. There is no
  auth secret for the operator to manage: the signed JWT comes from Neon Auth and
  is verified against its public JWKS.
- Structured logs (`pino`) never contain bearer tokens, credentials, or monitor
  header values. Target response bodies and headers are never stored or logged -
  only the status code and a sanitized, bounded diagnostic.
- Diagnostic messages are single-lined, length-capped, and redact credentials
  embedded in URLs (`https://user:pw@host` → `https://[redacted]@host`).
- Responses never contain password material or tokens; a user is returned only as
  `{ id, email, createdAt }`.
- `x-powered-by` is disabled, so Express is not advertised.

## 9. Transport and headers

- `helmet` sets `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`
  (correct for a JSON-only API), `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer` and a same-site resource policy.
- TLS termination belongs to the proxy in front of the API; the provided compose
  stack publishes only the web container, whose nginx proxies `/api` to the API
  over the internal network.
- Readiness (`/health/ready`) returns `503` when PostgreSQL is unreachable so a
  load balancer stops routing to a broken instance, while `/health/live` stays
  dependency-free so a database outage cannot cause a restart loop.

## 10. What is out of scope

- **Credential lifecycle belongs to Neon Auth.** E-mail verification, password
  reset and MFA are whatever the Neon Auth branch is configured for; the API does
  not implement them. Enable them in the Neon Auth branch settings before opening
  registration publicly.
- **No account-level quotas or billing.** Rate limits are per IP and per
  endpoint, not per account.
- **No audit log** of administrative actions (there is no admin role).
- **Egress filtering is application-level.** A network egress policy
  (deny-by-default to private ranges at the network layer) remains the strongest
  control and is recommended in addition to the checks above.
- **No encryption of stored monitor headers** at rest beyond the database's own
  encryption; secrets in custom headers are stored as configured.

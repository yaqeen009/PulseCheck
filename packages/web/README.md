# @pulsecheck/web

Frontend for PulseCheck: React 18 + TypeScript (strict), Vite, Tailwind, TanStack Query,
React Router, Recharts and shadcn-style primitives on Radix.

Every screen reads from the real API. Nothing is seeded, hardcoded or faked: a brand-new
account sees zeroes and empty states, and a missing metric (`null` from the API) renders as
`—`, never as `0%`.

## Run the dev server

The API must be running on `http://localhost:4100` (the Vite dev server proxies `/api` and
`/health` there):

```bash
npm run dev:server   # from the repo root, in one terminal
npm run dev -w @pulsecheck/web
```

Then open http://localhost:5273.

## Build

```bash
npm run build -w @pulsecheck/web   # tsc -p tsconfig.app.json --noEmit && vite build
```

The build needs `@pulsecheck/shared` compiled first; the `prebuild` script does that
automatically (same for `predev`, `pretest`, `pretypecheck`).

## Test

```bash
npm test -w @pulsecheck/web   # vitest run
```

Unit tests stub `fetch` per test, so no server or database is required. They cover the API
client (bearer header injection, error-envelope parsing, 401 handling), the formatting helpers,
`StatusBadge`/`StatusDot`, `MonitorForm` validation and the dashboard empty state.

End-to-end smoke test (register → create monitor → see it in the list) is opt-in:

```bash
PLAYWRIGHT_BASE_URL=http://localhost:5273 npm run test:e2e -w @pulsecheck/web
```

Without `PLAYWRIGHT_BASE_URL` the Playwright suite skips itself.

## Layout

```
src/
  api/          TanStack Query hooks and query keys per resource
  components/   app components (shell, status, charts, tables, forms)
  components/ui shadcn-style primitives on Radix
  hooks/        small shared hooks
  lib/          api client, formatting, status presentation, cn()
  pages/        one file per route
  test/         vitest setup
e2e/            Playwright smoke test
```

## Conventions

- Types that describe the API come from `@pulsecheck/shared`. Local types are only added when
  the browser needs a different shape (for example numeric form inputs).
- No component calls `fetch` directly: everything goes through `src/lib/api-client.ts` or the
  hooks in `src/api`.
- API requests carry `Authorization: Bearer <jwt>`, minted by Neon Auth through the client in
  `src/lib/auth-client.ts`. There are no cookies and no CSRF token: a browser never attaches a
  bearer header on its own, so there is no ambient credential to protect.

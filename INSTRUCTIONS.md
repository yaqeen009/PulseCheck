# Build PulseCheck — A Production-Quality API Monitoring Platform

## 1. Role and objective

Act as a senior full-stack engineer, backend architect, and pragmatic UI/UX designer.

Build **PulseCheck**, a production-minded API monitoring platform that allows users to register, create API monitors, run automated health checks, inspect response times, investigate failures, and track historical uptime.

This must be a working application, not a static dashboard or UI-only prototype.

Work directly in the existing repository. Inspect the current codebase, available dependencies, existing conventions, environment configuration, and installed agent skills before making changes. Preserve useful existing work rather than replacing it unnecessarily.

If the repository is empty, initialize the project using the architecture below.

Do not stop after generating a plan. Implement the application, run available checks, fix issues, and document anything that remains incomplete.

## 2. Technology stack

Use the following stack unless an existing, justified project constraint requires a compatible alternative.

### Frontend

- React
- TypeScript with strict mode
- Vite
- Tailwind CSS
- shadcn/ui where appropriate
- React Router
- TanStack Query for server state
- Recharts for monitoring charts
- React Hook Form and Zod for forms and validation
- Lucide icons

### Backend

- Node.js with TypeScript
- Express
- PostgreSQL
- Prisma ORM
- Zod for request validation
- Pino for structured logging
- A secure password-hashing library such as Argon2 or bcrypt
- JWT or secure session-based authentication, with a documented security rationale
- A maintained scheduling mechanism for recurring monitoring jobs

### Testing

- Vitest for frontend and shared TypeScript tests
- Supertest for API integration tests
- A suitable browser-testing framework such as Playwright for critical user flows

Use maintained, mutually compatible dependency versions. Do not install unnecessary packages or use deprecated APIs.

Keep frontend and backend responsibilities separate. Do not access PostgreSQL directly from the browser.

## 3. Product scope

Implement the following features.

### A. Authentication and user management

Support:

- User registration
- User login and logout
- Current-user profile retrieval
- Protected application routes
- Secure password hashing
- Server-side validation
- Consistent authentication error handling

Requirements:

- Prevent duplicate accounts.
- Never store plaintext passwords.
- Do not expose password hashes or authentication secrets in API responses.
- Apply sensible authentication rate limits.
- Prevent users from accessing or modifying another user's monitors or check results.
- Make the registration policy explicit and configurable through environment variables if needed.

For browser authentication, prefer secure, HttpOnly cookies with appropriate SameSite and Secure settings in production. Implement CSRF protection where applicable. If you choose a different approach, document the trade-offs and ensure tokens cannot be exposed through avoidable client-side storage risks.

### B. Monitor management

Users should be able to create, view, edit, pause, resume, and delete monitors.

Each monitor should support:

- Name
- Target URL
- HTTP method: GET, POST, PUT, PATCH, or DELETE
- Configurable check interval
- Request timeout
- Expected HTTP status code or supported status-code range
- Optional custom request headers
- Optional request body for applicable methods
- Creation and last-check timestamps
- Enabled/paused state

Provide reasonable defaults, such as a GET request, a 60-second interval, and a 10-second timeout, subject to platform resource limits.

Validate URLs, methods, intervals, timeouts, headers, and payload sizes on the server.

Do not allow a user to configure a monitor that makes requests to localhost, private networks, link-local addresses, cloud metadata endpoints, or other restricted destinations. Prevent SSRF attacks, including DNS rebinding and redirects to forbidden addresses.

Resolve and validate destinations safely, enforce outbound network restrictions, and revalidate every redirect destination. Never rely solely on a frontend URL validator.

Do not execute arbitrary user-supplied code or shell commands.

### C. Automated health checks

Implement actual server-side health checks, not simulated results.

For each enabled monitor:

1. Schedule checks according to its configured interval.
2. Send the configured HTTP request.
3. Measure elapsed time using a monotonic clock.
4. Record the HTTP status code when available.
5. Determine whether the response meets the configured expectations.
6. Record success or failure, response time, and a sanitized diagnostic message.
7. Update the monitor's last-check information.
8. Update its current status and derived uptime statistics.

Distinguish between:

- Healthy: the latest check met expectations.
- Degraded: the target is reachable but is failing configured expectations or exhibiting a defined performance problem.
- Down: the latest check failed or timed out.
- Paused: monitoring is intentionally disabled.
- Pending: no completed check exists yet.

Document the precise state-transition rules and use them consistently.

Use a scheduler or queue suitable for the project's deployment environment. Avoid overlapping checks for the same monitor. Apply concurrency limits, timeouts, bounded retries, and jitter where appropriate.

Do not rely on an in-memory scheduler as the sole mechanism for durable scheduling in a horizontally scaled production deployment. Prevent duplicate check execution when multiple workers run. If a simpler single-worker design is used for the MVP, document its deployment limitations and implement a safe single-worker operating model.

Handle network failures, DNS failures, TLS errors, HTTP errors, and timeouts without crashing the service.

Treat an HTTP response as successful only when it satisfies the configured expectations. An HTTP 500 response, for example, should not count as a successful check merely because a response was received.

### D. Dashboard

Build a polished dashboard that includes:

- Total monitors
- Healthy monitors
- Degraded monitors
- Down monitors
- Overall uptime over a clearly defined period
- Recent incidents or failures
- Recent check activity
- Response-time trends
- A monitor list with status indicators

Support useful empty, loading, error, and populated states.

All displayed metrics must be derived from actual persisted data. Do not hardcode attractive example metrics into production screens.

For a new account, show a helpful empty state and an action to create the first monitor.

### E. Monitor details

Create a dedicated detail page for each monitor.

Display:

- Monitor name, URL, and current status
- Check interval and timeout
- Latest result and last-checked time
- Response-time history chart
- Uptime over selectable time windows
- Recent check results
- HTTP status codes and sanitized failure reasons
- Monitor configuration
- Pause/resume, edit, and delete actions

Provide practical time filters, such as 1 hour, 24 hours, 7 days, and 30 days, where the underlying retention and available data permit them.

Clearly distinguish unavailable historical data from zero-percent uptime.

### F. Check history and incidents

Persist individual check results.

Include fields for:

- Monitor reference
- Check timestamp
- Completion timestamp or duration
- Success/failure outcome
- HTTP status code, if available
- Response time in milliseconds
- Sanitized error category and message

Create a basic incident history that identifies transitions from healthy to down or degraded, along with recovery events.

Avoid creating a new incident for every repeated failed check during the same outage. Group consecutive failures into a single incident and record its recovery.

Paginate historical results. Set sensible data-retention defaults and document how retention can be configured.

Do not log authentication secrets, sensitive request headers, full sensitive response bodies, or other unnecessary user data.

### G. Search, filtering, and usability

Provide:

- Monitor search
- Status filtering
- Sorting by name, status, or last checked time
- Confirmation before destructive actions
- Toast notifications for completed actions and errors
- Clear form validation messages
- Responsive layouts for desktop, tablet, and mobile

Do not implement controls that look functional but do nothing.

## 4. Data model

Design and implement an appropriate relational schema. At minimum, consider:

### User

- id
- email
- passwordHash
- createdAt
- updatedAt

### Monitor

- id
- userId
- name
- url
- method
- intervalSeconds
- timeoutMs
- expectedStatus configuration
- headers and optional request body, stored safely
- enabled
- currentStatus
- lastCheckedAt
- createdAt
- updatedAt

### CheckResult

- id
- monitorId
- checkedAt
- completedAt
- success
- httpStatusCode
- responseTimeMs
- errorCategory
- errorMessage

### Incident

- id
- monitorId
- startedAt
- resolvedAt
- initialStatus
- latestErrorSummary
- createdAt
- updatedAt

Adjust the model where needed for correctness, indexing, scalability, and Prisma compatibility.

Requirements:

- Use foreign keys and appropriate deletion behavior.
- Add indexes for frequently queried monitor and time-series fields.
- Ensure ownership checks are enforced on the server.
- Avoid storing redundant metrics that can be computed efficiently.
- Use database transactions where multiple related writes must remain consistent.
- Add Prisma migrations and a safe development seed if useful.
- Never seed fake monitoring results into production.

## 5. API design

Use a versioned API namespace, such as `/api/v1`.

Implement endpoints equivalent to:

Authentication:

- POST `/api/v1/auth/register`
- POST `/api/v1/auth/login`
- POST `/api/v1/auth/logout`
- GET `/api/v1/auth/me`

Monitors:

- GET `/api/v1/monitors`
- POST `/api/v1/monitors`
- GET `/api/v1/monitors/:id`
- PATCH `/api/v1/monitors/:id`
- DELETE `/api/v1/monitors/:id`
- POST `/api/v1/monitors/:id/pause`
- POST `/api/v1/monitors/:id/resume`

Monitoring history:

- GET `/api/v1/monitors/:id/checks`
- GET `/api/v1/monitors/:id/uptime`
- GET `/api/v1/monitors/:id/response-times`
- GET `/api/v1/monitors/:id/incidents`

Dashboard:

- GET `/api/v1/dashboard/summary`
- GET `/api/v1/dashboard/recent-activity`

Health:

- GET `/health/live`
- GET `/health/ready`

You may refine the route structure, but keep it consistent and document it.

Implement:

- Request schema validation
- Consistent JSON response structures
- Correct HTTP status codes
- Centralized error handling
- Pagination and bounded query parameters
- Authentication and ownership middleware
- Rate limiting where appropriate
- Structured logs with request identifiers
- Safe handling of unexpected exceptions

Do not return stack traces, internal database errors, secrets, or sensitive diagnostic information to clients.

The readiness endpoint should check required dependencies such as PostgreSQL. The liveness endpoint should indicate whether the process is alive without depending on every external service.

## 6. Frontend design direction

Design PulseCheck as a credible developer-focused SaaS product.

Visual direction:

- Minimal, professional, technical
- Clear hierarchy and readable typography
- Neutral surfaces with restrained accent colors
- Consistent spacing and reusable components
- Status colors that remain distinguishable and accessible
- Well-designed charts, tables, dialogs, and forms
- Subtle transitions where useful
- Responsive sidebar/navigation
- Dark mode only if it can be implemented consistently

Avoid excessive gradients, decorative animations, generic oversized hero sections inside the authenticated dashboard, and unnecessary glassmorphism.

Create these principal screens:

1. Registration and login
2. Dashboard
3. Monitors list
4. Create monitor
5. Edit monitor
6. Monitor detail
7. Incident history
8. Account settings

Make the public landing page concise and focused on the product's real capabilities. Do not claim enterprise-grade reliability, certifications, or service-level guarantees that have not been demonstrated.

Create reusable UI components and consistent design tokens. Prefer accessible shadcn/ui components over building everything from scratch.

## 7. Security and reliability requirements

Treat security as a core requirement.

In particular:

- Prevent SSRF and redirect-based SSRF.
- Enforce ownership checks for every user-specific resource.
- Validate all incoming data on the server.
- Protect authentication and sensitive actions against abuse.
- Use secure production cookie settings where applicable.
- Apply appropriate CORS, security headers, and content-type limits.
- Restrict outbound monitoring requests to safe destinations.
- Avoid logging credentials or secret headers.
- Protect against excessively frequent checks and resource exhaustion.
- Limit request-body size and monitor configuration size.
- Handle graceful shutdown and database disconnection.
- Avoid leaking internal exceptions to API consumers.
- Do not commit `.env` files, credentials, or secrets.

Add explicit limits for the number of monitors per account, minimum monitoring interval, maximum timeout, request size, and concurrent checks. Make limits configurable where appropriate.

Never claim that PulseCheck can safely monitor arbitrary public URLs until its outbound-request security has been tested.

## 8. Testing requirements

Write meaningful tests, not merely placeholder tests.

At minimum, cover:

### Unit tests

- URL and monitor configuration validation
- Expected-status matching
- Response-time measurement logic
- Monitor status transitions
- Uptime calculations
- Incident creation and recovery behavior
- Authentication validation

### API integration tests

- Registration and login
- Duplicate account rejection
- Protected endpoints
- Monitor CRUD operations
- Ownership enforcement
- Invalid monitor configuration rejection
- Check-history retrieval and pagination
- Dashboard calculations
- Error responses

### Monitoring worker tests

- Successful target response
- Unexpected HTTP status
- Timeout
- Network failure
- Prevention of overlapping or duplicate jobs
- SSRF and redirect restrictions

### Frontend tests

- Authentication forms
- Monitor creation and editing
- Loading, empty, and error states
- Dashboard data rendering
- Monitor actions

Use local mock HTTP servers for monitoring tests rather than relying on arbitrary external APIs.

If PostgreSQL, browser tooling, or another required service is unavailable, identify the limitation explicitly. Do not claim tests passed when they were skipped or not run.

## 9. Developer experience and documentation

Provide:

- Clear project directory structure
- `.env.example` containing placeholders only
- Installation instructions
- Local PostgreSQL setup instructions
- Prisma migration commands
- Frontend and backend development commands
- Test commands
- Build commands
- Production deployment instructions
- Database migration instructions for production
- API documentation, preferably OpenAPI
- Architecture overview
- Explanation of the scheduling and worker model
- Explanation of uptime calculations and status transitions
- Security and SSRF mitigation notes
- Known limitations and future improvements

Use separate development and production configurations. Ensure secrets are supplied through environment variables and are never committed.

If Docker Compose materially simplifies local setup, provide a configuration for the application and PostgreSQL, with persistent database storage and health checks. Do not expose unnecessary services publicly.

## 10. Implementation workflow

Follow this workflow:

### Phase 1 — Inspect and plan

- Inspect the repository and existing files.
- Identify the current state, dependencies, scripts, and constraints.
- Check the available agent skills and use relevant testing, security, backend, and frontend skills.
- Produce a concise implementation plan and identify important architectural decisions.
- Then proceed without waiting for approval unless a genuinely blocking decision requires clarification.

### Phase 2 — Foundation

- Establish the application structure.
- Configure TypeScript, linting, formatting, environment validation, PostgreSQL, Prisma, logging, and error handling.
- Create migrations.
- Add health endpoints.

### Phase 3 — Authentication and monitor management

- Implement authentication and protected API routes.
- Implement monitor CRUD and validation.
- Add ownership enforcement and security protections.
- Build the corresponding frontend screens.

### Phase 4 — Monitoring engine

- Implement the actual scheduler and worker.
- Execute safe HTTP checks.
- Persist results.
- Handle monitor state transitions, incidents, concurrency, and failures.

### Phase 5 — Analytics and dashboard

- Implement uptime and response-time calculations.
- Implement history and incident endpoints.
- Connect the frontend to actual backend data.
- Finish the dashboard and detail pages.

### Phase 6 — Quality assurance

- Run formatting and lint checks.
- Run TypeScript checks.
- Run unit and integration tests.
- Run production builds.
- Fix discovered issues and rerun affected checks.
- Check for security-sensitive implementation mistakes.
- Verify the application's main user flows.

### Phase 7 — Documentation and handoff

- Update the README and environment examples.
- Document migrations and deployment.
- Summarize the architecture and key decisions.
- Report exactly which tests and builds passed, failed, or were skipped.
- List unresolved issues and the next steps required to deploy.

Commit changes only if explicitly requested and repository conventions permit it.

## 11. Definition of done

The project is ready for review only when:

- A new user can register and log in.
- A user can create, edit, pause, resume, and delete monitors.
- The backend actually performs scheduled HTTP health checks.
- Check results are persisted in PostgreSQL.
- Dashboard metrics are derived from real check history.
- Response-time history and incidents are viewable.
- Users cannot access each other's monitors or results.
- SSRF defenses and outbound request restrictions are implemented and tested.
- Core unit and integration tests pass, or remaining failures are explicitly documented.
- Frontend and backend production builds succeed.
- Database migrations and environment configuration are documented.
- No production credentials or secrets are committed.

Begin by inspecting the repository. Then implement the application in coherent phases, verifying each phase before proceeding.

Do not substitute mock data for backend functionality. Do not silently skip difficult requirements. If a requirement cannot be completed safely, explain why and implement the safest practical alternative.

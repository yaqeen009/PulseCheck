import {
  API_PREFIX,
  type ApiErrorBody,
  type ApiErrorCode,
  type ValidationIssue,
} from '@pulsecheck/shared';
import { authClient } from './auth-client';

/**
 * Typed HTTP client for the PulseCheck API.
 *
 * Rules it enforces so no component has to remember them:
 *  - every request goes through the versioned prefix;
 *  - when a bearer token is available it is attached as `Authorization: Bearer
 *    <jwt>`. The token comes from Neon Auth; this API never sees cookies or CSRF
 *    tokens;
 *  - failures become `ApiError`, carrying the server's stable error code, the
 *    request id and any field-level validation issues.
 */
const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'LIMIT_EXCEEDED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const satisfies readonly ApiErrorCode[];

function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && (API_ERROR_CODES as readonly string[]).includes(value);
}

/** Raised for every non-2xx response and for responses that are not JSON. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: unknown;
  readonly requestId: string | undefined;

  constructor(init: {
    status: number;
    code: ApiErrorCode;
    message: string;
    details?: unknown;
    requestId?: string | undefined;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId;
  }

  /** True when the session is missing or has expired. */
  get isUnauthenticated(): boolean {
    return this.status === 401 || this.code === 'UNAUTHENTICATED';
  }

  /** Field-level validation issues, when the server supplied any. */
  get validationIssues(): ValidationIssue[] {
    return parseValidationIssues(this.details);
  }
}

/** Narrow `unknown` details into the server's `{ path, message }` issue list. */
export function parseValidationIssues(details: unknown): ValidationIssue[] {
  if (!Array.isArray(details)) return [];
  const issues: ValidationIssue[] = [];
  for (const entry of details) {
    if (typeof entry !== 'object' || entry === null) continue;
    const candidate = entry as { path?: unknown; message?: unknown };
    if (typeof candidate.message !== 'string') continue;
    const path = typeof candidate.path === 'string' ? candidate.path : '';
    issues.push({ path, message: candidate.message });
  }
  return issues;
}

/** Resolves the bearer token for one request, or null when there is no session. */
export type TokenProvider = () => Promise<string | null>;

/**
 * Pull the JWT out of a Neon Auth response.
 *
 * The client returns the token under `data.token` for a token request and under
 * `data.session.token` for a session response; both are the same EdDSA JWT. A
 * signed-out visitor yields `UNAUTHORIZED`, which is a normal state here.
 */
function extractAuthToken(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as { token?: unknown; session?: { token?: unknown } };
  if (typeof record.token === 'string' && record.token.length > 0) return record.token;
  const sessionToken = record.session?.token;
  if (typeof sessionToken === 'string' && sessionToken.length > 0) return sessionToken;
  return null;
}

/**
 * Default provider: the JWT Neon Auth issued for the current session.
 *
 * A signed-out visitor is a normal state, not an error: Neon Auth answers
 * `UNAUTHORIZED` for the token request, and public endpoints (the platform meta
 * the login screen needs) must still work. Any failure therefore resolves to
 * `null`, and the request goes out unauthenticated.
 */
async function neonAuthTokenProvider(): Promise<string | null> {
  try {
    const { data } = await authClient.token();
    return extractAuthToken(data);
  } catch {
    return null;
  }
}

let tokenProvider: TokenProvider = neonAuthTokenProvider;

/**
 * Replace the bearer-token provider. Passing `null` restores the Neon Auth
 * default. Injectable so tests — and callers without a live auth server — can
 * supply a token without reaching Neon Auth.
 */
export function setAuthTokenProvider(provider: TokenProvider | null): void {
  tokenProvider = provider ?? neonAuthTokenProvider;
}

/**
 * Resolve a usable JWT, re-reading the Neon Auth session until one appears.
 *
 * Neon Auth needs a moment after `signUp`/`signIn` before the browser can read
 * the session, so the authenticated area must not fire its queries before a
 * token exists. Returns `null` if no session appears within `timeoutMs`; the
 * route guards then treat the visitor as signed out.
 */
export async function awaitAuthToken(timeoutMs = 10_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const token = await refreshSessionAndToken();
    if (token) return token;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

/** Forces Neon Auth to re-read the session, then returns a fresh JWT. */
export type SessionRefresher = () => Promise<string | null>;

async function neonAuthSessionRefresher(): Promise<string | null> {
  try {
    const { data } = await authClient.getSession({ query: { disableCookieCache: true } });
    const token = extractAuthToken(data);
    if (token) return token;
  } catch {
    // The session may be gone; the token provider decides what happens next.
  }
  return neonAuthTokenProvider();
}

let sessionRefresher: SessionRefresher = neonAuthSessionRefresher;

/** Replace the session refresher used by the one-shot 401 retry. `null` restores the default. */
export function setSessionRefresher(refresher: SessionRefresher | null): void {
  sessionRefresher = refresher ?? neonAuthSessionRefresher;
}

async function refreshSessionAndToken(): Promise<string | null> {
  try {
    return await sessionRefresher();
  } catch {
    return null;
  }
}

type UnauthorizedHandler = () => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

/**
 * Register the callback that runs when the API answers 401. The app uses it to
 * drop cached user state and route to `/login`.
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
  /** Skip the global 401 handler. Used by the session probe, where 401 is normal. */
  skipUnauthorizedHandler?: boolean;
}

function buildQuery(query: Record<string, QueryValue> | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

function isJsonContentType(response: Response): boolean {
  const header = response.headers.get('content-type');
  return header !== null && header.toLowerCase().includes('json');
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function toApiError(response: Response, payload: unknown): ApiError {
  const envelope = payload as Partial<ApiErrorBody> | undefined;
  const error = envelope?.error;
  if (error && typeof error === 'object') {
    const message = typeof error.message === 'string' ? error.message : response.statusText;
    const code = isApiErrorCode(error.code) ? error.code : 'INTERNAL_ERROR';
    return new ApiError({
      status: response.status,
      code,
      message: message || 'Request failed',
      details: error.details,
      requestId: typeof error.requestId === 'string' ? error.requestId : undefined,
    });
  }
  return new ApiError({
    status: response.status,
    code: 'INTERNAL_ERROR',
    message: response.statusText || 'Request failed',
  });
}

/**
 * Perform one API request. Prefer the resource hooks in `src/api` over calling
 * this directly from a component.
 *
 * A 401 while a token was attached is retried once with a freshly minted token.
 * Two real situations produce it: the moment after sign-up, before Neon Auth's
 * session is readable (the cached token belongs to the previous, anonymous
 * state), and any request made after the 15-minute JWT expires while the browser
 * session is still valid. Without the retry those requests would fail until the
 * user reloaded.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const url = `${API_PREFIX}${path}${buildQuery(options.query)}`;
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);

  const headers = new Headers({ accept: 'application/json' });
  if (options.body !== undefined) headers.set('content-type', 'application/json');

  const send = (token: string | null): Promise<Response> => {
    const attemptHeaders = new Headers(headers);
    if (token) attemptHeaders.set('authorization', `Bearer ${token}`);
    return fetch(url, {
      method,
      headers: attemptHeaders,
      body,
      signal: options.signal ?? null,
    });
  };

  const firstToken = await tokenProvider();
  let response = await send(firstToken);

  if (response.status === 401 && firstToken) {
    // One retry with a freshly minted token. This covers the window right after
    // sign-in, before Neon Auth's session is readable, and the moment a
    // 15-minute JWT expires while the browser session is still valid.
    const refreshed = await refreshSessionAndToken();
    response = await send(refreshed ?? firstToken);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = await readJson(response);

  if (!response.ok) {
    const error = toApiError(response, payload);
    if (error.isUnauthenticated && !options.skipUnauthorizedHandler) {
      unauthorizedHandler?.();
    }
    throw error;
  }

  if (payload === undefined && !isJsonContentType(response)) {
    throw new ApiError({
      status: response.status,
      code: 'INTERNAL_ERROR',
      message: 'The server returned a response that is not JSON',
    });
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> =>
    apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'DELETE' }),
};

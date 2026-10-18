import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiRequest,
  setAuthTokenProvider,
  setUnauthorizedHandler,
} from '@/lib/api-client';

/** Minimal stand-in for `Response` that works without a fetch implementation. */
function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = { 'content-type': 'application/json' },
): Response {
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'status text',
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

function stubFetch(response: Response | (() => Response)) {
  const mock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(typeof response === 'function' ? response() : response),
  );
  vi.stubGlobal('fetch', mock);
  return mock;
}

function requestInit(mock: ReturnType<typeof vi.fn>, index = 0): RequestInit {
  const call = mock.mock.calls[index];
  if (!call) throw new Error(`fetch was not called ${index + 1} time(s)`);
  return call[1] as RequestInit;
}

function headerValue(init: RequestInit, name: string): string | null {
  const headers = init.headers;
  if (!(headers instanceof Headers)) return null;
  return headers.get(name);
}

describe('apiRequest', () => {
  beforeEach(() => {
    // No session by default; individual tests install the token they need.
    setAuthTokenProvider(async () => null);
  });

  afterEach(() => {
    setAuthTokenProvider(null);
    setUnauthorizedHandler(null);
    vi.unstubAllGlobals();
  });

  it('sends the bearer token in the Authorization header when one is available', async () => {
    setAuthTokenProvider(async () => 'jwt-abc');
    const mock = stubFetch(jsonResponse(200, { ok: true }));

    await apiRequest('/monitors', { method: 'POST', body: { name: 'api' } });

    const init = requestInit(mock);
    expect(init.method).toBe('POST');
    expect(headerValue(init, 'authorization')).toBe('Bearer jwt-abc');
    expect(headerValue(init, 'content-type')).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ name: 'api' }));
  });

  it('omits the Authorization header when the provider returns null', async () => {
    const mock = stubFetch(jsonResponse(200, { ok: true }));

    await apiRequest('/auth/me');

    const init = requestInit(mock);
    expect(init.method).toBe('GET');
    expect(headerValue(init, 'authorization')).toBeNull();
  });

  it('does not send cookies or CSRF headers', async () => {
    setAuthTokenProvider(async () => 'jwt-abc');
    const mock = stubFetch(jsonResponse(200, { ok: true }));

    await apiRequest('/monitors', { method: 'POST', body: {} });

    const init = requestInit(mock);
    expect(init.credentials).toBeUndefined();
    expect(headerValue(init, 'x-csrf-token')).toBeNull();
  });

  it('resolves the token anew for every request', async () => {
    const provider = vi.fn(async () => 'first');
    setAuthTokenProvider(provider);
    const mock = stubFetch(jsonResponse(200, { ok: true }));

    await apiRequest('/monitors');
    provider.mockResolvedValueOnce('second');
    await apiRequest('/monitors');

    expect(provider).toHaveBeenCalledTimes(2);
    expect(headerValue(requestInit(mock, 0), 'authorization')).toBe('Bearer first');
    expect(headerValue(requestInit(mock, 1), 'authorization')).toBe('Bearer second');
  });

  it('serializes only defined query parameters under the versioned prefix', async () => {
    const mock = stubFetch(jsonResponse(200, { items: [] }));

    await apiRequest('/monitors', {
      query: { search: 'api', status: undefined, page: 2, success: false, empty: '' },
    });

    const url = mock.mock.calls[0]?.[0];
    expect(url).toBe('/api/v1/monitors?search=api&page=2&success=false');
  });

  it('parses the error envelope into an ApiError with code, message and issues', async () => {
    stubFetch(
      jsonResponse(422, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: [{ path: 'url', message: 'Enter a valid absolute URL' }],
          requestId: 'req-1',
        },
      }),
    );

    const error = await apiRequest('/monitors', { method: 'POST', body: {} }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(422);
    expect(apiError.code).toBe('VALIDATION_ERROR');
    expect(apiError.message).toBe('Request validation failed');
    expect(apiError.requestId).toBe('req-1');
    expect(apiError.validationIssues).toEqual([
      { path: 'url', message: 'Enter a valid absolute URL' },
    ]);
  });

  it('falls back to a generic code when the envelope is missing', async () => {
    stubFetch(jsonResponse(500, undefined, { 'content-type': 'text/plain' }));

    const error = (await apiRequest('/monitors').catch((caught: unknown) => caught)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.status).toBe(500);
  });

  it('runs the 401 handler for an unauthenticated response', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    stubFetch(
      jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } }),
    );

    await apiRequest('/monitors').catch(() => undefined);

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('skips the 401 handler when the caller opts out', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    stubFetch(
      jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } }),
    );

    await apiRequest('/auth/me', { skipUnauthorizedHandler: true }).catch(() => undefined);

    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('returns undefined for a 204 response', async () => {
    stubFetch(jsonResponse(204, undefined, {}));

    await expect(apiRequest('/monitors/abc', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});

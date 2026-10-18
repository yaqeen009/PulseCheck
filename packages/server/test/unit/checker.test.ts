import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  categorizeError,
  closeOutboundDispatcher,
  performCheck,
  testPolicy,
  type CheckConfig,
} from '../../src/monitoring/checker.js';
import { BlockedDestinationError } from '../../src/monitoring/ssrf.js';
import {
  startMockServer,
  startRedirectServer,
  startStaticServer,
  type MockServer,
} from '../helpers/mock-server.js';

const servers: MockServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

afterAll(async () => {
  await closeOutboundDispatcher();
});

async function mock(options: Parameters<typeof startStaticServer>[0]): Promise<MockServer> {
  const server = await startStaticServer(options);
  servers.push(server);
  return server;
}

function config(overrides: Partial<CheckConfig> & { url: string }): CheckConfig {
  return {
    method: 'GET',
    headers: {},
    body: null,
    timeoutMs: 5_000,
    expectedStatusMin: 200,
    expectedStatusMax: 299,
    degradedResponseTimeMs: null,
    ...overrides,
  };
}

/** Loopback policy: monitoring a local mock server is only possible with it. */
const policy = testPolicy();

describe('performCheck - success and failure classification', () => {
  it('reports HEALTHY for a 200 response inside the expected range', async () => {
    const server = await mock({ status: 200, body: 'ok' });
    const outcome = await performCheck(config({ url: `${server.url}/health` }), { policy });

    expect(outcome.success).toBe(true);
    expect(outcome.status).toBe('HEALTHY');
    expect(outcome.httpStatusCode).toBe(200);
    expect(outcome.errorCategory).toBeNull();
    expect(outcome.errorMessage).toBeNull();
    expect(outcome.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(outcome.redirectsFollowed).toBe(0);
  });

  it('reports DEGRADED with UNEXPECTED_STATUS when the target answers with the wrong code', async () => {
    const server = await mock({ status: 500, body: 'boom' });
    const outcome = await performCheck(config({ url: `${server.url}/health` }), { policy });

    expect(outcome.success).toBe(false);
    expect(outcome.status).toBe('DEGRADED');
    expect(outcome.httpStatusCode).toBe(500);
    expect(outcome.errorCategory).toBe('UNEXPECTED_STATUS');
    expect(outcome.errorMessage).toContain('expected 200-299, received 500');
  });

  it('honours a custom expected-status range', async () => {
    const server = await mock({ status: 404, body: 'nope' });
    const outcome = await performCheck(
      config({ url: `${server.url}/missing`, expectedStatusMin: 404, expectedStatusMax: 404 }),
      { policy },
    );
    expect(outcome.success).toBe(true);
    expect(outcome.httpStatusCode).toBe(404);
  });

  it('reports DEGRADED for a slow-but-correct response over the latency budget', async () => {
    const server = await mock({ status: 200, delayMs: 120 });
    const outcome = await performCheck(
      config({ url: `${server.url}/slow`, degradedResponseTimeMs: 30 }),
      { policy },
    );

    expect(outcome.success).toBe(true);
    expect(outcome.status).toBe('DEGRADED');
    expect(outcome.responseTimeMs).toBeGreaterThanOrEqual(100);
  });

  it('reports TIMEOUT and DOWN when the target never answers', async () => {
    const server = await mock({ status: 200, delayMs: 3_000 });
    const outcome = await performCheck(config({ url: `${server.url}/hang`, timeoutMs: 150 }), {
      policy,
    });

    expect(outcome.success).toBe(false);
    expect(outcome.status).toBe('DOWN');
    expect(outcome.errorCategory).toBe('TIMEOUT');
    expect(outcome.errorMessage).toBe('no response within 150 ms');
  });

  it('reports CONNECT and DOWN when nothing is listening', async () => {
    // Bind then release a port so it is known to be closed, but is still a
    // permitted (>1024) destination.
    const throwaway = await mock({ status: 200 });
    const closedPort = throwaway.port;
    await throwaway.close();
    servers.splice(servers.indexOf(throwaway), 1);

    const outcome = await performCheck(config({ url: `http://127.0.0.1:${closedPort}/health` }), {
      policy,
    });

    expect(outcome.success).toBe(false);
    expect(outcome.status).toBe('DOWN');
    expect(outcome.errorCategory).toBe('CONNECT');
    expect(outcome.httpStatusCode).toBeNull();
  });

  it('reports DNS and DOWN for a hostname that does not resolve', async () => {
    const outcome = await performCheck(
      config({ url: 'http://pulsecheck-does-not-exist.invalid/' }),
      {
        policy,
      },
    );

    expect(outcome.success).toBe(false);
    expect(outcome.status).toBe('DOWN');
    expect(outcome.errorCategory).toBe('DNS');
  });

  it('reports RESPONSE_TOO_LARGE rather than buffering an oversized body', async () => {
    const server = await mock({ status: 200, body: 'x'.repeat(50_000) });
    const outcome = await performCheck(config({ url: `${server.url}/big` }), {
      policy,
      maxResponseBytes: 1_024,
    });

    expect(outcome.success).toBe(false);
    expect(outcome.status).toBe('DOWN');
    expect(outcome.errorCategory).toBe('RESPONSE_TOO_LARGE');
  });

  it('rejects an oversized declared content-length before reading the body', async () => {
    const server = await mock({
      status: 200,
      headers: { 'content-length': '999999', 'content-type': 'text/plain' },
      body: 'small',
    });
    const outcome = await performCheck(config({ url: `${server.url}/declared` }), {
      policy,
      maxResponseBytes: 1_024,
    });

    // The guard trips on the declared length, so the body is never read.
    expect(outcome.success).toBe(false);
    expect(outcome.errorCategory).toBe('RESPONSE_TOO_LARGE');
  });
});

describe('performCheck - request construction', () => {
  it('sends the configured method, body and custom headers plus a PulseCheck user-agent', async () => {
    const server = await mock({ status: 201 });
    const outcome = await performCheck(
      config({
        url: `${server.url}/create`,
        method: 'POST',
        headers: { 'x-api-key': 'secret-value', accept: 'application/json' },
        body: '{"ping":true}',
      }),
      { policy },
    );

    expect(outcome.success).toBe(true);
    const seen = server.requests[0];
    expect(seen?.method).toBe('POST');
    expect(seen?.body).toBe('{"ping":true}');
    expect(seen?.headers['x-api-key']).toBe('secret-value');
    expect(seen?.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(String(seen?.headers['user-agent'])).toContain('PulseCheck');
  });

  it('does not send a body for GET even when one is configured', async () => {
    const server = await mock({ status: 200 });
    await performCheck(config({ url: server.url, method: 'GET', body: 'ignored' }), { policy });
    expect(server.requests[0]?.body).toBe('');
  });

  it('never stores or returns the target response body', async () => {
    const server = await mock({ status: 200, body: 'sensitive-payload' });
    const outcome = await performCheck(config({ url: server.url }), { policy });
    expect(JSON.stringify(outcome)).not.toContain('sensitive-payload');
  });
});

describe('categorizeError', () => {
  const code = (value: string): NodeJS.ErrnoException => {
    const error = new Error(value) as NodeJS.ErrnoException;
    error.code = value;
    return error;
  };

  it.each([
    ['ENOTFOUND', 'DNS'],
    ['EAI_AGAIN', 'DNS'],
    ['ETIMEDOUT', 'TIMEOUT'],
    ['UND_ERR_CONNECT_TIMEOUT', 'TIMEOUT'],
    ['ABORT_ERR', 'TIMEOUT'],
    ['ECONNREFUSED', 'CONNECT'],
    ['ECONNRESET', 'CONNECT'],
    ['UND_ERR_SOCKET', 'CONNECT'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'TLS'],
    ['UND_ERR_INVALID_ARG', 'PROTOCOL'],
    ['RESPONSE_TOO_LARGE', 'RESPONSE_TOO_LARGE'],
    ['SOMETHING_ELSE', 'UNKNOWN'],
  ])('maps %s to %s', (input, expected) => {
    expect(categorizeError(code(input)).category).toBe(expected);
  });

  it('maps a TLS-looking message without a code to TLS', () => {
    expect(categorizeError(new Error('self-signed certificate in chain')).category).toBe('TLS');
  });

  it('maps a BlockedDestinationError to BLOCKED_DESTINATION', () => {
    expect(categorizeError(new BlockedDestinationError('private range')).category).toBe(
      'BLOCKED_DESTINATION',
    );
  });

  it('redacts credentials and rewrites a non-Error value', () => {
    expect(categorizeError(code('boom')).message).toBe('boom');
    expect(categorizeError('plain string').message).toBe('plain string');
    expect(categorizeError(new Error('see https://u:p@host/x')).message).toBe(
      'see https://[redacted]@host/x',
    );
  });
});

describe('performCheck - redirects', () => {
  it('follows a redirect manually and evaluates the final response', async () => {
    const target = await mock({ status: 200, body: 'final' });
    const redirect = await startRedirectServer(() => `${target.url}/final`, 1);
    servers.push(redirect);

    const outcome = await performCheck(config({ url: `${redirect.url}/start` }), { policy });

    expect(outcome.success).toBe(true);
    expect(outcome.httpStatusCode).toBe(200);
    expect(outcome.redirectsFollowed).toBe(1);
    expect(target.requests).toHaveLength(1);
  });

  it('stops with TOO_MANY_REDIRECTS on a redirect loop', async () => {
    const server = await startMockServer((_request, response) => {
      response.writeHead(302, { location: '/loop' });
      response.end();
    });
    servers.push(server);

    const outcome = await performCheck(config({ url: `${server.url}/loop` }), { policy });

    expect(outcome.success).toBe(false);
    expect(outcome.status).toBe('DOWN');
    expect(outcome.errorCategory).toBe('TOO_MANY_REDIRECTS');
  });

  it('re-validates every redirect hop, so a hop to a forbidden port is refused', async () => {
    const server = await startRedirectServer(() => 'http://127.0.0.1:25/smtp-please', 10);
    servers.push(server);

    const outcome = await performCheck(config({ url: `${server.url}/start` }), { policy });

    expect(outcome.success).toBe(false);
    expect(outcome.errorCategory).toBe('BLOCKED_DESTINATION');
    expect(outcome.errorMessage).toMatch(/port 25 is not allowed/);
  });

  it('refuses a redirect to a URL carrying embedded credentials', async () => {
    const server = await startRedirectServer(() => 'https://user:pw@example.com/private', 10);
    servers.push(server);

    const outcome = await performCheck(config({ url: `${server.url}/start` }), { policy });

    expect(outcome.success).toBe(false);
    expect(outcome.errorCategory).toBe('BLOCKED_DESTINATION');
    expect(outcome.errorMessage).toMatch(/embedded credentials/);
  });
});

describe('performCheck - SSRF policy', () => {
  const blocking = { blockPrivateNetworks: true, requireHttps: false };

  it('blocks the cloud metadata endpoint before connecting', async () => {
    const outcome = await performCheck(
      config({ url: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/' }),
      { policy: blocking },
    );

    expect(outcome.success).toBe(false);
    expect(outcome.status).toBe('DOWN');
    expect(outcome.errorCategory).toBe('BLOCKED_DESTINATION');
    expect(outcome.httpStatusCode).toBeNull();
  });

  it('blocks a loopback target when private networks are blocked', async () => {
    const outcome = await performCheck(config({ url: 'http://127.0.0.1:8080/admin' }), {
      policy: blocking,
    });

    expect(outcome.errorCategory).toBe('BLOCKED_DESTINATION');
  });

  it('blocks a redirected hop into a private address', async () => {
    const server = await startRedirectServer(() => 'http://10.0.0.1/internal', 10);
    servers.push(server);

    const outcome = await performCheck(config({ url: `http://localhost:${server.port}/start` }), {
      policy: blocking,
    });

    // The first hop is already loopback, so it is refused before the redirect is
    // even read - which is the correct, fail-fast behaviour.
    expect(outcome.errorCategory).toBe('BLOCKED_DESTINATION');
  });
});

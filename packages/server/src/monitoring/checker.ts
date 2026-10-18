import { Agent, request, type Dispatcher } from 'undici';
import {
  METHODS_WITH_BODY,
  statusFromOutcome,
  type ErrorCategory,
  type HttpMethod,
  type MonitorStatus,
} from '@pulsecheck/shared';
import { env, limits } from '../env.js';
import { logger } from '../logger.js';
import {
  BlockedDestinationError,
  assertUrlAllowed,
  createGuardedLookup,
  resolveDestination,
  sanitizeDiagnostic,
  type DestinationPolicy,
} from './ssrf.js';

/**
 * The health checker.
 *
 * Design notes
 *  - Timing uses `performance.now()` (monotonic), never `Date.now()`, so a clock
 *    adjustment cannot produce a negative or absurd response time.
 *  - Redirects are followed manually so every hop is re-validated by the SSRF
 *    policy. `undici.request` never follows redirects when `maxRedirections` is 0.
 *  - The response body is streamed with a byte cap. A target that streams
 *    megabytes is failed with RESPONSE_TOO_LARGE rather than buffered: this is a
 *    resource-exhaustion guard, not a preference.
 *  - Only the status code and a sanitized 500-character diagnostic are recorded.
 *    Headers and bodies of the monitored target are never stored or logged.
 */

export interface CheckConfig {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body: string | null;
  timeoutMs: number;
  expectedStatusMin: number;
  expectedStatusMax: number;
  degradedResponseTimeMs: number | null;
}

export interface CheckOutcome {
  success: boolean;
  status: MonitorStatus;
  httpStatusCode: number | null;
  responseTimeMs: number;
  errorCategory: ErrorCategory | null;
  errorMessage: string | null;
  redirectsFollowed: number;
}

export interface CheckDependencies {
  /** Overridable for tests; defaults to the environment policy. */
  policy?: DestinationPolicy;
  dispatcher?: Dispatcher;
  /** Injected clock for tests that assert on elapsed time. */
  now?: () => number;
  maxResponseBytes?: number;
}

function defaultPolicy(): DestinationPolicy {
  return {
    blockPrivateNetworks: env.BLOCK_PRIVATE_NETWORKS,
    requireHttps: env.REQUIRE_HTTPS_TARGETS,
  };
}

let sharedDispatcher: Agent | undefined;
let sharedDispatcherPolicy: DestinationPolicy | undefined;

/**
 * A single outbound agent shared by every check. It installs the guarded DNS
 * lookup, so the address validated is the address connected to.
 */
export function getOutboundDispatcher(policy: DestinationPolicy = defaultPolicy()): Agent {
  const samePolicy =
    sharedDispatcherPolicy &&
    sharedDispatcherPolicy.blockPrivateNetworks === policy.blockPrivateNetworks;

  if (!sharedDispatcher || !samePolicy) {
    sharedDispatcher = new Agent({
      connect: {
        lookup: createGuardedLookup(policy),
        timeout: limits.maxTimeoutMs,
      },
      connections: Math.max(4, limits.checkConcurrency * 2),
      pipelining: 1,
      keepAliveTimeout: 10_000,
    });
    sharedDispatcherPolicy = policy;
  }

  return sharedDispatcher;
}

export async function closeOutboundDispatcher(): Promise<void> {
  if (sharedDispatcher) {
    await sharedDispatcher.close().catch(() => undefined);
    sharedDispatcher = undefined;
    sharedDispatcherPolicy = undefined;
  }
}

interface CategorizedError {
  category: ErrorCategory;
  message: string;
}

/** Map a thrown error to a stable category plus a sanitized message. */
export function categorizeError(error: unknown): CategorizedError {
  if (error instanceof BlockedDestinationError) {
    return { category: 'BLOCKED_DESTINATION', message: sanitizeDiagnostic(error.message) };
  }

  const code = (error as NodeJS.ErrnoException | undefined)?.code ?? '';
  const name = (error as Error | undefined)?.name ?? '';
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = sanitizeDiagnostic(rawMessage);

  // Raised by the body-size guard below, before any network category applies.
  if (code === 'RESPONSE_TOO_LARGE') {
    return { category: 'RESPONSE_TOO_LARGE', message };
  }

  if (
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'EAI_NODATA' ||
    name === 'DnsResolutionError'
  ) {
    return { category: 'DNS', message };
  }
  if (
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT' ||
    code === 'ABORT_ERR'
  ) {
    return { category: 'TIMEOUT', message };
  }
  if (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    code === 'EPIPE' ||
    code === 'EADDRNOTAVAIL' ||
    code === 'UND_ERR_SOCKET' ||
    code === 'UND_ERR_ABORTED'
  ) {
    return { category: 'CONNECT', message };
  }
  if (
    code.startsWith('ERR_TLS') ||
    code.startsWith('ERR_SSL') ||
    /certificate|self[-\s]?signed|tls|ssl|handshake/i.test(`${code} ${rawMessage}`)
  ) {
    return { category: 'TLS', message };
  }
  if (code === 'ERR_INVALID_URL' || name === 'TypeError') {
    return { category: 'INVALID_URL', message };
  }
  if (
    code.startsWith('UND_ERR') ||
    code.startsWith('HPE_') ||
    code === 'ERR_HTTP_INVALID_HEADER_VALUE'
  ) {
    return { category: 'PROTOCOL', message };
  }

  return { category: 'UNKNOWN', message: message || 'Request failed' };
}

interface SingleRequestResult {
  statusCode: number;
  location: string | null;
  headers: Record<string, string | string[] | undefined>;
}

async function sendRequest(
  url: URL,
  config: CheckConfig,
  dispatcher: Dispatcher,
  signal: AbortSignal,
  limit: number,
): Promise<SingleRequestResult> {
  const hasBody = config.body !== null && METHODS_WITH_BODY.includes(config.method);

  const headers: Record<string, string> = {
    // A descriptive User-Agent makes the traffic identifiable to operators.
    'user-agent': 'PulseCheck/0.1 (+https://github.com/pulsecheck)',
    accept: '*/*',
    ...(hasBody ? { 'content-type': 'text/plain; charset=utf-8' } : {}),
    // Operator-supplied headers win over the defaults above. Forbidden and
    // malformed names were rejected at configuration time.
    ...config.headers,
  };

  const response = await request(url, {
    method: config.method,
    headers,
    ...(hasBody ? { body: config.body as string } : {}),
    signal,
    dispatcher,
    // `undici.request` never follows redirects unless a redirect interceptor is
    // installed, so every hop is validated by the SSRF policy in `performCheck`.
  });

  const expectedLength = Number(response.headers['content-length'] ?? '0');
  if (Number.isFinite(expectedLength) && expectedLength > limit) {
    response.body.destroy();
    const error = new Error(
      `response declared ${expectedLength} bytes, over the ${limit} byte limit`,
    ) as NodeJS.ErrnoException;
    error.code = 'RESPONSE_TOO_LARGE';
    throw error;
  }

  let received = 0;
  for await (const chunk of response.body) {
    received += chunk.length;
    if (received > limit) {
      response.body.destroy();
      const error = new Error(`response exceeded the ${limit} byte limit`) as NodeJS.ErrnoException;
      error.code = 'RESPONSE_TOO_LARGE';
      throw error;
    }
  }

  const rawLocation = response.headers.location;
  return {
    statusCode: response.statusCode,
    location: Array.isArray(rawLocation) ? (rawLocation[0] ?? null) : (rawLocation ?? null),
    headers: response.headers,
  };
}

/** Methods that become GET after a 301/302/303 redirect. */
function redirectMethod(method: HttpMethod, statusCode: number): HttpMethod {
  if (statusCode === 303) return 'GET';
  if ((statusCode === 301 || statusCode === 302) && method === 'POST') return 'GET';
  return method;
}

/**
 * Run one health check.
 *
 * Never throws for target-side problems: a failure is a result with
 * `success: false` and an error category, which is what gets recorded.
 */
export async function performCheck(
  config: CheckConfig,
  dependencies: CheckDependencies = {},
): Promise<CheckOutcome> {
  const policy = dependencies.policy ?? defaultPolicy();
  const dispatcher = dependencies.dispatcher ?? getOutboundDispatcher(policy);
  const now = dependencies.now ?? (() => performance.now());
  const maxResponseBytes = dependencies.maxResponseBytes ?? limits.maxResponseBytes;

  const started = now();
  let redirectsFollowed = 0;
  let httpStatusCode: number | null = null;

  const finish = (
    outcome: Omit<CheckOutcome, 'responseTimeMs' | 'status' | 'redirectsFollowed'> &
      Partial<Pick<CheckOutcome, 'status'>>,
  ): CheckOutcome => {
    const responseTimeMs = Math.max(0, Math.round(now() - started));
    const status = outcome.status
      ? outcome.status
      : statusFromOutcome({
          success: outcome.success,
          responseTimeMs,
          errorCategory: outcome.errorCategory,
          degradedResponseTimeMs: config.degradedResponseTimeMs,
        });
    return { ...outcome, status, responseTimeMs, redirectsFollowed };
  };

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.timeoutMs);

  try {
    let currentUrl = assertUrlAllowed(config.url, policy);
    let method = config.method;
    let body = config.body;

    for (let hop = 0; hop <= limits.maxRedirects; hop += 1) {
      // Pre-flight resolution: fail fast and with a clearer message than a
      // socket-level error, and validate every redirect hop before connecting.
      await resolveDestination(currentUrl.hostname, policy);

      const response = await sendRequest(
        currentUrl,
        { ...config, method, body },
        dispatcher,
        controller.signal,
        maxResponseBytes,
      );

      httpStatusCode = response.statusCode;

      const isRedirect = response.statusCode >= 300 && response.statusCode < 400;
      if (isRedirect && response.location) {
        if (hop === limits.maxRedirects) {
          return finish({
            success: false,
            httpStatusCode,
            errorCategory: 'TOO_MANY_REDIRECTS',
            errorMessage: sanitizeDiagnostic(
              `stopped after ${limits.maxRedirects} redirects (last hop ${currentUrl.hostname})`,
            ),
          });
        }

        let nextUrl: URL;
        try {
          nextUrl = new URL(response.location, currentUrl);
        } catch {
          return finish({
            success: false,
            httpStatusCode,
            errorCategory: 'PROTOCOL',
            errorMessage: 'redirect target is not a valid URL',
          });
        }

        redirectsFollowed += 1;
        method = redirectMethod(method, response.statusCode);
        if (method === 'GET') body = null;
        // assertUrlAllowed runs again on the next loop iteration via the policy
        // checks below, so a redirect into a private range is refused.
        currentUrl = assertUrlAllowed(nextUrl.toString(), policy);
        continue;
      }

      const inRange =
        response.statusCode >= config.expectedStatusMin &&
        response.statusCode <= config.expectedStatusMax;

      if (!inRange) {
        return finish({
          success: false,
          httpStatusCode,
          errorCategory: 'UNEXPECTED_STATUS',
          errorMessage: sanitizeDiagnostic(
            `expected ${config.expectedStatusMin}-${config.expectedStatusMax}, received ${response.statusCode}`,
          ),
        });
      }

      return finish({ success: true, httpStatusCode, errorCategory: null, errorMessage: null });
    }

    return finish({
      success: false,
      httpStatusCode,
      errorCategory: 'TOO_MANY_REDIRECTS',
      errorMessage: sanitizeDiagnostic(`stopped after ${limits.maxRedirects} redirects`),
    });
  } catch (error) {
    if (timedOut) {
      return finish({
        success: false,
        httpStatusCode,
        errorCategory: 'TIMEOUT',
        errorMessage: sanitizeDiagnostic(`no response within ${config.timeoutMs} ms`),
      });
    }

    const { category, message } = categorizeError(error);

    if (category === 'UNKNOWN') {
      // Unknown failures are logged with structure (never the payload) so they
      // can be categorised later without losing the check.
      logger.debug({ code: (error as NodeJS.ErrnoException)?.code }, 'unclassified check failure');
    }

    return finish({
      success: false,
      httpStatusCode,
      errorCategory: category,
      errorMessage: message,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Policy used by tests that monitor a loopback mock server. Deliberately not
 * applied anywhere in production code paths.
 */
export function testPolicy(): DestinationPolicy {
  return { blockPrivateNetworks: false, requireHttps: false };
}

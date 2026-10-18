/**
 * Monitor status model.
 *
 * PulseCheck derives a monitor's status from the outcome of its most recent
 * completed check. The rules are defined here once so the API, the worker and
 * the UI cannot drift apart.
 *
 *   PENDING  - the monitor exists but no check has completed yet.
 *   HEALTHY  - the latest check received an HTTP response that matched the
 *              configured expectations and was not slower than the optional
 *              degraded-response-time threshold.
 *   DEGRADED - the target responded with HTTP, but the response did not match
 *              the configured expectations (e.g. HTTP 500 when 2xx was
 *              expected) or the response was slower than the configured
 *              degraded threshold. The target is reachable but unhealthy.
 *   DOWN     - the request never produced a usable HTTP response: DNS failure,
 *              connection refused/reset, TLS failure, timeout, too many
 *              redirects, blocked destination, or an oversized response.
 *   PAUSED   - monitoring is intentionally disabled by the user.
 */

export const MONITOR_STATUSES = ['PENDING', 'HEALTHY', 'DEGRADED', 'DOWN', 'PAUSED'] as const;
export type MonitorStatus = (typeof MONITOR_STATUSES)[number];

/**
 * Failure categories that mean "no usable HTTP response was received".
 * These map to DOWN. Every other failure category maps to DEGRADED because the
 * target did answer over HTTP.
 */
export const DOWN_ERROR_CATEGORIES = [
  'DNS',
  'CONNECT',
  'TLS',
  'TIMEOUT',
  'TOO_MANY_REDIRECTS',
  'RESPONSE_TOO_LARGE',
  'BLOCKED_DESTINATION',
  'INVALID_URL',
  'PROTOCOL',
  'UNKNOWN',
] as const;

/** Failure categories that are recorded when an HTTP response was received. */
export const DEGRADED_ERROR_CATEGORIES = ['UNEXPECTED_STATUS'] as const;

export type ErrorCategory =
  (typeof DOWN_ERROR_CATEGORIES)[number] | (typeof DEGRADED_ERROR_CATEGORIES)[number];

export const ERROR_CATEGORIES: readonly ErrorCategory[] = [
  ...DOWN_ERROR_CATEGORIES,
  ...DEGRADED_ERROR_CATEGORIES,
] as const;

export const ERROR_CATEGORY_LABELS: Record<ErrorCategory, string> = {
  DNS: 'DNS resolution failed',
  CONNECT: 'Connection failed',
  TLS: 'TLS handshake failed',
  TIMEOUT: 'Request timed out',
  TOO_MANY_REDIRECTS: 'Too many redirects',
  RESPONSE_TOO_LARGE: 'Response body too large',
  BLOCKED_DESTINATION: 'Destination blocked by outbound policy',
  INVALID_URL: 'URL is not valid or not allowed',
  PROTOCOL: 'Protocol error',
  UNKNOWN: 'Unknown error',
  UNEXPECTED_STATUS: 'Unexpected HTTP status',
};

export function isErrorCategory(value: unknown): value is ErrorCategory {
  return typeof value === 'string' && (ERROR_CATEGORIES as readonly string[]).includes(value);
}

/** True when a category is only produced for responses that produced HTTP. */
export function isResponseReceivedCategory(category: ErrorCategory): boolean {
  return category === 'UNEXPECTED_STATUS';
}

/** Inputs required to derive a status from a single check outcome. */
export interface CheckOutcome {
  /** True only when the response matched every configured expectation. */
  success: boolean;
  /** Measured wall-clock duration of the check in milliseconds. */
  responseTimeMs: number;
  /** Present when the check failed. */
  errorCategory?: ErrorCategory | null;
  /** Optional performance threshold; slow-but-correct checks become DEGRADED. */
  degradedResponseTimeMs?: number | null;
}

/**
 * Map a single check outcome to a monitor status.
 *
 * Precedence:
 *  1. a failure whose category means "no usable HTTP response" -> DOWN
 *  2. a failure where HTTP responded but expectations failed -> DEGRADED
 *  3. a success slower than the degraded threshold -> DEGRADED
 *  4. a success within the threshold -> HEALTHY
 */
export function statusFromOutcome(outcome: CheckOutcome): MonitorStatus {
  const { success, responseTimeMs, errorCategory, degradedResponseTimeMs } = outcome;

  if (!success) {
    if (errorCategory && !isResponseReceivedCategory(errorCategory)) {
      return 'DOWN';
    }
    return 'DEGRADED';
  }

  if (
    typeof degradedResponseTimeMs === 'number' &&
    degradedResponseTimeMs > 0 &&
    responseTimeMs > degradedResponseTimeMs
  ) {
    return 'DEGRADED';
  }

  return 'HEALTHY';
}

/**
 * Status transitions that open a new incident.
 *
 * An incident opens only when a healthy (or brand-new, PENDING) monitor moves
 * into DEGRADED or DOWN. A monitor that is already DOWN or DEGRADED keeps the
 * existing incident open instead of creating one per failed check. A PAUSED
 * monitor never opens an incident because monitoring is off.
 */
export function opensIncident(previous: MonitorStatus, next: MonitorStatus): boolean {
  const wasOk = previous === 'HEALTHY' || previous === 'PENDING';
  const isBad = next === 'DOWN' || next === 'DEGRADED';
  return wasOk && isBad;
}

/**
 * Status transitions that resolve an open incident.
 *
 * A DEGRADED monitor stays degraded inside the same incident until it returns
 * to HEALTHY; a DOWN monitor likewise.
 */
export function resolvesIncident(previous: MonitorStatus, next: MonitorStatus): boolean {
  const wasBad = previous === 'DOWN' || previous === 'DEGRADED';
  return wasBad && next === 'HEALTHY';
}

/**
 * A resumed monitor returns to PENDING: monitoring is active again but the
 * status is re-derived from the next completed check. Historical results are
 * retained and still visible in the monitor timeline.
 */
export const STATUS_AFTER_RESUME: MonitorStatus = 'PENDING';

/** Human-readable label for a status, used by the UI. */
export const STATUS_LABELS: Record<MonitorStatus, string> = {
  PENDING: 'Pending',
  HEALTHY: 'Healthy',
  DEGRADED: 'Degraded',
  DOWN: 'Down',
  PAUSED: 'Paused',
};

/** Sort order used when ranking monitors by severity (worst first). */
export const STATUS_SEVERITY: Record<MonitorStatus, number> = {
  DOWN: 0,
  DEGRADED: 1,
  PENDING: 2,
  PAUSED: 3,
  HEALTHY: 4,
};

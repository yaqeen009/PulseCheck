/**
 * Platform limits and defaults.
 *
 * Every value here is a safe default. The server can override any of them from
 * environment variables (see `packages/server/src/env.ts`), and each value is
 * enforced on the server. The frontend uses the same object to render inline
 * validation messages so the form and the API agree.
 */

export interface PlatformLimits {
  /** Maximum number of monitors a single account may own. */
  maxMonitorsPerUser: number;
  /** Smallest allowed check interval. Protects targets from accidental load. */
  minIntervalSeconds: number;
  /** Largest allowed check interval (24 hours). */
  maxIntervalSeconds: number;
  defaultIntervalSeconds: number;
  /** Smallest allowed request timeout. */
  minTimeoutMs: number;
  /** Largest allowed request timeout. */
  maxTimeoutMs: number;
  defaultTimeoutMs: number;
  /** Maximum number of custom request headers per monitor. */
  maxHeaders: number;
  maxHeaderNameLength: number;
  maxHeaderValueLength: number;
  /** Maximum serialized request body size in bytes. */
  maxRequestBodyBytes: number;
  /** Maximum number of response body bytes the worker will read. */
  maxResponseBytes: number;
  /** Maximum number of redirects followed while re-validating each hop. */
  maxRedirects: number;
  /** Maximum URL length. */
  maxUrlLength: number;
  /** Maximum monitor name length. */
  maxNameLength: number;
  /** Maximum checks dispatched concurrently by a worker. */
  checkConcurrency: number;
  /** How often the scheduler looks for monitors that are due. */
  schedulerTickMs: number;
  /** How long a check may hold its per-monitor lease before another worker may claim it. */
  checkLeaseMs: number;
  /** Checks are considered abandoned after this multiple of the configured timeout. */
  leaseTimeoutFactor: number;
  /** Default number of days of check history to keep. */
  defaultRetentionDays: number;
  /** Largest configurable retention window. */
  maxRetentionDays: number;
  /** Default page size for history endpoints. */
  defaultPageSize: number;
  /** Largest accepted page size for history endpoints. */
  maxPageSize: number;
  /** Maximum email length accepted at registration. */
  maxEmailLength: number;
  /** Minimum password length accepted at registration. */
  minPasswordLength: number;
  /** Maximum password length accepted at registration. */
  maxPasswordLength: number;
}

export const DEFAULT_LIMITS: PlatformLimits = {
  maxMonitorsPerUser: 25,
  minIntervalSeconds: 30,
  maxIntervalSeconds: 86_400,
  defaultIntervalSeconds: 60,
  minTimeoutMs: 1_000,
  maxTimeoutMs: 30_000,
  defaultTimeoutMs: 10_000,
  maxHeaders: 30,
  maxHeaderNameLength: 100,
  maxHeaderValueLength: 1_000,
  maxRequestBodyBytes: 16 * 1_024,
  maxResponseBytes: 256 * 1_024,
  maxRedirects: 5,
  maxUrlLength: 2_048,
  maxNameLength: 100,
  checkConcurrency: 8,
  schedulerTickMs: 5_000,
  checkLeaseMs: 60_000,
  leaseTimeoutFactor: 2,
  defaultRetentionDays: 30,
  maxRetentionDays: 365,
  defaultPageSize: 50,
  maxPageSize: 200,
  maxEmailLength: 254,
  minPasswordLength: 10,
  maxPasswordLength: 200,
};

/** Header names a client may never supply through monitor configuration. */
export const FORBIDDEN_HEADER_NAMES: readonly string[] = [
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'expect',
  'upgrade',
  'keep-alive',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'cookie',
  'set-cookie',
];

import { z } from 'zod';
import { DEFAULT_LIMITS, FORBIDDEN_HEADER_NAMES, type PlatformLimits } from './limits.js';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Methods that may carry a request body. */
export const METHODS_WITH_BODY: readonly HttpMethod[] = ['POST', 'PUT', 'PATCH', 'DELETE'];

/** RFC 7230 header field-name token characters. */
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export const httpMethodSchema = z.enum(HTTP_METHODS);

/**
 * Validate a target URL.
 *
 * This only covers what a URL validator can cover: shape, scheme and the
 * absence of embedded credentials. It cannot stop SSRF - the server resolves
 * the hostname and re-checks every address and redirect hop before connecting.
 * See `packages/server/src/monitoring/ssrf.ts`.
 */
export function createUrlSchema(limits: PlatformLimits = DEFAULT_LIMITS) {
  return z
    .string()
    .trim()
    .min(1, 'URL is required')
    .max(limits.maxUrlLength, `URL must be at most ${limits.maxUrlLength} characters`)
    .superRefine((value, ctx) => {
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid absolute URL' });
        return;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Only http and https URLs can be monitored',
        });
        return;
      }
      if (parsed.username || parsed.password) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'URLs with embedded credentials are not allowed',
        });
      }
      if (!parsed.hostname) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'URL must include a hostname' });
      }
    });
}

/** Custom headers must be injectable-safe: no CRLF, no hop-by-hop names. */
export function createHeadersSchema(limits: PlatformLimits = DEFAULT_LIMITS) {
  return z
    .record(z.string())
    .superRefine((headers, ctx) => {
      const entries = Object.entries(headers);
      if (entries.length > limits.maxHeaders) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `At most ${limits.maxHeaders} custom headers are allowed`,
        });
      }
      for (const [rawName, rawValue] of entries) {
        const name = rawName.trim();
        if (!HEADER_NAME_PATTERN.test(name)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Invalid header name: ${name.slice(0, 40)}`,
          });
          continue;
        }
        if (name.length > limits.maxHeaderNameLength) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Header names must be at most ${limits.maxHeaderNameLength} characters`,
          });
        }
        if (FORBIDDEN_HEADER_NAMES.includes(name.toLowerCase())) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Header "${name}" cannot be set: it is managed by the monitoring engine`,
          });
        }
        if (typeof rawValue !== 'string') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Header "${name}" must be a string`,
          });
          continue;
        }
        if (/[\r\n\0]/.test(rawValue)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Header "${name}" must not contain control characters`,
          });
        }
        if (rawValue.length > limits.maxHeaderValueLength) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Header values must be at most ${limits.maxHeaderValueLength} characters`,
          });
        }
      }
    })
    .transform((headers) => {
      // Normalize to trimmed names with trimmed values, dropping empty names.
      const normalized: Record<string, string> = {};
      for (const [name, value] of Object.entries(headers)) {
        const trimmed = name.trim();
        if (!trimmed) continue;
        normalized[trimmed] = value.trim();
      }
      return normalized;
    });
}

export interface MonitorConfigInput {
  name: string;
  url: string;
  method: HttpMethod;
  intervalSeconds: number;
  timeoutMs: number;
  expectedStatusMin: number;
  expectedStatusMax: number;
  headers: Record<string, string>;
  body: string | null;
  degradedResponseTimeMs: number | null;
}

const nameSchema = (limits: PlatformLimits) =>
  z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(limits.maxNameLength, `Name must be at most ${limits.maxNameLength} characters`);

const intervalSchema = (limits: PlatformLimits) =>
  z.coerce
    .number()
    .int('Interval must be a whole number of seconds')
    .min(
      limits.minIntervalSeconds,
      `Interval must be at least ${limits.minIntervalSeconds} seconds`,
    )
    .max(
      limits.maxIntervalSeconds,
      `Interval must be at most ${limits.maxIntervalSeconds} seconds`,
    );

const timeoutSchema = (limits: PlatformLimits) =>
  z.coerce
    .number()
    .int('Timeout must be a whole number of milliseconds')
    .min(limits.minTimeoutMs, `Timeout must be at least ${limits.minTimeoutMs} ms`)
    .max(limits.maxTimeoutMs, `Timeout must be at most ${limits.maxTimeoutMs} ms`);

const statusCodeSchema = z.coerce
  .number()
  .int('Status codes must be whole numbers')
  .min(100, 'Status codes start at 100')
  .max(599, 'Status codes end at 599');

const bodySchema = (limits: PlatformLimits) =>
  z
    .string()
    .max(
      limits.maxRequestBodyBytes,
      `Request body must be at most ${limits.maxRequestBodyBytes} bytes`,
    )
    .nullable()
    .optional()
    .transform((value) => (value === undefined || value === '' ? null : value));

/**
 * Patch variant: `undefined` means "leave unchanged", `null` means "remove".
 * The create variant normalises an omitted body to `null`; a PATCH must not,
 * otherwise every unrelated update would wipe the stored body.
 */
const patchBodySchema = (limits: PlatformLimits) =>
  z
    .string()
    .max(
      limits.maxRequestBodyBytes,
      `Request body must be at most ${limits.maxRequestBodyBytes} bytes`,
    )
    .nullable()
    .optional();

const degradedResponseTimeSchema = (limits: PlatformLimits) =>
  z.coerce
    .number()
    .int('Degraded threshold must be a whole number of milliseconds')
    .min(1, 'Degraded threshold must be positive')
    .max(limits.maxTimeoutMs, `Degraded threshold must be at most ${limits.maxTimeoutMs} ms`)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? null : value));

/** Patch variant: keep `undefined` distinct from `null` (remove the threshold). */
const patchDegradedResponseTimeSchema = (limits: PlatformLimits) =>
  z.coerce
    .number()
    .int('Degraded threshold must be a whole number of milliseconds')
    .min(1, 'Degraded threshold must be positive')
    .max(limits.maxTimeoutMs, `Degraded threshold must be at most ${limits.maxTimeoutMs} ms`)
    .nullable()
    .optional();

function applyMethodRefinements<T extends z.ZodTypeAny>(schema: T, _limits: PlatformLimits) {
  return schema.superRefine((value: unknown, ctx: z.RefinementCtx) => {
    const input = value as MonitorConfigInput;
    if (input.expectedStatusMin > input.expectedStatusMax) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expectedStatusMax'],
        message: 'Maximum status code must be greater than or equal to the minimum',
      });
    }
    if (input.body && !METHODS_WITH_BODY.includes(input.method)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['body'],
        message: `A request body is not supported for ${input.method} requests`,
      });
    }
    if (input.degradedResponseTimeMs !== null && input.degradedResponseTimeMs > input.timeoutMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['degradedResponseTimeMs'],
        message: 'Degraded threshold cannot exceed the request timeout',
      });
    }
  });
}

/** Schema for creating a monitor. Unknown keys are rejected. */
export function createMonitorCreateSchema(limits: PlatformLimits = DEFAULT_LIMITS) {
  const base = z
    .object({
      name: nameSchema(limits),
      url: createUrlSchema(limits),
      method: httpMethodSchema.default('GET'),
      intervalSeconds: intervalSchema(limits).default(limits.defaultIntervalSeconds),
      timeoutMs: timeoutSchema(limits).default(limits.defaultTimeoutMs),
      expectedStatusMin: statusCodeSchema.default(200),
      expectedStatusMax: statusCodeSchema.default(299),
      headers: createHeadersSchema(limits).default({}),
      body: bodySchema(limits),
      degradedResponseTimeMs: degradedResponseTimeSchema(limits),
      enabled: z.boolean().default(true),
    })
    .strict();
  return applyMethodRefinements(base, limits);
}

/** Schema for updating a monitor: every field optional, no body/headers surprises. */
export function createMonitorUpdateSchema(limits: PlatformLimits = DEFAULT_LIMITS) {
  const base = z
    .object({
      name: nameSchema(limits).optional(),
      url: createUrlSchema(limits).optional(),
      method: httpMethodSchema.optional(),
      intervalSeconds: intervalSchema(limits).optional(),
      timeoutMs: timeoutSchema(limits).optional(),
      expectedStatusMin: statusCodeSchema.optional(),
      expectedStatusMax: statusCodeSchema.optional(),
      headers: createHeadersSchema(limits).optional(),
      body: patchBodySchema(limits),
      degradedResponseTimeMs: patchDegradedResponseTimeSchema(limits),
      enabled: z.boolean().optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (Object.keys(value).length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Provide at least one field to update',
        });
      }
    });

  return base as unknown as ReturnType<typeof applyMethodRefinements<typeof base>>;
}

/**
 * Guard used by the update path once the merged (existing + patch) monitor is
 * known. The create schema's cross-field rules are re-checked against the
 * merged configuration so a patch cannot produce an invalid monitor.
 */
export function validateMergedMonitorConfig(
  merged: MonitorConfigInput,
  limits: PlatformLimits = DEFAULT_LIMITS,
): string[] {
  const errors: string[] = [];
  if (merged.expectedStatusMin > merged.expectedStatusMax) {
    errors.push('Maximum status code must be greater than or equal to the minimum');
  }
  if (merged.body && !METHODS_WITH_BODY.includes(merged.method)) {
    errors.push(`A request body is not supported for ${merged.method} requests`);
  }
  if (merged.degradedResponseTimeMs !== null && merged.degradedResponseTimeMs > merged.timeoutMs) {
    errors.push('Degraded threshold cannot exceed the request timeout');
  }
  if (merged.timeoutMs > limits.maxTimeoutMs) {
    errors.push(`Timeout must be at most ${limits.maxTimeoutMs} ms`);
  }
  if (merged.intervalSeconds < limits.minIntervalSeconds) {
    errors.push(`Interval must be at least ${limits.minIntervalSeconds} seconds`);
  }
  return errors;
}

export const authEmailSchema = (limits: PlatformLimits = DEFAULT_LIMITS) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'Email is required')
    .max(limits.maxEmailLength, `Email must be at most ${limits.maxEmailLength} characters`)
    .email('Enter a valid email address');

export const authPasswordSchema = (limits: PlatformLimits = DEFAULT_LIMITS) =>
  z
    .string()
    .min(
      limits.minPasswordLength,
      `Password must be at least ${limits.minPasswordLength} characters`,
    )
    .max(
      limits.maxPasswordLength,
      `Password must be at most ${limits.maxPasswordLength} characters`,
    );

export function createRegisterSchema(limits: PlatformLimits = DEFAULT_LIMITS) {
  return z
    .object({
      email: authEmailSchema(limits),
      password: authPasswordSchema(limits),
    })
    .strict();
}

export function createLoginSchema(limits: PlatformLimits = DEFAULT_LIMITS) {
  return z
    .object({
      email: authEmailSchema(limits),
      // Login only checks shape; rejections must not reveal policy details.
      password: z.string().min(1, 'Password is required').max(limits.maxPasswordLength),
    })
    .strict();
}

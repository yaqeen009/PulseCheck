import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { z } from 'zod';
import { DEFAULT_LIMITS, type PlatformLimits } from '@pulsecheck/shared';

/**
 * Environment loading and validation.
 *
 * The repository keeps a single `.env` at the project root (git-ignored). A
 * package-local `packages/server/.env` may override nothing by default - it is
 * loaded first so root values still win - and real environment variables always
 * win over both, which is what production relies on.
 */
const serverDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(serverDir, '../..');

// Real environment variables take precedence; dotenv never overwrites them.
loadDotenv({ path: path.join(serverDir, '.env') });
loadDotenv({ path: path.join(repoRoot, '.env') });

const booleanish = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return defaultValue;
      return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
    });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),

  WEB_ORIGIN: z.string().trim().default('http://localhost:5273'),
  CORS_ORIGINS: z.string().trim().default(''),
  TRUST_PROXY: booleanish(false),

  DATABASE_URL: z
    .string()
    .min(1)
    .refine((value) => /^postgres(ql)?:\/\//.test(value), 'DATABASE_URL must be a postgres:// URL'),

  NEON_AUTH_BASE_URL: z.string().trim().url(),
  NEON_AUTH_JWKS_URL: z.string().trim().url().optional(),

  SCHEDULER_ENABLED: booleanish(true),
  WORKER_ENABLED: booleanish(true),
  BLOCK_PRIVATE_NETWORKS: booleanish(true),
  REQUIRE_HTTPS_TARGETS: booleanish(false),

  RATE_LIMIT_API_MAX: z.coerce.number().int().min(1).default(300),
  RATE_LIMIT_API_WINDOW_MINUTES: z.coerce.number().int().min(1).default(1),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: booleanish(false),

  // Optional limit overrides (see packages/shared/src/limits.ts).
  MAX_MONITORS_PER_USER: z.coerce.number().int().min(1).optional(),
  MIN_INTERVAL_SECONDS: z.coerce.number().int().min(10).optional(),
  MAX_TIMEOUT_MS: z.coerce.number().int().min(1_000).optional(),
  CHECK_CONCURRENCY: z.coerce.number().int().min(1).max(64).optional(),
  RETENTION_DAYS: z.coerce.number().int().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    // Config errors must read cleanly in platform logs; the stack adds nothing.
    Error.stackTraceLimit = 0;
    throw new Error(
      `Invalid environment configuration:\n${details}\n\n` +
        'Copy .env.example to .env at the project root and fill in the required values.',
    );
  }
  return result.data;
}

export const env: Env = parseEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/**
 * Production must never fall back to a localhost CORS origin: that would make a
 * misconfigured deploy silently reject the real frontend (or, worse, admit a
 * local process). Localhost origins stay available in development and tests.
 *
 * Called by the API entry point (`createApp`), not at module load, because the
 * monitoring worker imports this module too and has no CORS origin at all.
 */
export function assertProductionWebOrigin(): void {
  if (!isProduction) return;
  if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(env.WEB_ORIGIN)) return;

  // Config errors must read cleanly in platform logs; the stack adds nothing.
  Error.stackTraceLimit = 0;
  throw new Error(
    'Invalid environment configuration:\n' +
      '  - WEB_ORIGIN: localhost is not allowed when NODE_ENV=production.\n\n' +
      'Set WEB_ORIGIN to the deployed frontend origin, e.g. https://pulsecheck.vercel.app.',
  );
}

/**
 * Origin of the Neon Auth service (scheme + host, path stripped). Neon Auth
 * issues JWTs whose `iss` and `aud` both equal this value.
 */
export const neonAuthIssuer = new URL(env.NEON_AUTH_BASE_URL).origin;

/**
 * JWKS endpoint used to verify Neon Auth tokens. Falls back to the
 * well-known path under `NEON_AUTH_BASE_URL` when not set explicitly.
 */
export const neonAuthJwksUrl =
  env.NEON_AUTH_JWKS_URL ?? `${env.NEON_AUTH_BASE_URL.replace(/\/$/, '')}/.well-known/jwks.json`;

/** Extra origins allowed to call the API, beyond `WEB_ORIGIN`. */
export const extraCorsOrigins: string[] = env.CORS_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const allowedOrigins: string[] = [env.WEB_ORIGIN, ...extraCorsOrigins];

/** Platform limits, with environment overrides applied. */
export const limits: PlatformLimits = {
  ...DEFAULT_LIMITS,
  ...(env.MAX_MONITORS_PER_USER !== undefined
    ? { maxMonitorsPerUser: env.MAX_MONITORS_PER_USER }
    : {}),
  ...(env.MIN_INTERVAL_SECONDS !== undefined
    ? { minIntervalSeconds: env.MIN_INTERVAL_SECONDS }
    : {}),
  ...(env.MAX_TIMEOUT_MS !== undefined ? { maxTimeoutMs: env.MAX_TIMEOUT_MS } : {}),
  ...(env.CHECK_CONCURRENCY !== undefined ? { checkConcurrency: env.CHECK_CONCURRENCY } : {}),
  ...(env.RETENTION_DAYS !== undefined ? { defaultRetentionDays: env.RETENTION_DAYS } : {}),
};

if (limits.minIntervalSeconds > limits.maxIntervalSeconds) {
  throw new Error('MIN_INTERVAL_SECONDS cannot exceed MAX_INTERVAL_SECONDS (86400)');
}
if (DEFAULT_LIMITS.minTimeoutMs > limits.maxTimeoutMs) {
  throw new Error(`MAX_TIMEOUT_MS cannot be lower than ${DEFAULT_LIMITS.minTimeoutMs}`);
}

export const SERVICE_NAME = 'pulsecheck-api';

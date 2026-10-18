import { Router } from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_LIMITS, TIME_WINDOW_BUCKETS, TIME_WINDOWS } from '@pulsecheck/shared';
import { limits } from '../env.js';

/**
 * Platform metadata for the UI.
 *
 * The client reads limits from here instead of hardcoding them, so a deployment
 * that raises `MIN_INTERVAL_SECONDS` immediately renders the right validation
 * messages without a frontend release.
 */
export const metaRouter: Router = Router();

function readVersion(): string {
  try {
    const packagePath = path.resolve(import.meta.dirname, '../../package.json');
    const parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: string };
    return parsed.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const APP_VERSION = readVersion();

metaRouter.get('/limits', (_request, response) => {
  response.status(200).json({
    version: APP_VERSION,
    limits,
    defaults: {
      intervalSeconds: DEFAULT_LIMITS.defaultIntervalSeconds,
      timeoutMs: DEFAULT_LIMITS.defaultTimeoutMs,
      expectedStatusMin: 200,
      expectedStatusMax: 299,
    },
    timeWindows: TIME_WINDOWS,
    timeWindowBuckets: TIME_WINDOW_BUCKETS,
  });
});

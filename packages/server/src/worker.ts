#!/usr/bin/env node
/**
 * Standalone monitoring worker.
 *
 * Runs only the scheduling engine — no HTTP listener — so scheduled checks keep
 * running while the API service redeploys, restarts or scales. Run as a
 * separate Render background worker (see `render.yaml` and docs/DEPLOYMENT.md).
 *
 * Duplicate schedulers cannot double-execute work: the PostgreSQL advisory lock
 * in `monitoring/scheduler.ts` admits exactly one dispatcher, and every check
 * additionally claims a row lease on its monitor.
 *
 *   npm run build && node dist/worker.js
 */
import { env } from './env.js';
import { logger } from './logger.js';
import { startMonitoring, type MonitoringHandle } from './monitoring/index.js';
import { disconnectDatabase } from './db.js';
import { installShutdownHandlers } from './lifecycle.js';

async function main(): Promise<void> {
  if (!env.SCHEDULER_ENABLED) {
    logger.warn('SCHEDULER_ENABLED=false: nothing to do, exiting');
    return;
  }

  const monitoring: MonitoringHandle = await startMonitoring();

  logger.info(
    { env: env.NODE_ENV, scheduler: monitoring.scheduler !== null },
    'PulseCheck worker started',
  );

  installShutdownHandlers({
    stopMonitoring: () => monitoring.stop(),
    closeDatabase: () => disconnectDatabase(),
  });
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'failed to start the PulseCheck worker');
  process.exit(1);
});

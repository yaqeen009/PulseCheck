import { env } from '../env.js';
import { logger } from '../logger.js';
import { MonitorScheduler } from './scheduler.js';
import { closeOutboundDispatcher } from './checker.js';

export interface MonitoringHandle {
  scheduler: MonitorScheduler | null;
  stop: () => Promise<void>;
}

/**
 * Start the monitoring engine for this process.
 *
 * `SCHEDULER_ENABLED` decides whether this instance runs the scheduling loop.
 * Because checks run in-process, a deployment that scales horizontally should
 * still run the scheduler in a single instance (the advisory lock enforces this
 * even if it is enabled everywhere).
 */
export async function startMonitoring(): Promise<MonitoringHandle> {
  if (!env.SCHEDULER_ENABLED) {
    logger.info('monitoring engine disabled (SCHEDULER_ENABLED=false)');
    return { scheduler: null, stop: async () => undefined };
  }

  if (!env.WORKER_ENABLED) {
    logger.warn(
      'SCHEDULER_ENABLED=true with WORKER_ENABLED=false: due monitors will be claimed but not executed. ' +
        'Enable the worker on the scheduler instance, or run a separate worker fleet.',
    );
  }

  const scheduler = new MonitorScheduler();
  await scheduler.start();

  return {
    scheduler,
    stop: async () => {
      await scheduler.stop();
      await closeOutboundDispatcher();
    },
  };
}

export { MonitorScheduler } from './scheduler.js';
export { executeAndRecordCheck, runCheckForMonitor, pruneOldCheckResults } from './worker.js';
export { performCheck } from './checker.js';
export {
  BlockedDestinationError,
  assertUrlAllowed,
  classifyIpAddress,
  resolveDestination,
  createGuardedLookup,
  sanitizeDiagnostic,
} from './ssrf.js';

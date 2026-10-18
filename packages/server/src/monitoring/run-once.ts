#!/usr/bin/env tsx
/**
 * Run a single check for one monitor and print the outcome.
 *
 *   npm run worker:once -- <monitorId>
 *
 * Useful for debugging a monitor without waiting for its interval, and used by
 * the monitoring integration tests.
 */
import { logger } from '../logger.js';
import { disconnectDatabase } from '../db.js';
import { runCheckForMonitor } from '../monitoring/worker.js';
import { closeOutboundDispatcher } from '../monitoring/checker.js';

async function main(): Promise<void> {
  const monitorId = process.argv[2];
  if (!monitorId) {
    console.error('Usage: npm run worker:once -- <monitorId>');
    process.exitCode = 1;
    return;
  }

  const result = await runCheckForMonitor(monitorId);
  if (!result) {
    console.log('No check executed (monitor missing, paused, or already leased).');
    return;
  }

  console.log(
    JSON.stringify(
      {
        monitorId: result.monitorId,
        status: result.status,
        success: result.success,
        httpStatusCode: result.httpStatusCode,
        responseTimeMs: result.responseTimeMs,
        errorCategory: result.errorCategory,
        errorMessage: result.errorMessage,
        redirectsFollowed: result.redirectsFollowed,
        incidentOpened: result.incidentOpened,
        incidentResolved: result.incidentResolved,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error: unknown) => {
    logger.error({ err: error }, 'worker:once failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeOutboundDispatcher();
    await disconnectDatabase();
  });

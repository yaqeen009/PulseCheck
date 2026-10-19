import { logger } from './logger.js';

export interface ShutdownSteps {
  /** Stop accepting new HTTP connections. */
  stopHttp?: () => Promise<void>;
  /** Stop the monitoring engine and release the scheduler advisory lock. */
  stopMonitoring?: () => Promise<void>;
  /** Close the database connection pool. */
  closeDatabase?: () => Promise<void>;
}

const FORCE_EXIT_MS = 20_000;

/**
 * Wire SIGTERM/SIGINT to an ordered, bounded shutdown.
 *
 * Render stops a process by sending SIGTERM, so the HTTP server, the scheduler
 * and the database pool must all be released before the process exits —
 * otherwise an in-flight check is lost, the advisory lock lingers for the
 * lifetime of the database session, or the pool leaks into the next deploy.
 *
 * Used by both the web service (`src/index.ts`) and the standalone worker
 * (`src/worker.ts`) so their shutdown behaviour cannot drift apart.
 */
export function installShutdownHandlers(steps: ShutdownSteps): void {
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    const forceExit = setTimeout(() => {
      logger.error('graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, FORCE_EXIT_MS);
    forceExit.unref();

    try {
      await steps.stopHttp?.();
      await steps.stopMonitoring?.();
      await steps.closeDatabase?.();
      clearTimeout(forceExit);
      logger.info('shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    void shutdown('uncaughtException');
  });
}

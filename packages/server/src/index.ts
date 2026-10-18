import type { Server } from 'node:http';
import { createApp } from './app.js';
import { disconnectDatabase } from './db.js';
import { env, isProduction } from './env.js';
import { logger } from './logger.js';
import { startMonitoring, type MonitoringHandle } from './monitoring/index.js';

/**
 * Process entry point.
 *
 * Startup order: HTTP listener first (so a probe can see `live` immediately),
 * then the monitoring engine. Shutdown releases the scheduler's advisory lock,
 * stops accepting connections and closes the database pool.
 */
async function main(): Promise<void> {
  const app = createApp();
  const monitoring: MonitoringHandle = await startMonitoring();

  const server: Server = app.listen(env.PORT, () => {
    logger.info(
      {
        port: env.PORT,
        env: env.NODE_ENV,
        scheduler: monitoring.scheduler !== null,
      },
      'PulseCheck API listening',
    );
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    const forceExit = setTimeout(() => {
      logger.error('graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, 20_000);
    forceExit.unref();

    try {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      await monitoring.stop();
      await disconnectDatabase();
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

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'failed to start PulseCheck API');
  if (!isProduction) {
    console.error(error);
  }
  process.exit(1);
});

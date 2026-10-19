import type { Server } from 'node:http';
import { createApp } from './app.js';
import { disconnectDatabase } from './db.js';
import { env, isProduction } from './env.js';
import { logger } from './logger.js';
import { installShutdownHandlers } from './lifecycle.js';
import { startMonitoring, type MonitoringHandle } from './monitoring/index.js';

/**
 * Process entry point (Render web service).
 *
 * Startup order: HTTP listener first (so a probe can see `live` immediately),
 * then the monitoring engine. Shutdown releases the scheduler's advisory lock,
 * stops accepting connections and closes the database pool.
 *
 * On Render, run this service with `SCHEDULER_ENABLED=false` and let the
 * dedicated `pulsecheck-worker` background service dispatch checks instead, so
 * monitoring survives API redeploys and does not multiply with web instances.
 */
async function main(): Promise<void> {
  const app = createApp();
  const monitoring: MonitoringHandle = await startMonitoring();

  // Express binds every interface when no host is given; naming `0.0.0.0` keeps
  // the intent explicit for container platforms such as Render.
  const server: Server = app.listen(env.PORT, '0.0.0.0', () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, scheduler: monitoring.scheduler !== null },
      'PulseCheck API listening',
    );
  });

  installShutdownHandlers({
    stopHttp: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
    stopMonitoring: () => monitoring.stop(),
    closeDatabase: () => disconnectDatabase(),
  });
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'failed to start PulseCheck API');
  if (!isProduction) {
    console.error(error);
  }
  process.exit(1);
});

import { Router } from 'express';
import type { HealthDto } from '@pulsecheck/shared';
import { checkDatabaseConnection } from '../db.js';
import { APP_VERSION } from './meta.js';

/**
 * Health endpoints.
 *
 * `/health/live` answers "is this process alive" and touches nothing outside the
 * process, so a database outage cannot cause a restart loop.
 * `/health/ready` answers "can this process serve traffic" and checks PostgreSQL;
 * it returns 503 while the database is unreachable so a load balancer stops
 * routing to it.
 */
export const healthRouter: Router = Router();

const startedAt = Date.now();

healthRouter.get('/live', (_request, response) => {
  const body: HealthDto = {
    status: 'ok',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1_000),
    version: APP_VERSION,
    checks: {},
  };
  response.status(200).json(body);
});

healthRouter.get('/ready', async (_request, response) => {
  const database = await checkDatabaseConnection();
  const body: HealthDto = {
    status: database ? 'ok' : 'degraded',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1_000),
    version: APP_VERSION,
    checks: { database: database ? 'ok' : 'error' },
  };
  response.status(database ? 200 : 503).json(body);
});

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, validateQuery } from '../middleware/error-handler.js';
import {
  checkHistoryQuerySchema,
  incidentListQuerySchema,
  windowQuerySchema,
} from '../validation.js';
import {
  getMonitorResponseTimes,
  getMonitorUptime,
  listCheckResults,
  listIncidents,
  listMonitorIncidents,
} from '../services/stats-service.js';

/**
 * Monitoring history.
 *
 * Mounted twice:
 *  - `/api/v1/monitors/:id/...` for one monitor,
 *  - `/api/v1/incidents` for the account-wide incident history screen.
 */
export const monitorHistoryRouter: Router = Router({ mergeParams: true });
monitorHistoryRouter.use(requireAuth);

monitorHistoryRouter.get(
  '/checks',
  validateQuery(checkHistoryQuerySchema),
  asyncHandler(async (request, response) => {
    const monitorId = request.params.id as string;
    const query = response.locals.query as z.infer<typeof checkHistoryQuerySchema>;
    const page = await listCheckResults(request.auth!.user.id, monitorId, query);
    response.status(200).json(page);
  }),
);

monitorHistoryRouter.get(
  '/uptime',
  validateQuery(windowQuerySchema),
  asyncHandler(async (request, response) => {
    const monitorId = request.params.id as string;
    const { window } = response.locals.query as z.infer<typeof windowQuerySchema>;
    const result = await getMonitorUptime(request.auth!.user.id, monitorId, window);
    response.status(200).json(result);
  }),
);

monitorHistoryRouter.get(
  '/response-times',
  validateQuery(windowQuerySchema),
  asyncHandler(async (request, response) => {
    const monitorId = request.params.id as string;
    const { window } = response.locals.query as z.infer<typeof windowQuerySchema>;
    const result = await getMonitorResponseTimes(request.auth!.user.id, monitorId, window);
    response.status(200).json(result);
  }),
);

monitorHistoryRouter.get(
  '/incidents',
  validateQuery(incidentListQuerySchema),
  asyncHandler(async (request, response) => {
    const monitorId = request.params.id as string;
    const query = response.locals.query as z.infer<typeof incidentListQuerySchema>;
    const page = await listMonitorIncidents(request.auth!.user.id, monitorId, query);
    response.status(200).json(page);
  }),
);

/** Account-wide incident history. */
export const incidentsRouter: Router = Router();
incidentsRouter.use(requireAuth);

incidentsRouter.get(
  '/',
  validateQuery(incidentListQuerySchema),
  asyncHandler(async (request, response) => {
    const query = response.locals.query as z.infer<typeof incidentListQuerySchema>;
    const page = await listIncidents(request.auth!.user.id, query);
    response.status(200).json(page);
  }),
);

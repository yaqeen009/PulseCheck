import { Router } from 'express';
import { HTTP_METHODS, type HttpMethod, type MonitorStatus } from '@pulsecheck/shared';
import { limits } from '../env.js';
import { asyncHandler, validateBody, validateQuery } from '../middleware/error-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { idParamSchema, monitorListQuerySchema } from '../validation.js';
import { createMonitorSchema, updateMonitorSchema } from '../services/monitor-config.js';
import {
  createMonitor,
  deleteMonitor,
  getMonitorOrThrow,
  listMonitors,
  pauseMonitor,
  resumeMonitor,
  updateMonitor,
} from '../services/monitor-service.js';
import { toMonitorDto } from '../services/monitor-mapper.js';
import { z } from 'zod';

const createSchema = createMonitorSchema(limits);
const updateSchema = updateMonitorSchema(limits);

/** Validate the `:id` path parameter before it reaches a query. */
const paramsSchema = idParamSchema;

export const monitorsRouter: Router = Router();

monitorsRouter.use(requireAuth);

monitorsRouter.get(
  '/',
  validateQuery(monitorListQuerySchema),
  asyncHandler(async (request, response) => {
    const query = response.locals.query as z.infer<typeof monitorListQuerySchema>;
    const monitors = await listMonitors(request.auth!.user.id, {
      ...query,
      status: query.status as MonitorStatus | 'ALL' | undefined,
    });
    response.status(200).json({ items: monitors.map(toMonitorDto) });
  }),
);

monitorsRouter.post(
  '/',
  validateBody(createSchema),
  asyncHandler(async (request, response) => {
    const monitor = await createMonitor(
      request.auth!.user.id,
      request.body as z.infer<typeof createSchema>,
    );
    response.status(201).json({ monitor: toMonitorDto(monitor) });
  }),
);

monitorsRouter.get(
  '/:id',
  asyncHandler(async (request, response) => {
    const { id } = paramsSchema.parse(request.params);
    const monitor = await getMonitorOrThrow(request.auth!.user.id, id);
    response.status(200).json({ monitor: toMonitorDto(monitor) });
  }),
);

monitorsRouter.patch(
  '/:id',
  validateBody(updateSchema),
  asyncHandler(async (request, response) => {
    const { id } = paramsSchema.parse(request.params);
    const monitor = await updateMonitor(
      request.auth!.user.id,
      id,
      request.body as z.infer<typeof updateSchema>,
    );
    response.status(200).json({ monitor: toMonitorDto(monitor) });
  }),
);

monitorsRouter.delete(
  '/:id',
  asyncHandler(async (request, response) => {
    const { id } = paramsSchema.parse(request.params);
    await deleteMonitor(request.auth!.user.id, id);
    response.status(204).end();
  }),
);

monitorsRouter.post(
  '/:id/pause',
  asyncHandler(async (request, response) => {
    const { id } = paramsSchema.parse(request.params);
    const monitor = await pauseMonitor(request.auth!.user.id, id);
    response.status(200).json({ monitor: toMonitorDto(monitor) });
  }),
);

monitorsRouter.post(
  '/:id/resume',
  asyncHandler(async (request, response) => {
    const { id } = paramsSchema.parse(request.params);
    const monitor = await resumeMonitor(request.auth!.user.id, id);
    response.status(200).json({ monitor: toMonitorDto(monitor) });
  }),
);

/** Supported HTTP methods, for the create/edit forms. */
monitorsRouter.get('/meta/methods', (_request, response) => {
  response.status(200).json({ methods: HTTP_METHODS satisfies readonly HttpMethod[] });
});

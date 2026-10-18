import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error-handler.js';
import { getDashboardSummary, getRecentActivity } from '../services/stats-service.js';

export const dashboardRouter: Router = Router();
dashboardRouter.use(requireAuth);

/**
 * Dashboard summary. Every value is computed from stored check results; a new
 * account receives zeroes and `uptimePercent: null` (never a fabricated number).
 */
dashboardRouter.get(
  '/summary',
  asyncHandler(async (request, response) => {
    const summary = await getDashboardSummary(request.auth!.user.id);
    response.status(200).json(summary);
  }),
);

dashboardRouter.get(
  '/recent-activity',
  asyncHandler(async (request, response) => {
    const activity = await getRecentActivity(request.auth!.user.id);
    response.status(200).json(activity);
  }),
);

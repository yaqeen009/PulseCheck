import { z } from 'zod';
import { MONITOR_STATUSES } from '@pulsecheck/shared';
import { DEFAULT_LIMITS, TIME_WINDOWS } from '@pulsecheck/shared';

/** Bounded pagination. `pageSize` is capped so a client cannot page 1M rows. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(DEFAULT_LIMITS.maxPageSize)
    .default(DEFAULT_LIMITS.defaultPageSize),
});

export const checkHistoryQuerySchema = paginationSchema.extend({
  success: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
});

export const monitorListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum([...MONITOR_STATUSES, 'ALL']).optional(),
  sort: z.enum(['name', 'status', 'lastCheckedAt', 'createdAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const windowQuerySchema = z.object({
  window: z.enum(TIME_WINDOWS).default('24h'),
});

export const incidentListQuerySchema = paginationSchema.extend({
  status: z.enum(['open', 'resolved', 'all']).default('all'),
});

export const idParamSchema = z.object({
  id: z.string().uuid('Monitor id must be a UUID'),
});

export type CheckHistoryQuery = z.infer<typeof checkHistoryQuerySchema>;
export type MonitorListQuery = z.infer<typeof monitorListQuerySchema>;
export type WindowQuery = z.infer<typeof windowQuerySchema>;
export type IncidentListQuery = z.infer<typeof incidentListQuerySchema>;

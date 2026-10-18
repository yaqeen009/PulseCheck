import type { z } from 'zod';
import {
  DEFAULT_LIMITS,
  createMonitorCreateSchema,
  createMonitorUpdateSchema,
  type PlatformLimits,
} from '@pulsecheck/shared';

/**
 * Monitor configuration schemas.
 *
 * These are the *same* schemas the frontend renders its form against, applied
 * with the server's configured limits. `createMonitorSchema` is the only place
 * where a monitor's shape is defined, so the API and the UI cannot drift apart.
 */
export function createMonitorSchema(limitsOverride: PlatformLimits = DEFAULT_LIMITS) {
  return createMonitorCreateSchema(limitsOverride);
}

export function updateMonitorSchema(limitsOverride: PlatformLimits = DEFAULT_LIMITS) {
  return createMonitorUpdateSchema(limitsOverride);
}

export type MonitorCreateInput = z.output<ReturnType<typeof createMonitorSchema>>;
export type MonitorUpdateInput = z.output<ReturnType<typeof updateMonitorSchema>>;

export { validateMergedMonitorConfig, type MonitorConfigInput } from '@pulsecheck/shared';

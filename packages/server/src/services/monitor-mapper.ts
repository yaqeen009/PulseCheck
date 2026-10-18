import type { Monitor } from '../generated/prisma/client.js';
import type { HttpMethod, MonitorDto, MonitorStatus } from '@pulsecheck/shared';

/** Map a stored monitor row to the API representation (ISO timestamps). */
export function toMonitorDto(monitor: Monitor): MonitorDto {
  return {
    id: monitor.id,
    userId: monitor.userId,
    name: monitor.name,
    url: monitor.url,
    method: monitor.method as HttpMethod,
    intervalSeconds: monitor.intervalSeconds,
    timeoutMs: monitor.timeoutMs,
    expectedStatusMin: monitor.expectedStatusMin,
    expectedStatusMax: monitor.expectedStatusMax,
    headers: normalizeHeaders(monitor.headers),
    body: monitor.body,
    degradedResponseTimeMs: monitor.degradedResponseTimeMs,
    enabled: monitor.enabled,
    status: monitor.status as MonitorStatus,
    lastCheckedAt: monitor.lastCheckedAt?.toISOString() ?? null,
    lastStatusChangeAt: monitor.lastStatusChangeAt?.toISOString() ?? null,
    consecutiveFailures: monitor.consecutiveFailures,
    nextCheckAt: monitor.nextCheckAt.toISOString(),
    createdAt: monitor.createdAt.toISOString(),
    updatedAt: monitor.updatedAt.toISOString(),
  };
}

/** Stored JSON headers are untrusted: keep only string values. */
export function normalizeHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const headers: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') headers[key] = raw;
  }
  return headers;
}

/** Expected status range as display text, e.g. "200-299" or "204". */
export function describeExpectedStatus(min: number, max: number): string {
  return min === max ? String(min) : `${min}-${max}`;
}

export function isStatusInRange(status: number, min: number, max: number): boolean {
  return status >= min && status <= max;
}

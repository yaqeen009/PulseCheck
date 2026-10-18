import type { ErrorCategory, MonitorStatus } from './status.js';
import type { HttpMethod } from './monitor.js';
import type { TimeWindow } from './windows.js';
import type { UptimeStats } from './uptime.js';

/** Versioned API namespace. Every route below lives under this prefix. */
export const API_PREFIX = '/api/v1';

/**
 * Error envelope returned by every failed request. `code` is a stable,
 * machine-readable identifier; `message` is safe to display; `details` carries
 * field-level validation issues for form rendering.
 */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'LIMIT_EXCEEDED'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE';

/** Field-level validation detail attached to a VALIDATION_ERROR. */
export interface ValidationIssue {
  path: string;
  message: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface UserDto {
  id: string;
  email: string;
  createdAt: string;
}

/**
 * `GET /auth/me` resolves the caller's Neon Auth token against the local user
 * row. Credentials, sessions and CSRF are owned by Neon Auth (Managed Better
 * Auth); this API only ever sees a bearer token.
 */
export interface MeResponseDto {
  user: UserDto;
}

export interface MonitorDto {
  id: string;
  userId: string;
  name: string;
  url: string;
  method: HttpMethod;
  intervalSeconds: number;
  timeoutMs: number;
  expectedStatusMin: number;
  expectedStatusMax: number;
  headers: Record<string, string>;
  body: string | null;
  degradedResponseTimeMs: number | null;
  enabled: boolean;
  status: MonitorStatus;
  lastCheckedAt: string | null;
  lastStatusChangeAt: string | null;
  consecutiveFailures: number;
  nextCheckAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CheckResultDto {
  id: string;
  monitorId: string;
  checkedAt: string;
  completedAt: string;
  success: boolean;
  httpStatusCode: number | null;
  responseTimeMs: number;
  errorCategory: ErrorCategory | null;
  errorMessage: string | null;
}

export interface MonitorActivityDto extends CheckResultDto {
  monitorName: string;
}

export interface IncidentDto {
  id: string;
  monitorId: string;
  monitorName?: string;
  startedAt: string;
  resolvedAt: string | null;
  initialStatus: MonitorStatus;
  peakStatus: MonitorStatus;
  latestErrorSummary: string | null;
  failedCheckCount: number;
  /** Milliseconds the incident stayed open, or null while it is ongoing. */
  durationMs: number | null;
  ongoing: boolean;
}

export interface IncidentActivityDto extends IncidentDto {
  monitorName: string;
}

export interface ResponseTimePointDto {
  /** ISO timestamp of the bucket start. */
  timestamp: string;
  avgResponseTimeMs: number | null;
  minResponseTimeMs: number | null;
  maxResponseTimeMs: number | null;
  p95ResponseTimeMs: number | null;
  checks: number;
  failures: number;
}

export interface ResponseTimesResponseDto {
  monitorId: string;
  window: TimeWindow;
  from: string;
  to: string;
  points: ResponseTimePointDto[];
}

export interface UptimeResponseDto {
  monitorId: string;
  window: TimeWindow;
  from: string;
  to: string;
  stats: UptimeStats;
}

export interface DashboardMonitorCounts {
  total: number;
  healthy: number;
  degraded: number;
  down: number;
  paused: number;
  pending: number;
}

export interface DashboardSummaryDto {
  monitors: DashboardMonitorCounts;
  uptime: {
    window: TimeWindow;
    stats: UptimeStats;
  };
  openIncidents: number;
  incidentsLast24h: number;
  checksLast24h: {
    total: number;
    failed: number;
    successRatePercent: number | null;
  };
  slowestMonitors: Array<{
    monitorId: string;
    name: string;
    avgResponseTimeMs: number;
    uptimePercent: number | null;
    status: MonitorStatus;
  }>;
}

export interface DashboardActivityDto {
  recentChecks: MonitorActivityDto[];
  recentIncidents: IncidentActivityDto[];
}

export interface ListMonitorsQuery {
  search?: string;
  status?: MonitorStatus | 'ALL';
  sort?: 'name' | 'status' | 'lastCheckedAt' | 'createdAt';
  order?: 'asc' | 'desc';
}

export interface HealthDto {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  version: string;
  checks: Record<string, 'ok' | 'error'>;
}

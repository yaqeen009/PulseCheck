import {
  TIME_WINDOW_BUCKETS,
  TIME_WINDOW_MS,
  bucketWidthMs,
  computeUptime,
  type CheckResultDto,
  type DashboardActivityDto,
  type DashboardSummaryDto,
  type IncidentDto,
  type MonitorStatus,
  type Page,
  type ResponseTimePointDto,
  type ResponseTimesResponseDto,
  type TimeWindow,
  type UptimeResponseDto,
  type UptimeStats,
} from '@pulsecheck/shared';
import type { CheckResult, Incident } from '../generated/prisma/client.js';
import { prisma } from '../db.js';
import { toMonitorDto } from './monitor-mapper.js';
import { getMonitorOrThrow } from './monitor-service.js';

/** End of the requested window (now) and its start. */
export function resolveWindow(window: TimeWindow, now: Date = new Date()) {
  const to = now;
  const from = new Date(now.getTime() - TIME_WINDOW_MS[window]);
  return { from, to };
}

interface AggregateRow {
  total: number;
  successful: number;
  responded: number;
  avg: number | null;
  min: number | null;
  max: number | null;
  p95: number | null;
}

function round(value: number | null, digits = 0): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentage(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

function rowToStats(row: AggregateRow | undefined): UptimeStats {
  if (!row || row.total === 0) {
    // Reuse the shared implementation so "no data" is represented identically
    // everywhere (null, never 0%).
    return computeUptime([]);
  }
  return {
    totalChecks: row.total,
    successfulChecks: row.successful,
    failedChecks: row.total - row.successful,
    respondedChecks: row.responded,
    uptimePercent: percentage(row.successful, row.total),
    availabilityPercent: percentage(row.responded, row.total),
    avgResponseTimeMs: round(row.avg),
    minResponseTimeMs: row.min,
    maxResponseTimeMs: row.max,
    p95ResponseTimeMs: round(row.p95),
  };
}

/**
 * Uptime for one monitor in one window.
 *
 * Aggregated in PostgreSQL: a 30-day window on a 30-second interval is ~86k
 * rows, which must not be transferred to the API process.
 */
export async function getMonitorUptime(
  userId: string,
  monitorId: string,
  window: TimeWindow,
): Promise<UptimeResponseDto> {
  const monitor = await getMonitorOrThrow(userId, monitorId);
  const { from, to } = resolveWindow(window);

  const rows = await prisma.$queryRaw<AggregateRow[]>`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE success)::int AS successful,
           count(*) FILTER (WHERE http_status_code IS NOT NULL)::int AS responded,
           avg(response_time_ms)::float8 AS avg,
           min(response_time_ms)::int AS min,
           max(response_time_ms)::int AS max,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time_ms)::float8 AS p95
    FROM check_results
    WHERE monitor_id = ${monitor.id}::uuid AND checked_at >= ${from}
  `;

  return {
    monitorId: monitor.id,
    window,
    from: from.toISOString(),
    to: to.toISOString(),
    stats: rowToStats(rows[0]),
  };
}

interface SeriesRow {
  bucket: number;
  checks: number;
  failures: number;
  avg: number | null;
  min: number | null;
  max: number | null;
  p95: number | null;
}

/**
 * Response-time series for one monitor, bucketed to a fixed number of points so
 * charts have a stable shape across windows.
 */
export async function getMonitorResponseTimes(
  userId: string,
  monitorId: string,
  window: TimeWindow,
): Promise<ResponseTimesResponseDto> {
  const monitor = await getMonitorOrThrow(userId, monitorId);
  const { from, to } = resolveWindow(window);
  const width = bucketWidthMs(window);

  const rows = await prisma.$queryRaw<SeriesRow[]>`
    SELECT floor(extract(epoch FROM (checked_at - ${from}::timestamptz)) * 1000 / ${width}::float8)::int AS bucket,
           count(*)::int AS checks,
           count(*) FILTER (WHERE NOT success)::int AS failures,
           avg(response_time_ms)::float8 AS avg,
           min(response_time_ms)::int AS min,
           max(response_time_ms)::int AS max,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time_ms)::float8 AS p95
    FROM check_results
    WHERE monitor_id = ${monitor.id}::uuid AND checked_at >= ${from}
    GROUP BY 1
    ORDER BY 1
  `;

  const byBucket = new Map<number, SeriesRow>();
  for (const row of rows) byBucket.set(row.bucket, row);

  const points: ResponseTimePointDto[] = [];
  for (let index = 0; index < TIME_WINDOW_BUCKETS[window]; index += 1) {
    const row = byBucket.get(index);
    points.push({
      timestamp: new Date(from.getTime() + index * width).toISOString(),
      avgResponseTimeMs: round(row?.avg ?? null),
      minResponseTimeMs: row?.min ?? null,
      maxResponseTimeMs: row?.max ?? null,
      p95ResponseTimeMs: round(row?.p95 ?? null),
      checks: row?.checks ?? 0,
      failures: row?.failures ?? 0,
    });
  }

  return {
    monitorId: monitor.id,
    window,
    from: from.toISOString(),
    to: to.toISOString(),
    points,
  };
}

export function toCheckResultDto(row: CheckResult): CheckResultDto {
  return {
    id: row.id,
    monitorId: row.monitorId,
    checkedAt: row.checkedAt.toISOString(),
    completedAt: row.completedAt.toISOString(),
    success: row.success,
    httpStatusCode: row.httpStatusCode,
    responseTimeMs: row.responseTimeMs,
    errorCategory: row.errorCategory,
    errorMessage: row.errorMessage,
  };
}

export function toIncidentDto(row: Incident, monitorName?: string): IncidentDto {
  const resolvedAt = row.resolvedAt;
  return {
    id: row.id,
    monitorId: row.monitorId,
    ...(monitorName ? { monitorName } : {}),
    startedAt: row.startedAt.toISOString(),
    resolvedAt: resolvedAt?.toISOString() ?? null,
    initialStatus: row.initialStatus as MonitorStatus,
    peakStatus: row.peakStatus as MonitorStatus,
    latestErrorSummary: row.latestErrorSummary,
    failedCheckCount: row.failedCheckCount,
    durationMs: resolvedAt ? resolvedAt.getTime() - row.startedAt.getTime() : null,
    ongoing: resolvedAt === null,
  };
}

export interface CheckHistoryQueryInput {
  page: number;
  pageSize: number;
  success?: boolean;
}

export async function listCheckResults(
  userId: string,
  monitorId: string,
  query: CheckHistoryQueryInput,
): Promise<Page<CheckResultDto>> {
  const monitor = await getMonitorOrThrow(userId, monitorId);
  const where = {
    monitorId: monitor.id,
    ...(query.success === undefined ? {} : { success: query.success }),
  };

  const [total, rows] = await Promise.all([
    prisma.checkResult.count({ where }),
    prisma.checkResult.findMany({
      where,
      orderBy: { checkedAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    items: rows.map(toCheckResultDto),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    hasMore: query.page * query.pageSize < total,
  };
}

export interface IncidentQueryInput {
  page: number;
  pageSize: number;
  status: 'open' | 'resolved' | 'all';
}

export async function listMonitorIncidents(
  userId: string,
  monitorId: string,
  query: IncidentQueryInput,
): Promise<Page<IncidentDto>> {
  const monitor = await getMonitorOrThrow(userId, monitorId);
  return listIncidents(userId, query, monitor.id);
}

/** Incident history, either for one monitor (monitorId) or the whole account. */
export async function listIncidents(
  userId: string,
  query: IncidentQueryInput,
  monitorId?: string,
): Promise<Page<IncidentDto>> {
  const where = {
    monitor: { userId },
    ...(monitorId ? { monitorId } : {}),
    ...(query.status === 'open' ? { resolvedAt: null } : {}),
    ...(query.status === 'resolved' ? { resolvedAt: { not: null } } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.incident.count({ where }),
    prisma.incident.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { monitor: { select: { name: true } } },
    }),
  ]);

  return {
    items: rows.map((row) => toIncidentDto(row, row.monitor.name)),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    hasMore: query.page * query.pageSize < total,
  };
}

interface CountRow {
  total: number;
  failed: number;
}

interface SlowMonitorRow {
  monitor_id: string;
  name: string;
  status: string;
  avg_ms: number | null;
  uptime_percent: number | null;
}

/**
 * Dashboard summary. Every number is derived from persisted check results; a
 * fresh account gets zeroes and null uptime, and the UI shows an empty state.
 */
export async function getDashboardSummary(userId: string): Promise<DashboardSummaryDto> {
  const window: TimeWindow = '24h';
  const { from, to } = resolveWindow(window);
  const dayAgo = new Date(to.getTime() - TIME_WINDOW_MS['24h']);

  const [statusCounts, openIncidents, incidentsLast24h, overall, last24h, slowest] =
    await Promise.all([
      prisma.monitor.groupBy({ by: ['status'], where: { userId }, _count: { _all: true } }),
      prisma.incident.count({ where: { monitor: { userId }, resolvedAt: null } }),
      prisma.incident.count({ where: { monitor: { userId }, startedAt: { gte: dayAgo } } }),
      prisma.$queryRaw<AggregateRow[]>`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE cr.success)::int AS successful,
               count(*) FILTER (WHERE cr.http_status_code IS NOT NULL)::int AS responded,
               avg(cr.response_time_ms)::float8 AS avg,
               min(cr.response_time_ms)::int AS min,
               max(cr.response_time_ms)::int AS max,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY cr.response_time_ms)::float8 AS p95
        FROM check_results cr
        JOIN monitors m ON m.id = cr.monitor_id
        WHERE m.user_id = ${userId}::uuid AND cr.checked_at >= ${from}
      `,
      prisma.$queryRaw<CountRow[]>`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE NOT cr.success)::int AS failed
        FROM check_results cr
        JOIN monitors m ON m.id = cr.monitor_id
        WHERE m.user_id = ${userId}::uuid AND cr.checked_at >= ${from}
      `,
      prisma.$queryRaw<SlowMonitorRow[]>`
        SELECT m.id::text AS monitor_id,
               m.name,
               m.current_status::text AS status,
               avg(cr.response_time_ms)::float8 AS avg_ms,
               (count(*) FILTER (WHERE cr.success))::float8 / greatest(count(*), 1) * 100 AS uptime_percent
        FROM monitors m
        JOIN check_results cr ON cr.monitor_id = m.id
        WHERE m.user_id = ${userId}::uuid AND cr.checked_at >= ${from}
        GROUP BY m.id, m.name, m.current_status
        HAVING count(*) >= 3
        ORDER BY avg_ms DESC NULLS LAST
        LIMIT 5
      `,
    ]);

  const counts = { total: 0, healthy: 0, degraded: 0, down: 0, paused: 0, pending: 0 };
  for (const row of statusCounts) {
    const count = row._count._all;
    counts.total += count;
    switch (row.status) {
      case 'HEALTHY':
        counts.healthy = count;
        break;
      case 'DEGRADED':
        counts.degraded = count;
        break;
      case 'DOWN':
        counts.down = count;
        break;
      case 'PAUSED':
        counts.paused = count;
        break;
      case 'PENDING':
        counts.pending = count;
        break;
    }
  }

  const last24hRow = last24h[0] ?? { total: 0, failed: 0 };

  return {
    monitors: counts,
    uptime: { window, stats: rowToStats(overall[0]) },
    openIncidents,
    incidentsLast24h,
    checksLast24h: {
      total: last24hRow.total,
      failed: last24hRow.failed,
      successRatePercent: percentage(last24hRow.total - last24hRow.failed, last24hRow.total),
    },
    slowestMonitors: slowest.map((row) => ({
      monitorId: row.monitor_id,
      name: row.name,
      avgResponseTimeMs: round(row.avg_ms) ?? 0,
      uptimePercent: round(row.uptime_percent, 2),
      status: row.status as MonitorStatus,
    })),
  };
}

/** Recent checks and incidents for the dashboard activity panels. */
export async function getRecentActivity(userId: string): Promise<DashboardActivityDto> {
  const [checks, incidents] = await Promise.all([
    prisma.checkResult.findMany({
      where: { monitor: { userId } },
      orderBy: { checkedAt: 'desc' },
      take: 12,
      include: { monitor: { select: { name: true } } },
    }),
    prisma.incident.findMany({
      where: { monitor: { userId } },
      orderBy: { startedAt: 'desc' },
      take: 6,
      include: { monitor: { select: { name: true } } },
    }),
  ]);

  return {
    recentChecks: checks.map((row) => ({
      ...toCheckResultDto(row),
      monitorName: row.monitor.name,
    })),
    recentIncidents: incidents.map((row) => ({
      ...toIncidentDto(row),
      monitorName: row.monitor.name,
    })),
  };
}

/** Full monitor detail payload: the monitor plus its latest check. */
export async function getMonitorDetail(userId: string, monitorId: string) {
  const monitor = await getMonitorOrThrow(userId, monitorId);
  const latestCheck = await prisma.checkResult.findFirst({
    where: { monitorId: monitor.id },
    orderBy: { checkedAt: 'desc' },
  });

  return {
    monitor: toMonitorDto(monitor),
    latestCheck: latestCheck ? toCheckResultDto(latestCheck) : null,
  };
}

import type {
  CheckResultDto,
  IncidentActivityDto,
  IncidentDto,
  Page,
  ResponseTimesResponseDto,
  TimeWindow,
  UptimeResponseDto,
  UptimeStats,
} from '@pulsecheck/shared';
import { aggregateUptime } from '@pulsecheck/shared';
import { useQueries, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { queryKeys, type CheckQuery, type IncidentQuery } from './query-keys';

/** Paginated check history for one monitor. */
export function useCheckResults(monitorId: string | undefined, query: CheckQuery) {
  return useQuery({
    queryKey: queryKeys.checks(monitorId ?? '', query),
    enabled: Boolean(monitorId),
    placeholderData: (previous) => previous,
    queryFn: () =>
      api.get<Page<CheckResultDto>>(`/monitors/${monitorId}/checks`, {
        query: {
          page: query.page,
          pageSize: query.pageSize,
          success: query.success === undefined ? undefined : String(query.success),
        },
      }),
  });
}

/** Uptime statistics for a monitor over one time window. */
export function useMonitorUptime(monitorId: string | undefined, window: TimeWindow) {
  return useQuery({
    queryKey: queryKeys.uptime(monitorId ?? '', window),
    enabled: Boolean(monitorId),
    placeholderData: (previous) => previous,
    queryFn: () =>
      api.get<UptimeResponseDto>(`/monitors/${monitorId}/uptime`, { query: { window } }),
  });
}

/** Bucketed response-time series for a monitor over one time window. */
export function useMonitorResponseTimes(monitorId: string | undefined, window: TimeWindow) {
  return useQuery({
    queryKey: queryKeys.responseTimes(monitorId ?? '', window),
    enabled: Boolean(monitorId),
    placeholderData: (previous) => previous,
    queryFn: () =>
      api.get<ResponseTimesResponseDto>(`/monitors/${monitorId}/response-times`, {
        query: { window },
      }),
  });
}

/** Incidents recorded for one monitor. */
export function useMonitorIncidents(monitorId: string | undefined, query: IncidentQuery) {
  return useQuery({
    queryKey: queryKeys.monitorIncidents(monitorId ?? '', query),
    enabled: Boolean(monitorId),
    placeholderData: (previous) => previous,
    queryFn: () =>
      api.get<Page<IncidentDto>>(`/monitors/${monitorId}/incidents`, {
        query: { page: query.page, pageSize: query.pageSize, status: query.status },
      }),
  });
}

export interface UptimeMapResult {
  statsByMonitor: Map<string, UptimeStats>;
  isLoading: boolean;
}

/** Uptime stats per monitor for a window, used by the monitors table. */
export function useMonitorUptimeMap(
  monitorIds: readonly string[],
  window: TimeWindow,
): UptimeMapResult {
  const results = useQueries({
    queries: monitorIds.map((monitorId) => ({
      queryKey: queryKeys.uptime(monitorId, window),
      staleTime: 60_000,
      queryFn: () =>
        api.get<UptimeResponseDto>(`/monitors/${monitorId}/uptime`, { query: { window } }),
    })),
  });

  const statsByMonitor = new Map<string, UptimeStats>();
  let isLoading = false;

  results.forEach((result, index) => {
    const monitorId = monitorIds[index];
    if (result.isLoading) isLoading = true;
    if (monitorId && result.data) statsByMonitor.set(monitorId, result.data.stats);
  });

  return { statsByMonitor, isLoading };
}

/** Account-wide incident history, including the monitor name. */
export function useIncidents(query: IncidentQuery) {
  return useQuery({
    queryKey: queryKeys.incidents(query),
    placeholderData: (previous) => previous,
    queryFn: () =>
      api.get<Page<IncidentActivityDto>>('/incidents', {
        query: { page: query.page, pageSize: query.pageSize, status: query.status },
      }),
  });
}

export interface AggregateUptimeResult {
  stats: UptimeStats;
  /** True while any monitor's window data is still in flight. */
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  loadedMonitors: number;
  totalMonitors: number;
}

/**
 * Aggregate uptime across monitors for a chosen window.
 *
 * The dashboard summary endpoint reports a single fixed window, so a window
 * selector needs the per-monitor statistic. The values are combined with the
 * shared `aggregateUptime` helper, which excludes monitors that produced no
 * checks instead of counting them as 0% or 100%.
 */
export function useAggregateUptime(
  monitorIds: readonly string[],
  window: TimeWindow,
): AggregateUptimeResult {
  const results = useQueries({
    queries: monitorIds.map((monitorId) => ({
      queryKey: queryKeys.uptime(monitorId, window),
      staleTime: 60_000,
      queryFn: () =>
        api.get<UptimeResponseDto>(`/monitors/${monitorId}/uptime`, { query: { window } }),
    })),
  });

  const collected: UptimeStats[] = [];
  let isLoading = false;
  let isError = false;
  let error: unknown = null;

  for (const result of results) {
    if (result.isLoading) isLoading = true;
    if (result.isError) {
      isError = true;
      error = result.error;
    }
    if (result.data) collected.push(result.data.stats);
  }

  return {
    stats: aggregateUptime(collected),
    isLoading,
    isError,
    error,
    loadedMonitors: collected.length,
    totalMonitors: monitorIds.length,
  };
}

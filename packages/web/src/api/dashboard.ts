import type { DashboardActivityDto, DashboardSummaryDto } from '@pulsecheck/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { queryKeys } from './query-keys';

/**
 * Dashboard aggregates. Every number comes from stored check results; a fresh
 * account receives zeroes and `null` percentages, which the UI renders as an
 * empty state rather than as data.
 */
export function useDashboardSummary() {
  return useQuery({
    queryKey: queryKeys.dashboardSummary(),
    refetchInterval: 30_000,
    queryFn: () => api.get<DashboardSummaryDto>('/dashboard/summary'),
  });
}

export function useDashboardActivity() {
  return useQuery({
    queryKey: queryKeys.dashboardActivity(),
    refetchInterval: 30_000,
    queryFn: () => api.get<DashboardActivityDto>('/dashboard/recent-activity'),
  });
}

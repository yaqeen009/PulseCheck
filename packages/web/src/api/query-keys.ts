import type { MonitorStatus } from '@pulsecheck/shared';

export type IncidentFilter = 'open' | 'resolved' | 'all';

export interface CheckQuery {
  page: number;
  pageSize: number;
  success?: boolean;
}

export interface IncidentQuery {
  page: number;
  pageSize: number;
  status: IncidentFilter;
}

export interface MonitorListFilters {
  search?: string;
  status?: MonitorStatus | 'ALL';
  sort?: 'name' | 'status' | 'lastCheckedAt' | 'createdAt';
  order?: 'asc' | 'desc';
}

/**
 * Query keys.
 *
 * Hierarchical on purpose: invalidating `['monitors']` after a mutation also
 * invalidates every list, detail row, history page and chart for that resource.
 */
export const queryKeys = {
  me: ['auth', 'me'] as const,
  monitors: () => ['monitors'] as const,
  monitorsList: (filters: MonitorListFilters) => ['monitors', 'list', filters] as const,
  monitor: (id: string) => ['monitors', 'detail', id] as const,
  monitorMethods: () => ['monitors', 'meta', 'methods'] as const,
  checks: (id: string, query: CheckQuery) => ['monitors', 'detail', id, 'checks', query] as const,
  uptime: (id: string, window: string) => ['monitors', 'detail', id, 'uptime', window] as const,
  responseTimes: (id: string, window: string) =>
    ['monitors', 'detail', id, 'response-times', window] as const,
  monitorIncidents: (id: string, query: IncidentQuery) =>
    ['monitors', 'detail', id, 'incidents', query] as const,
  incidents: (query: IncidentQuery) => ['incidents', query] as const,
  dashboard: () => ['dashboard'] as const,
  dashboardSummary: () => ['dashboard', 'summary'] as const,
  dashboardActivity: () => ['dashboard', 'activity'] as const,
  limits: () => ['meta', 'limits'] as const,
};

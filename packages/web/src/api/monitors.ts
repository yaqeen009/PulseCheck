import type { MonitorDto } from '@pulsecheck/shared';
import type { MonitorConfigInput } from '@pulsecheck/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { queryKeys, type MonitorListFilters } from './query-keys';

/** Payload accepted by POST /monitors and PATCH /monitors/:id. */
export type MonitorPayload = MonitorConfigInput & { enabled: boolean };

/** All monitors for the account, filtered server-side. */
export function useMonitors(filters: MonitorListFilters) {
  return useQuery({
    queryKey: queryKeys.monitorsList(filters),
    queryFn: async () => {
      const response = await api.get<{ items: MonitorDto[] }>('/monitors', {
        query: {
          search: filters.search,
          status: filters.status,
          sort: filters.sort,
          order: filters.order,
        },
      });
      return response.items;
    },
    refetchInterval: 30_000,
  });
}

export function useMonitor(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.monitor(id ?? ''),
    enabled: Boolean(id),
    refetchInterval: 30_000,
    queryFn: async () => {
      const response = await api.get<{ monitor: MonitorDto }>(`/monitors/${id}`);
      return response.monitor;
    },
  });
}

/**
 * Mutations invalidate the whole `['monitors']` branch: a monitor's status,
 * uptime and history all move together, and the dashboard aggregates them.
 */
function useMonitorMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.monitors() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      void queryClient.invalidateQueries({ queryKey: ['incidents'] });
    },
  });
}

export function useCreateMonitor() {
  return useMonitorMutation((payload: MonitorPayload) =>
    api.post<{ monitor: MonitorDto }>('/monitors', payload),
  );
}

export function useUpdateMonitor() {
  return useMonitorMutation((variables: { id: string; payload: MonitorPayload }) =>
    api.patch<{ monitor: MonitorDto }>(`/monitors/${variables.id}`, variables.payload),
  );
}

export function useDeleteMonitor() {
  return useMonitorMutation((id: string) => api.delete<void>(`/monitors/${id}`));
}

export function usePauseMonitor() {
  return useMonitorMutation((id: string) =>
    api.post<{ monitor: MonitorDto }>(`/monitors/${id}/pause`),
  );
}

export function useResumeMonitor() {
  return useMonitorMutation((id: string) =>
    api.post<{ monitor: MonitorDto }>(`/monitors/${id}/resume`),
  );
}

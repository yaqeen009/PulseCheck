import type { HttpMethod, PlatformLimits, TimeWindow } from '@pulsecheck/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { queryKeys } from './query-keys';

export interface PlatformMetaDto {
  version: string;
  limits: PlatformLimits;
  defaults: {
    intervalSeconds: number;
    timeoutMs: number;
    expectedStatusMin: number;
    expectedStatusMax: number;
  };
  timeWindows: readonly TimeWindow[];
  timeWindowBuckets: Record<TimeWindow, number>;
}

/**
 * Platform metadata. The registration and monitor forms read their limits and
 * defaults from here so validation messages always match the running server.
 */
export function usePlatformMeta() {
  return useQuery({
    queryKey: queryKeys.limits(),
    staleTime: 5 * 60_000,
    queryFn: () => api.get<PlatformMetaDto>('/meta/limits'),
  });
}

/** HTTP methods the API accepts for a monitor, from the API itself. */
export function useMonitorMethods() {
  return useQuery({
    queryKey: queryKeys.monitorMethods(),
    staleTime: 5 * 60_000,
    queryFn: () => api.get<{ methods: HttpMethod[] }>('/monitors/meta/methods'),
  });
}

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { useSseStatus, type SseStatus } from './useSSE';

export interface UseLiveQueryOptions {
  enabled?: boolean;
  staleTime?: number;
  refetchOnMount?: boolean;
  /** Escape hatch for clock-like data (presence, run progress). */
  refetchInterval?: number | false;
}

/**
 * FIX(pre-existing): `UseQueryResult` is a discriminated union in TanStack Query v5,
 * so an `interface ... extends` is illegal. An intersection alias is equivalent.
 */
export type LiveQueryResult<T> = UseQueryResult<T, ApiError> & {
  /** Whether the change-stream connection that keeps this query fresh is up. */
  live: boolean;
  liveStatus: SseStatus;
};

/**
 * `useQuery` plus live status. SSE invalidation is global (see `useSSE`), so this
 * wrapper exists to (a) type errors as `ApiError`, (b) apply IAMScope defaults and
 * (c) expose whether the live channel is currently connected so the UI can say
 * "stale" instead of silently showing old data.
 */
export function useLiveQuery<T>(
  queryKey: readonly unknown[],
  queryFn: (signal: AbortSignal) => Promise<T>,
  options: UseLiveQueryOptions = {},
): LiveQueryResult<T> {
  const liveStatus = useSseStatus();

  const result = useQuery<T, ApiError>({
    queryKey: queryKey,
    queryFn: ({ signal }) => queryFn(signal),
    enabled: options.enabled ?? true,
    staleTime: options.staleTime ?? 30_000,
    refetchOnMount: options.refetchOnMount ?? true,
    refetchOnWindowFocus: true,
    refetchInterval: options.refetchInterval ?? false,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return false;
      if (error instanceof ApiError && error.status === 404) return false;
      return failureCount < 2;
    },
  });

  return { ...result, live: liveStatus === 'open', liveStatus };
}

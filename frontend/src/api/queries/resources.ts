import type { ListQuery, Paginated, Resource } from '@iamscope/types';
import { api } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { listQueryParams } from '@/api/params';
import { useLiveQuery, type LiveQueryResult } from '@/hooks/useLiveQuery';

interface Options {
  enabled?: boolean;
}

export interface ResourceFilters extends ListQuery {
  type?: string;
  accountId?: string;
}

/** `GET /resources`. */
export function useResources(
  orgId: string | null,
  filters?: ResourceFilters,
  options: Options = {},
): LiveQueryResult<Paginated<Resource>> {
  const query = { ...listQueryParams(filters), type: filters?.type, accountId: filters?.accountId };
  return useLiveQuery<Paginated<Resource>>(
    queryKeys.resources.list(orgId ?? 'none', filters),
    (signal) => api.get<Paginated<Resource>>('/resources', query, { signal }),
    { enabled: (options.enabled ?? true) && orgId !== null },
  );
}

/** `GET /resources/:id`. */
export function useResource(
  orgId: string | null,
  id: string | null,
  options: Options = {},
): LiveQueryResult<Resource> {
  return useLiveQuery<Resource>(
    queryKeys.resources.detail(orgId ?? 'none', id ?? 'none'),
    (signal) => api.get<Resource>(`/resources/${id ?? ''}`, undefined, { signal }),
    { enabled: (options.enabled ?? true) && orgId !== null && id !== null },
  );
}

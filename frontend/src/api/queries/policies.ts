import type { ListQuery, Paginated, Policy, PolicyVersion } from '@iamscope/types';
import { api } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { listQueryParams } from '@/api/params';
import { useLiveQuery, type LiveQueryResult } from '@/hooks/useLiveQuery';

interface Options {
  enabled?: boolean;
}

/** `GET /policies` - paginated list, filterable by `q`, `tag`, `includeDeleted`. */
export function usePolicies(
  orgId: string | null,
  filters?: ListQuery,
  options: Options = {},
): LiveQueryResult<Paginated<Policy>> {
  const query = listQueryParams(filters);
  return useLiveQuery<Paginated<Policy>>(
    queryKeys.policies.list(orgId ?? 'none', filters),
    (signal) => api.get<Paginated<Policy>>('/policies', query, { signal }),
    { enabled: (options.enabled ?? true) && orgId !== null },
  );
}

/** `GET /policies/:id`. */
export function usePolicy(
  orgId: string | null,
  id: string | null,
  options: Options = {},
): LiveQueryResult<Policy> {
  return useLiveQuery<Policy>(
    queryKeys.policies.detail(orgId ?? 'none', id ?? 'none'),
    (signal) => api.get<Policy>(`/policies/${id ?? ''}`, undefined, { signal }),
    { enabled: (options.enabled ?? true) && orgId !== null && id !== null },
  );
}

/** `GET /policies/:id/versions` - immutable history, newest first. */
export function usePolicyVersions(
  orgId: string | null,
  id: string | null,
  options: Options = {},
): LiveQueryResult<PolicyVersion[]> {
  return useLiveQuery<PolicyVersion[]>(
    queryKeys.policies.versions(orgId ?? 'none', id ?? 'none'),
    (signal) => api.get<PolicyVersion[]>(`/policies/${id ?? ''}/versions`, undefined, { signal }),
    { enabled: (options.enabled ?? true) && orgId !== null && id !== null },
  );
}

/** `GET /policies/:id/versions/:v`. */
export function usePolicyVersion(
  orgId: string | null,
  id: string | null,
  version: number | null,
  options: Options = {},
): LiveQueryResult<PolicyVersion> {
  return useLiveQuery<PolicyVersion>(
    queryKeys.policies.version(orgId ?? 'none', id ?? 'none', version ?? 0),
    (signal) =>
      api.get<PolicyVersion>(`/policies/${id ?? ''}/versions/${version ?? 0}`, undefined, {
        signal,
      }),
    {
      enabled:
        (options.enabled ?? true) &&
        orgId !== null &&
        id !== null &&
        version !== null &&
        version > 0,
    },
  );
}

import type { ListQuery, Paginated, Principal, PrincipalDetail } from '@iamscope/types';
import { api } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { listQueryParams } from '@/api/params';
import { useLiveQuery, type LiveQueryResult } from '@/hooks/useLiveQuery';

interface Options {
  enabled?: boolean;
}

export interface PrincipalFilters extends ListQuery {
  type?: 'User' | 'Role' | 'Group';
  arn?: string;
}

/** `GET /principals`. */
export function usePrincipals(
  orgId: string | null,
  filters?: PrincipalFilters,
  options: Options = {},
): LiveQueryResult<Paginated<Principal>> {
  const query = { ...listQueryParams(filters), type: filters?.type, arn: filters?.arn };
  return useLiveQuery<Paginated<Principal>>(
    queryKeys.principals.list(orgId ?? 'none', filters),
    (signal) => api.get<Paginated<Principal>>('/principals', query, { signal }),
    { enabled: (options.enabled ?? true) && orgId !== null },
  );
}

/** `GET /principals/:id` - hydrated with attached policy summaries. */
export function usePrincipal(
  orgId: string | null,
  id: string | null,
  options: Options = {},
): LiveQueryResult<PrincipalDetail> {
  return useLiveQuery<PrincipalDetail>(
    queryKeys.principals.detail(orgId ?? 'none', id ?? 'none'),
    (signal) => api.get<PrincipalDetail>(`/principals/${id ?? ''}`, undefined, { signal }),
    { enabled: (options.enabled ?? true) && orgId !== null && id !== null },
  );
}

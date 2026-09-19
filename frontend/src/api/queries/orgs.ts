import type {
  ApiKey,
  Invitation,
  InvitationPreview,
  ListMembersQuery,
  Membership,
  Org,
  Paginated,
} from '@iamscope/types';
import { api } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { memberQueryParams, type QueryParams } from '@/api/params';
import { useLiveQuery, type LiveQueryResult } from '@/hooks/useLiveQuery';

interface Options {
  enabled?: boolean;
}

/** `GET /orgs` - every org the current user belongs to. */
export function useOrgs(options: Options = {}): LiveQueryResult<Org[]> {
  return useLiveQuery<Org[]>(
    queryKeys.orgs.list(),
    (signal) => api.get<Org[]>('/orgs', undefined, { signal }),
    {
      enabled: options.enabled ?? true,
      staleTime: 60_000,
    },
  );
}

/** `GET /orgs/:id`. */
export function useOrg(orgId: string | null, options: Options = {}): LiveQueryResult<Org> {
  return useLiveQuery<Org>(
    queryKeys.orgs.detail(orgId ?? 'none'),
    (signal) => api.get<Org>(`/orgs/${orgId ?? ''}`, undefined, { signal }),
    { enabled: (options.enabled ?? true) && orgId !== null },
  );
}

/** `GET /orgs/:id/members` - paginated so list pages can read `.total`. */
export function useMembers(
  orgId: string | null,
  filters?: ListMembersQuery,
  options: Options = {},
): LiveQueryResult<Paginated<Membership>> {
  const query = memberQueryParams(filters);
  return useLiveQuery<Paginated<Membership>>(
    queryKeys.orgs.members(orgId ?? 'none', query),
    (signal) => api.get<Paginated<Membership>>(`/orgs/${orgId ?? ''}/members`, query, { signal }),
    { enabled: (options.enabled ?? true) && orgId !== null },
  );
}

/** `GET /orgs/:id/invitations`. */
export function useInvitations(
  orgId: string | null,
  options: Options = {},
): LiveQueryResult<Invitation[]> {
  return useLiveQuery<Invitation[]>(
    queryKeys.orgs.invitations(orgId ?? 'none'),
    (signal) => api.get<Invitation[]>(`/orgs/${orgId ?? ''}/invitations`, undefined, { signal }),
    { enabled: (options.enabled ?? true) && orgId !== null },
  );
}

/** `GET /invitations/:token` - public preview used by the accept flow. */
export function useInvitationPreview(
  token: string | null,
  options: Options = {},
): LiveQueryResult<InvitationPreview> {
  return useLiveQuery<InvitationPreview>(
    queryKeys.orgs.invitationPreview(token ?? 'none'),
    (signal) => api.get<InvitationPreview>(`/invitations/${token ?? ''}`, undefined, { signal }),
    { enabled: (options.enabled ?? true) && token !== null, staleTime: 0 },
  );
}

/** `GET /orgs/:id/api-keys` (admin+). */
export function useApiKeys(orgId: string | null, options: Options = {}): LiveQueryResult<ApiKey[]> {
  return useLiveQuery<ApiKey[]>(
    queryKeys.orgs.apiKeys(orgId ?? 'none'),
    (signal) => api.get<ApiKey[]>(`/orgs/${orgId ?? ''}/api-keys`, undefined, { signal }),
    { enabled: (options.enabled ?? true) && orgId !== null },
  );
}

export type { QueryParams };

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Paginated, Principal, PrincipalDetail, PrincipalType } from '@iamscope/types';
import { MOTION } from '@iamscope/tokens';
import { api, type ApiError } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { useToast } from '@/components/ui/Toast';
import { useActiveOrgId } from '@/stores/session';
import { noOrgError, patchPages, removeFromPages, takeSnapshot } from './shared';

export interface UpsertPrincipalInput {
  type: PrincipalType;
  name: string;
  arn: string;
  groupMemberships?: string[];
  assumeRoleTargets?: string[];
  tags?: Record<string, string>;
  boundaryPolicyId?: string | null;
}

function invalidateDownstream(queryClient: ReturnType<typeof useQueryClient>, orgId: string): void {
  for (const root of ['graph', 'evaluations', 'timeline', 'audit'] as const) {
    void queryClient.invalidateQueries({ queryKey: [orgId, root] });
  }
}

export function useCreatePrincipal() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const orgId = useActiveOrgId();

  return useMutation({
    mutationFn: (payload: UpsertPrincipalInput) => {
      if (orgId === null) throw noOrgError();
      return api.post<Principal>('/principals', payload);
    },
    onSuccess: (principal) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.principals.root(orgId ?? 'none') });
      if (orgId !== null) invalidateDownstream(queryClient, orgId);
      toast.success('Principal created', principal.name);
    },
    onError: (error: ApiError) => {
      toast.error('Could not create principal', error.message);
    },
  });
}

export function useUpdatePrincipal() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const orgId = useActiveOrgId();
  const root = queryKeys.principals.root(orgId ?? 'none');

  return useMutation({
    mutationFn: (payload: { id: string } & Partial<UpsertPrincipalInput>) => {
      if (orgId === null) throw noOrgError();
      const { id, ...body } = payload;
      return api.put<Principal>(`/principals/${id}`, body);
    },
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: root });
      const snapshot = takeSnapshot(queryClient, { queryKey: root });
      const detailKey = queryKeys.principals.detail(orgId ?? 'none', payload.id);
      const previousDetail = queryClient.getQueryData<PrincipalDetail>(detailKey);

      const changes: Partial<Principal> = { updatedAt: new Date().toISOString() };
      if (payload.type !== undefined) changes.type = payload.type;
      if (payload.name !== undefined) changes.name = payload.name;
      if (payload.arn !== undefined) changes.arn = payload.arn;
      if (payload.groupMemberships !== undefined)
        changes.groupMemberships = payload.groupMemberships;
      if (payload.assumeRoleTargets !== undefined)
        changes.assumeRoleTargets = payload.assumeRoleTargets;
      if (payload.tags !== undefined) changes.tags = payload.tags;
      if (payload.boundaryPolicyId !== undefined)
        changes.boundaryPolicyId = payload.boundaryPolicyId;

      if (previousDetail) {
        queryClient.setQueryData<PrincipalDetail>(detailKey, { ...previousDetail, ...changes });
      }
      queryClient.setQueriesData({ queryKey: root }, (old: unknown) =>
        patchPages<Principal>(old, (principal) =>
          principal.id === payload.id ? { ...principal, ...changes } : principal,
        ),
      );

      return { snapshot, detailKey, previousDetail };
    },
    onError: (error: ApiError, _payload, context) => {
      if (context) {
        for (const [queryKey, data] of context.snapshot) queryClient.setQueryData(queryKey, data);
        if (context.previousDetail !== undefined) {
          queryClient.setQueryData(context.detailKey, context.previousDetail);
        }
      }
      toast.error('Could not save principal', error.message);
    },
    onSettled: (_data, _error, payload) => {
      void queryClient.invalidateQueries({ queryKey: root });
      if (orgId !== null) invalidateDownstream(queryClient, orgId);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.principals.detail(orgId ?? 'none', payload.id),
      });
    },
  });
}

export function useDeletePrincipal() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const orgId = useActiveOrgId();
  const root = queryKeys.principals.root(orgId ?? 'none');

  return useMutation({
    mutationFn: (id: string) => {
      if (orgId === null) throw noOrgError();
      return api.delete<null>(`/principals/${id}`);
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: root });
      const snapshot = takeSnapshot(queryClient, { queryKey: root });
      const detailKey = queryKeys.principals.detail(orgId ?? 'none', id);
      const previousDetail = queryClient.getQueryData<PrincipalDetail>(detailKey);
      const deleted = previousDetail ?? findPrincipal(snapshot, id);
      queryClient.setQueriesData({ queryKey: root }, (old: unknown) => removeFromPages(old, id));
      return { snapshot, detailKey, previousDetail, deleted };
    },
    onError: (error: ApiError, _id, context) => {
      if (context) {
        for (const [queryKey, data] of context.snapshot) queryClient.setQueryData(queryKey, data);
        if (context.previousDetail !== undefined) {
          queryClient.setQueryData(context.detailKey, context.previousDetail);
        }
      }
      toast.error('Could not delete principal', error.message);
    },
    onSuccess: (_data, id, context) => {
      const deleted = context.deleted;
      if (!deleted) {
        toast.success('Principal deleted');
        return;
      }
      toast.undoable({
        title: 'Principal deleted',
        description: `${deleted.name} was soft-deleted.`,
        durationMs: MOTION.toastDurationMs,
        onUndo: () => {
          // Inverse mutation: re-apply the snapshot through the documented update route
          // (Plan §8.5 exposes no restore route for principals).
          void api
            .put<Principal>(`/principals/${id}`, {
              type: deleted.type,
              name: deleted.name,
              arn: deleted.arn,
              groupMemberships: deleted.groupMemberships,
              assumeRoleTargets: deleted.assumeRoleTargets,
              tags: deleted.tags,
              boundaryPolicyId: deleted.boundaryPolicyId,
            })
            .then(() => {
              void queryClient.invalidateQueries({ queryKey: root });
              toast.success('Principal restored');
            })
            .catch((error: unknown) => {
              toast.error(
                'Could not restore principal',
                error instanceof Error ? error.message : undefined,
              );
            });
        },
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: root });
      if (orgId !== null) invalidateDownstream(queryClient, orgId);
    },
  });
}

export function useAttachPolicy() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const orgId = useActiveOrgId();
  const root = queryKeys.principals.root(orgId ?? 'none');

  return useMutation({
    mutationFn: (payload: { principalId: string; policyId: string }) => {
      if (orgId === null) throw noOrgError();
      return api.post<Principal>(`/principals/${payload.principalId}/policies/${payload.policyId}`);
    },
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: root });
      const snapshot = takeSnapshot(queryClient, { queryKey: root });
      const detailKey = queryKeys.principals.detail(orgId ?? 'none', payload.principalId);
      const previousDetail = queryClient.getQueryData<PrincipalDetail>(detailKey);
      // Inlined per cache shape: the detail cache holds `PrincipalDetail`, the
      // list caches hold `Principal`, and a shared helper would erase the extra
      // detail-only fields.
      const addTo = (attached: readonly string[]): string[] =>
        attached.includes(payload.policyId) ? [...attached] : [...attached, payload.policyId];

      if (previousDetail) {
        queryClient.setQueryData<PrincipalDetail>(detailKey, {
          ...previousDetail,
          attachedPolicies: addTo(previousDetail.attachedPolicies),
        });
      }
      queryClient.setQueriesData({ queryKey: root }, (old: unknown) =>
        patchPages<Principal>(old, (principal) =>
          principal.id === payload.principalId
            ? { ...principal, attachedPolicies: addTo(principal.attachedPolicies) }
            : principal,
        ),
      );
      return { snapshot, detailKey, previousDetail };
    },
    onError: (error: ApiError, _payload, context) => {
      if (context) {
        for (const [queryKey, data] of context.snapshot) queryClient.setQueryData(queryKey, data);
        if (context.previousDetail !== undefined) {
          queryClient.setQueryData(context.detailKey, context.previousDetail);
        }
      }
      toast.error('Could not attach policy', error.message);
    },
    onSuccess: () => {
      toast.success('Policy attached');
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: root });
      if (orgId !== null) invalidateDownstream(queryClient, orgId);
    },
  });
}

export function useDetachPolicy() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const orgId = useActiveOrgId();
  const root = queryKeys.principals.root(orgId ?? 'none');

  return useMutation({
    mutationFn: (payload: { principalId: string; policyId: string }) => {
      if (orgId === null) throw noOrgError();
      return api.delete<null>(`/principals/${payload.principalId}/policies/${payload.policyId}`);
    },
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: root });
      const snapshot = takeSnapshot(queryClient, { queryKey: root });
      const detailKey = queryKeys.principals.detail(orgId ?? 'none', payload.principalId);
      const previousDetail = queryClient.getQueryData<PrincipalDetail>(detailKey);
      const removeId = (attached: readonly string[]): string[] =>
        attached.filter((id) => id !== payload.policyId);

      if (previousDetail) {
        queryClient.setQueryData<PrincipalDetail>(detailKey, {
          ...previousDetail,
          attachedPolicies: removeId(previousDetail.attachedPolicies),
        });
      }
      queryClient.setQueriesData({ queryKey: root }, (old: unknown) =>
        patchPages<Principal>(old, (principal) =>
          principal.id === payload.principalId
            ? { ...principal, attachedPolicies: removeId(principal.attachedPolicies) }
            : principal,
        ),
      );
      return { snapshot, detailKey, previousDetail };
    },
    onError: (error: ApiError, _payload, context) => {
      if (context) {
        for (const [queryKey, data] of context.snapshot) queryClient.setQueryData(queryKey, data);
        if (context.previousDetail !== undefined) {
          queryClient.setQueryData(context.detailKey, context.previousDetail);
        }
      }
      toast.error('Could not detach policy', error.message);
    },
    onSuccess: (_data, payload) => {
      toast.undoable({
        title: 'Policy detached',
        description: 'The principal no longer carries this policy.',
        durationMs: MOTION.toastDurationMs,
        onUndo: () => {
          void api
            .post<Principal>(`/principals/${payload.principalId}/policies/${payload.policyId}`)
            .then(() => {
              void queryClient.invalidateQueries({ queryKey: root });
              toast.success('Policy re-attached');
            })
            .catch((error: unknown) => {
              toast.error(
                'Could not re-attach policy',
                error instanceof Error ? error.message : undefined,
              );
            });
        },
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: root });
      if (orgId !== null) invalidateDownstream(queryClient, orgId);
    },
  });
}

function findPrincipal(snapshot: ReturnType<typeof takeSnapshot>, id: string): Principal | null {
  for (const [, data] of snapshot) {
    if (data === null || typeof data !== 'object') continue;
    const page = data as Partial<Paginated<Principal>>;
    if (!Array.isArray(page.items)) continue;
    const match = page.items.find((principal) => principal.id === id);
    if (match) return match;
  }
  return null;
}

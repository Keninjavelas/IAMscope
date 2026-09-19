import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Paginated, Policy, PolicyStatement } from '@iamscope/types';
import { MOTION } from '@iamscope/tokens';
import { api, type ApiError } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { useToast } from '@/components/ui/Toast';
import { useActiveOrgId } from '@/stores/session';
import { noOrgError, patchPages, removeFromPages, takeSnapshot } from './shared';

/** Everything a policy edit invalidates downstream (Plan §11.4, §13.1). */
function invalidateAnalysis(queryClient: ReturnType<typeof useQueryClient>, orgId: string): void {
  for (const root of ['evaluations', 'graph', 'timeline', 'audit'] as const) {
    void queryClient.invalidateQueries({ queryKey: [orgId, root] });
  }
}

export function useCreatePolicy() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const orgId = useActiveOrgId();

  return useMutation({
    mutationFn: (payload: {
      name: string;
      statements: PolicyStatement[];
      tags?: Record<string, string>;
      changeReason: string;
    }) => {
      if (orgId === null) throw noOrgError();
      return api.post<Policy>('/policies', payload);
    },
    onSuccess: (policy) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.policies.root(orgId ?? 'none') });
      if (orgId !== null) invalidateAnalysis(queryClient, orgId);
      toast.success('Policy created', policy.name);
    },
    onError: (error: ApiError) => {
      toast.error('Could not create policy', error.message);
    },
  });
}

export function useUpdatePolicy() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const orgId = useActiveOrgId();
  const root = queryKeys.policies.root(orgId ?? 'none');

  return useMutation({
    mutationFn: (payload: {
      id: string;
      statements: PolicyStatement[];
      changeReason: string;
      tags?: Record<string, string>;
    }) => {
      if (orgId === null) throw noOrgError();
      const { id, ...body } = payload;
      return api.put<Policy>(`/policies/${id}`, body);
    },
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: root });
      const snapshot = takeSnapshot(queryClient, { queryKey: root });
      const detailKey = queryKeys.policies.detail(orgId ?? 'none', payload.id);
      const previousDetail = queryClient.getQueryData<Policy>(detailKey);

      const patch = (policy: Policy): Policy => ({
        ...policy,
        statements: payload.statements,
        ...(payload.tags === undefined ? {} : { tags: payload.tags }),
        currentVersion: policy.currentVersion + 1,
        updatedAt: new Date().toISOString(),
      });

      if (previousDetail) queryClient.setQueryData<Policy>(detailKey, patch(previousDetail));
      queryClient.setQueriesData({ queryKey: root }, (old: unknown) =>
        patchPages<Policy>(old, (policy) => (policy.id === payload.id ? patch(policy) : policy)),
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
      toast.error('Could not save policy', error.message);
    },
    onSuccess: (policy) => {
      queryClient.setQueryData<Policy>(
        queryKeys.policies.detail(orgId ?? 'none', policy.id),
        policy,
      );
      toast.success('Policy saved', `Version ${policy.currentVersion}`);
    },
    onSettled: (_data, _error, payload) => {
      void queryClient.invalidateQueries({ queryKey: root });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.policies.versions(orgId ?? 'none', payload.id),
      });
      if (orgId !== null) invalidateAnalysis(queryClient, orgId);
    },
  });
}

export function useDeletePolicy() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const orgId = useActiveOrgId();
  const root = queryKeys.policies.root(orgId ?? 'none');

  return useMutation({
    mutationFn: (id: string) => {
      if (orgId === null) throw noOrgError();
      return api.delete<null>(`/policies/${id}`);
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: root });
      const snapshot = takeSnapshot(queryClient, { queryKey: root });
      const detailKey = queryKeys.policies.detail(orgId ?? 'none', id);
      const previousDetail = queryClient.getQueryData<Policy>(detailKey);
      const deleted = previousDetail ?? findPolicy(snapshot, id);

      queryClient.setQueriesData({ queryKey: root }, (old: unknown) => removeFromPages(old, id));
      if (previousDetail) {
        queryClient.setQueryData<Policy>(detailKey, { ...previousDetail, deleted: true });
      }
      return { snapshot, detailKey, previousDetail, deleted };
    },
    onError: (error: ApiError, _id, context) => {
      if (context) {
        for (const [queryKey, data] of context.snapshot) queryClient.setQueryData(queryKey, data);
        if (context.previousDetail !== undefined) {
          queryClient.setQueryData(context.detailKey, context.previousDetail);
        }
      }
      toast.error('Could not delete policy', error.message);
    },
    onSuccess: (_data, id, context) => {
      const deleted = context.deleted;
      if (!deleted) {
        toast.success('Policy deleted');
        return;
      }
      toast.undoable({
        title: 'Policy deleted',
        description: `${deleted.name} was soft-deleted.`,
        durationMs: MOTION.toastDurationMs,
        onUndo: () => {
          // Inverse mutation: `POST /policies/:id/restore` (Plan §8.4).
          void api
            .post<Policy>(`/policies/${id}/restore`, {
              version: deleted.currentVersion,
              changeReason: 'Undo delete',
            })
            .then(() => {
              void queryClient.invalidateQueries({ queryKey: root });
              toast.success('Policy restored');
            })
            .catch((error: unknown) => {
              toast.error(
                'Could not restore policy',
                error instanceof Error ? error.message : undefined,
              );
            });
        },
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: root });
      if (orgId !== null) invalidateAnalysis(queryClient, orgId);
    },
  });
}

export function useRestorePolicy() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const orgId = useActiveOrgId();
  const root = queryKeys.policies.root(orgId ?? 'none');

  return useMutation({
    mutationFn: (payload: { id: string; version: number; changeReason?: string }) =>
      api.post<Policy>(`/policies/${payload.id}/restore`, {
        version: payload.version,
        changeReason: payload.changeReason ?? `Restored version ${payload.version}`,
      }),
    onSuccess: (policy) => {
      void queryClient.invalidateQueries({ queryKey: root });
      queryClient.setQueryData<Policy>(
        queryKeys.policies.detail(orgId ?? 'none', policy.id),
        policy,
      );
      toast.success('Version restored', `Now at version ${policy.currentVersion}`);
    },
    onError: (error: ApiError) => {
      toast.error('Could not restore version', error.message);
    },
    onSettled: (_data, _error, payload) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.policies.versions(orgId ?? 'none', payload.id),
      });
      if (orgId !== null) invalidateAnalysis(queryClient, orgId);
    },
  });
}

function findPolicy(snapshot: ReturnType<typeof takeSnapshot>, id: string): Policy | null {
  for (const [, data] of snapshot) {
    if (data === null || typeof data !== 'object') continue;
    const page = data as Partial<Paginated<Policy>>;
    if (!Array.isArray(page.items)) continue;
    const match = page.items.find((policy) => policy.id === id);
    if (match) return match;
  }
  return null;
}

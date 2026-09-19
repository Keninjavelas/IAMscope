import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Paginated, Resource } from '@iamscope/types';
import { MOTION } from '@iamscope/tokens';
import { api, type ApiError } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { useToast } from '@/components/ui/Toast';
import { useActiveOrgId } from '@/stores/session';
import { noOrgError, patchPages, removeFromPages, takeSnapshot } from './shared';

export interface UpsertResourceInput {
  arn: string;
  type: string;
  tags?: Record<string, string>;
  accountId?: string | null;
}

function invalidateDownstream(queryClient: ReturnType<typeof useQueryClient>, orgId: string): void {
  for (const root of ['evaluations', 'timeline', 'audit'] as const) {
    void queryClient.invalidateQueries({ queryKey: [orgId, root] });
  }
}

export function useCreateResource() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const orgId = useActiveOrgId();

  return useMutation({
    mutationFn: (payload: UpsertResourceInput) => {
      if (orgId === null) throw noOrgError();
      return api.post<Resource>('/resources', payload);
    },
    onSuccess: (resource) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.resources.root(orgId ?? 'none') });
      if (orgId !== null) invalidateDownstream(queryClient, orgId);
      toast.success('Resource created', resource.arn);
    },
    onError: (error: ApiError) => {
      toast.error('Could not create resource', error.message);
    },
  });
}

export function useUpdateResource() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const orgId = useActiveOrgId();
  const root = queryKeys.resources.root(orgId ?? 'none');

  return useMutation({
    mutationFn: (payload: { id: string } & Partial<UpsertResourceInput>) => {
      if (orgId === null) throw noOrgError();
      const { id, ...body } = payload;
      return api.put<Resource>(`/resources/${id}`, body);
    },
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: root });
      const snapshot = takeSnapshot(queryClient, { queryKey: root });
      const detailKey = queryKeys.resources.detail(orgId ?? 'none', payload.id);
      const previousDetail = queryClient.getQueryData<Resource>(detailKey);

      const changes: Partial<Resource> = { updatedAt: new Date().toISOString() };
      if (payload.arn !== undefined) changes.arn = payload.arn;
      if (payload.type !== undefined) changes.type = payload.type;
      if (payload.tags !== undefined) changes.tags = payload.tags;
      if (payload.accountId !== undefined) changes.accountId = payload.accountId;

      if (previousDetail)
        queryClient.setQueryData<Resource>(detailKey, { ...previousDetail, ...changes });
      queryClient.setQueriesData({ queryKey: root }, (old: unknown) =>
        patchPages<Resource>(old, (resource) =>
          resource.id === payload.id ? { ...resource, ...changes } : resource,
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
      toast.error('Could not save resource', error.message);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: root });
      if (orgId !== null) invalidateDownstream(queryClient, orgId);
    },
  });
}

export function useDeleteResource() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const orgId = useActiveOrgId();
  const root = queryKeys.resources.root(orgId ?? 'none');

  return useMutation({
    mutationFn: (id: string) => {
      if (orgId === null) throw noOrgError();
      return api.delete<null>(`/resources/${id}`);
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: root });
      const snapshot = takeSnapshot(queryClient, { queryKey: root });
      const detailKey = queryKeys.resources.detail(orgId ?? 'none', id);
      const previousDetail = queryClient.getQueryData<Resource>(detailKey);
      const deleted = previousDetail ?? findResource(snapshot, id);
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
      toast.error('Could not delete resource', error.message);
    },
    onSuccess: (_data, id, context) => {
      const deleted = context.deleted;
      if (!deleted) {
        toast.success('Resource deleted');
        return;
      }
      toast.undoable({
        title: 'Resource deleted',
        description: deleted.arn,
        durationMs: MOTION.toastDurationMs,
        onUndo: () => {
          // Inverse mutation: re-apply the snapshot through the documented update route.
          void api
            .put<Resource>(`/resources/${id}`, {
              arn: deleted.arn,
              type: deleted.type,
              tags: deleted.tags,
              accountId: deleted.accountId,
            })
            .then(() => {
              void queryClient.invalidateQueries({ queryKey: root });
              toast.success('Resource restored');
            })
            .catch((error: unknown) => {
              toast.error(
                'Could not restore resource',
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

function findResource(snapshot: ReturnType<typeof takeSnapshot>, id: string): Resource | null {
  for (const [, data] of snapshot) {
    if (data === null || typeof data !== 'object') continue;
    const page = data as Partial<Paginated<Resource>>;
    if (!Array.isArray(page.items)) continue;
    const match = page.items.find((resource) => resource.id === id);
    if (match) return match;
  }
  return null;
}

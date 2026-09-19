import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Paginated, PolicyEffect, Scenario } from '@iamscope/types';
import { MOTION } from '@iamscope/tokens';
import { api, type ApiError } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { useToast } from '@/components/ui/Toast';
import { useActiveOrgId } from '@/stores/session';
import { noOrgError, patchPages, removeFromPages, takeSnapshot } from './shared';

export interface UpsertScenarioInput {
  name: string;
  principalArn: string;
  action: string;
  resourceArn: string;
  expectedResult: PolicyEffect;
  tags?: string[];
}

function invalidateDownstream(queryClient: ReturnType<typeof useQueryClient>, orgId: string): void {
  for (const root of ['evaluations', 'timeline', 'audit'] as const) {
    void queryClient.invalidateQueries({ queryKey: [orgId, root] });
  }
}

export function useCreateScenario() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const orgId = useActiveOrgId();

  return useMutation({
    mutationFn: (payload: UpsertScenarioInput) => {
      if (orgId === null) throw noOrgError();
      return api.post<Scenario>('/scenarios', payload);
    },
    onSuccess: (scenario) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scenarios.root(orgId ?? 'none') });
      if (orgId !== null) invalidateDownstream(queryClient, orgId);
      toast.success('Scenario created', scenario.name);
    },
    onError: (error: ApiError) => {
      toast.error('Could not create scenario', error.message);
    },
  });
}

export function useUpdateScenario() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const orgId = useActiveOrgId();
  const root = queryKeys.scenarios.root(orgId ?? 'none');

  return useMutation({
    mutationFn: (payload: { id: string } & Partial<UpsertScenarioInput>) => {
      if (orgId === null) throw noOrgError();
      const { id, ...body } = payload;
      return api.put<Scenario>(`/scenarios/${id}`, body);
    },
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: root });
      const snapshot = takeSnapshot(queryClient, { queryKey: root });

      const changes: Partial<Scenario> = { updatedAt: new Date().toISOString() };
      if (payload.name !== undefined) changes.name = payload.name;
      if (payload.principalArn !== undefined) changes.principalArn = payload.principalArn;
      if (payload.action !== undefined) changes.action = payload.action;
      if (payload.resourceArn !== undefined) changes.resourceArn = payload.resourceArn;
      if (payload.expectedResult !== undefined) changes.expectedResult = payload.expectedResult;
      if (payload.tags !== undefined) changes.tags = payload.tags;

      queryClient.setQueriesData({ queryKey: root }, (old: unknown) =>
        patchPages<Scenario>(old, (scenario) =>
          scenario.id === payload.id ? { ...scenario, ...changes } : scenario,
        ),
      );
      return { snapshot };
    },
    onError: (error: ApiError, _payload, context) => {
      if (context) {
        for (const [queryKey, data] of context.snapshot) queryClient.setQueryData(queryKey, data);
      }
      toast.error('Could not save scenario', error.message);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: root });
      if (orgId !== null) invalidateDownstream(queryClient, orgId);
    },
  });
}

export function useDeleteScenario() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const orgId = useActiveOrgId();
  const root = queryKeys.scenarios.root(orgId ?? 'none');

  return useMutation({
    mutationFn: (id: string) => {
      if (orgId === null) throw noOrgError();
      return api.delete<null>(`/scenarios/${id}`);
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: root });
      const snapshot = takeSnapshot(queryClient, { queryKey: root });
      const deleted = findScenario(snapshot, id);
      queryClient.setQueriesData({ queryKey: root }, (old: unknown) => removeFromPages(old, id));
      return { snapshot, deleted };
    },
    onError: (error: ApiError, _id, context) => {
      if (context) {
        for (const [queryKey, data] of context.snapshot) queryClient.setQueryData(queryKey, data);
      }
      toast.error('Could not delete scenario', error.message);
    },
    onSuccess: (_data, _id, context) => {
      const deleted = context.deleted;
      if (!deleted) {
        toast.success('Scenario deleted');
        return;
      }
      toast.undoable({
        title: 'Scenario deleted',
        description: deleted.name,
        durationMs: MOTION.toastDurationMs,
        onUndo: () => {
          // Inverse mutation: scenarios are hard-deleted, so the inverse is a re-create.
          void api
            .post<Scenario>('/scenarios', {
              name: deleted.name,
              principalArn: deleted.principalArn,
              action: deleted.action,
              resourceArn: deleted.resourceArn,
              expectedResult: deleted.expectedResult,
              tags: deleted.tags,
            })
            .then(() => {
              void queryClient.invalidateQueries({ queryKey: root });
              toast.success('Scenario re-created');
            })
            .catch((error: unknown) => {
              toast.error(
                'Could not re-create scenario',
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

function findScenario(snapshot: ReturnType<typeof takeSnapshot>, id: string): Scenario | null {
  for (const [, data] of snapshot) {
    if (data === null || typeof data !== 'object') continue;
    const page = data as Partial<Paginated<Scenario>>;
    if (!Array.isArray(page.items)) continue;
    const match = page.items.find((scenario) => scenario.id === id);
    if (match) return match;
  }
  return null;
}

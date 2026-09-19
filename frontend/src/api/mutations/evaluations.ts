import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  EscalationGraphPayload,
  EscalationPath,
  EvaluationOutcome,
  Paginated,
  EvaluationRunSummary,
} from '@iamscope/types';
import { api, type ApiError } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { useToast } from '@/components/ui/Toast';
import { announceUrgent } from '@/lib/announcer';
import { buildEscalationGraph } from '@/lib/graph';
import { useActiveOrgId } from '@/stores/session';
import { noOrgError, takeSnapshot } from './shared';

/**
 * `POST /evaluate` (Plan §8.8) - the only mutation that is deliberately *not*
 * optimistic: the whole point is that the engine tells us the answer. The result
 * is announced assertively (Plan §15.4) as well as toasted.
 */
export function useEvaluate() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const orgId = useActiveOrgId();

  return useMutation({
    mutationFn: (payload: {
      principalArn: string;
      action: string;
      resourceArn: string;
      persist?: boolean;
      label?: string;
    }) => {
      if (orgId === null) throw noOrgError();
      return api.post<EvaluationOutcome>('/evaluate', payload);
    },
    onSuccess: (outcome) => {
      const verdict = outcome.result === 'Allow' ? 'Allowed' : 'Denied';
      announceUrgent(`Evaluation result: ${verdict}. ${outcome.reason.replace(/-/g, ' ')}.`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.evaluations.root(orgId ?? 'none') });
      void queryClient.invalidateQueries({ queryKey: [orgId ?? 'none', 'audit'] });
      toast.toast({
        title: `Evaluation: ${verdict}`,
        description: `${outcome.action} on ${outcome.resourceArn} - ${outcome.reason.replace(/-/g, ' ')}`,
        variant: outcome.result === 'Allow' ? 'success' : 'error',
      });
    },
    onError: (error: ApiError) => {
      toast.error('Evaluation failed', error.message);
    },
  });
}

export function useClearEvaluations() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const orgId = useActiveOrgId();
  const root = queryKeys.evaluations.root(orgId ?? 'none');

  return useMutation({
    mutationFn: () => {
      if (orgId === null) throw noOrgError();
      return api.delete<null>('/evaluations');
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: root });
      const snapshot = takeSnapshot(queryClient, { queryKey: root });
      // Optimistic: the run history the user is looking at disappears immediately.
      queryClient.setQueriesData({ queryKey: root }, (old: unknown) => {
        if (old === null || typeof old !== 'object') return old;
        const page = old as Partial<Paginated<EvaluationRunSummary>>;
        if (!Array.isArray(page.items)) return old;
        return { ...page, items: [], total: 0, hasMore: false };
      });
      return { snapshot };
    },
    onError: (error: ApiError, _variables, context) => {
      if (context) {
        for (const [queryKey, data] of context.snapshot) queryClient.setQueryData(queryKey, data);
      }
      toast.error('Could not clear evaluations', error.message);
    },
    onSuccess: () => {
      toast.success('Evaluation history cleared');
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: root });
    },
  });
}

/**
 * `POST /graph/escalation` - forces a traversal instead of reading the cache
 * (Plan §11.5). The response is either the cached paths or the renderable graph.
 */
export function useComputeEscalation() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const orgId = useActiveOrgId();

  return useMutation({
    mutationFn: async (payload: { fromPrincipalArn?: string; maxDepth?: number }) => {
      if (orgId === null) throw noOrgError();
      return api.post<EscalationGraphPayload | EscalationPath[]>('/graph/escalation', payload);
    },
    onSuccess: (payload) => {
      const graph: EscalationGraphPayload = Array.isArray(payload)
        ? buildEscalationGraph(payload)
        : payload;
      queryClient.setQueryData<EscalationGraphPayload>(
        queryKeys.graph.escalation(orgId ?? 'none', null),
        graph,
      );
      const count = graph.paths.length;
      toast.toast({
        title: count === 1 ? '1 escalation path found' : `${count} escalation paths found`,
        variant: count === 0 ? 'info' : 'warn',
        description: graph.truncated ? 'Results were truncated at the depth limit.' : undefined,
      });
      announceUrgent(`${count} escalation paths found.`);
    },
    onError: (error: ApiError) => {
      toast.error('Could not compute escalation paths', error.message);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.graph.root(orgId ?? 'none') });
    },
  });
}

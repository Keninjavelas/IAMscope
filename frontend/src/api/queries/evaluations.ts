import type {
  EvaluationDiff,
  EvaluationRun,
  EvaluationRunSummary,
  Paginated,
} from '@iamscope/types';
import { api } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { evaluationQueryParams, type EvaluationFilters } from '@/api/params';
import { useLiveQuery, type LiveQueryResult } from '@/hooks/useLiveQuery';

interface Options {
  enabled?: boolean;
}

/** `GET /evaluations` - run history, newest first. */
export function useEvaluationRuns(
  orgId: string | null,
  filters?: EvaluationFilters,
  options: Options = {},
): LiveQueryResult<Paginated<EvaluationRunSummary>> {
  const query = evaluationQueryParams(filters);
  return useLiveQuery<Paginated<EvaluationRunSummary>>(
    queryKeys.evaluations.list(orgId ?? 'none', filters),
    (signal) => api.get<Paginated<EvaluationRunSummary>>('/evaluations', query, { signal }),
    { enabled: (options.enabled ?? true) && orgId !== null },
  );
}

/** `GET /evaluations/:id` - full run including per-scenario traces. */
export function useEvaluationRun(
  orgId: string | null,
  id: string | null,
  options: Options = {},
): LiveQueryResult<EvaluationRun> {
  return useLiveQuery<EvaluationRun>(
    queryKeys.evaluations.detail(orgId ?? 'none', id ?? 'none'),
    (signal) => api.get<EvaluationRun>(`/evaluations/${id ?? ''}`, undefined, { signal }),
    { enabled: (options.enabled ?? true) && orgId !== null && id !== null },
  );
}

/** `GET /evaluations/diff?before=&after=` - the Impact lens feed. */
export function useEvaluationDiff(
  orgId: string | null,
  before: string | null,
  after: string | null,
  options: Options = {},
): LiveQueryResult<EvaluationDiff> {
  return useLiveQuery<EvaluationDiff>(
    queryKeys.evaluations.diff(orgId ?? 'none', before, after),
    (signal) =>
      api.get<EvaluationDiff>(
        '/evaluations/diff',
        { before: before ?? undefined, after: after ?? undefined },
        { signal },
      ),
    { enabled: (options.enabled ?? true) && orgId !== null },
  );
}

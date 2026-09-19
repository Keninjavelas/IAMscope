import type { ListScenariosQuery, Paginated, ScenarioWithResult } from '@iamscope/types';
import { api } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { scenarioQueryParams } from '@/api/params';
import { useLiveQuery, type LiveQueryResult } from '@/hooks/useLiveQuery';

interface Options {
  enabled?: boolean;
}

/** `GET /scenarios` - carries the last evaluation result per scenario. */
export function useScenarios(
  orgId: string | null,
  filters?: ListScenariosQuery,
  options: Options = {},
): LiveQueryResult<Paginated<ScenarioWithResult>> {
  const query = scenarioQueryParams(filters);
  return useLiveQuery<Paginated<ScenarioWithResult>>(
    queryKeys.scenarios.list(orgId ?? 'none', filters),
    (signal) => api.get<Paginated<ScenarioWithResult>>('/scenarios', query, { signal }),
    { enabled: (options.enabled ?? true) && orgId !== null },
  );
}

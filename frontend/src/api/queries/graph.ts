import type { EscalationGraphPayload, EscalationPath } from '@iamscope/types';
import { api } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { buildEscalationGraph } from '@/lib/graph';
import { useLiveQuery, type LiveQueryResult } from '@/hooks/useLiveQuery';

interface Options {
  enabled?: boolean;
}

/**
 * `GET /graph/paths?from=` returns cached escalation paths (Plan §8.9).
 *
 * The backend serves paths; the node/edge payload the renderer wants is derived
 * here with the shared graphology builders so the Graph lens and the demand-run
 * mutation (`POST /graph/escalation`) render identical graphs.
 */
export function useEscalationPaths(
  orgId: string | null,
  fromArn?: string | null,
  options: Options = {},
): LiveQueryResult<EscalationPath[]> {
  return useLiveQuery<EscalationPath[]>(
    queryKeys.graph.paths(orgId ?? 'none', fromArn ?? null),
    (signal) =>
      api.get<EscalationPath[]>('/graph/paths', { from: fromArn ?? undefined }, { signal }),
    { enabled: (options.enabled ?? true) && orgId !== null },
  );
}

/** Same endpoint, adapted into the renderable graph payload. */
export function useEscalationGraph(
  orgId: string | null,
  fromArn?: string | null,
  options: Options = {},
): LiveQueryResult<EscalationGraphPayload> {
  return useLiveQuery<EscalationGraphPayload>(
    queryKeys.graph.escalation(orgId ?? 'none', fromArn ?? null),
    async (signal) => {
      const payload = await api.get<EscalationGraphPayload | EscalationPath[]>(
        '/graph/paths',
        { from: fromArn ?? undefined },
        { signal },
      );
      if (Array.isArray(payload)) return buildEscalationGraph(payload);
      return payload;
    },
    { enabled: (options.enabled ?? true) && orgId !== null },
  );
}

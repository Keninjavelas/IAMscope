import type { AuditAttribution, AuditEvent, Paginated } from '@iamscope/types';
import { api } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { auditQueryParams, type AuditFilters } from '@/api/params';
import { useLiveQuery, type LiveQueryResult } from '@/hooks/useLiveQuery';

interface Options {
  enabled?: boolean;
}

/** `GET /audit?targetType=&targetId=&actorId=&from=&to=` (Plan §8.11). */
export function useAuditEvents(
  orgId: string | null,
  filters?: AuditFilters,
  options: Options = {},
): LiveQueryResult<Paginated<AuditEvent>> {
  const query = auditQueryParams(filters);
  return useLiveQuery<Paginated<AuditEvent>>(
    queryKeys.audit.list(orgId ?? 'none', query),
    (signal) => api.get<Paginated<AuditEvent>>('/audit', query, { signal }),
    { enabled: (options.enabled ?? true) && orgId !== null },
  );
}

/** `GET /audit/attribution?scenarioId=&before=&after=` - which edit caused a delta. */
export function useAttribution(
  orgId: string | null,
  scenarioId: string | null,
  before: string | null,
  after: string | null,
  options: Options = {},
): LiveQueryResult<AuditAttribution> {
  return useLiveQuery<AuditAttribution>(
    queryKeys.audit.attribution(orgId ?? 'none', scenarioId ?? 'none', before, after),
    (signal) =>
      api.get<AuditAttribution>(
        '/audit/attribution',
        {
          scenarioId: scenarioId ?? undefined,
          before: before ?? undefined,
          after: after ?? undefined,
        },
        { signal },
      ),
    { enabled: (options.enabled ?? true) && orgId !== null && scenarioId !== null },
  );
}

import type { TimelineDiffPreview, TimelineEventsPayload, TimelineState } from '@iamscope/types';
import { api } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { useLiveQuery, type LiveQueryResult } from '@/hooks/useLiveQuery';

interface Options {
  enabled?: boolean;
}

/**
 * `GET /timeline/state?at=` (Plan §8.10).
 *
 * Reconstruction is cached server-side per minute (Plan §12.2) so the clock is
 * rounded here too - that keeps the query key stable while the scrubber moves
 * within the same minute and avoids a request per pixel.
 */
export function useTimelineState(
  orgId: string | null,
  atIso: string | null,
  options: Options = {},
): LiveQueryResult<TimelineState> {
  const rounded = atIso === null ? null : roundToMinute(atIso);
  return useLiveQuery<TimelineState>(
    queryKeys.timeline.state(orgId ?? 'none', rounded ?? 'now'),
    (signal) => api.get<TimelineState>('/timeline/state', { at: rounded ?? undefined }, { signal }),
    { enabled: (options.enabled ?? true) && orgId !== null && rounded !== null, staleTime: 60_000 },
  );
}

/** `GET /timeline/events?from=&to=` - markers + per-day buckets for the scrubber. */
export function useTimelineEvents(
  orgId: string | null,
  from?: string | null,
  to?: string | null,
  options: Options = {},
): LiveQueryResult<TimelineEventsPayload> {
  return useLiveQuery<TimelineEventsPayload>(
    queryKeys.timeline.events(orgId ?? 'none', from ?? null, to ?? null),
    (signal) =>
      api.get<TimelineEventsPayload>(
        '/timeline/events',
        { from: from ?? undefined, to: to ?? undefined },
        { signal },
      ),
    { enabled: (options.enabled ?? true) && orgId !== null && Boolean(from) && Boolean(to) },
  );
}

/** `GET /timeline/diff?at=&compareTo=` - the live diff preview panel. */
export function useTimelineDiff(
  orgId: string | null,
  atIso: string | null,
  compareTo?: string | null,
  options: Options = {},
): LiveQueryResult<TimelineDiffPreview> {
  const rounded = atIso === null ? null : roundToMinute(atIso);
  return useLiveQuery<TimelineDiffPreview>(
    queryKeys.timeline.diff(orgId ?? 'none', rounded ?? 'now', compareTo ?? null),
    (signal) =>
      api.get<TimelineDiffPreview>(
        '/timeline/diff',
        { at: rounded ?? undefined, compareTo: compareTo ?? undefined },
        { signal },
      ),
    { enabled: (options.enabled ?? true) && orgId !== null && rounded !== null, staleTime: 60_000 },
  );
}

/** Floor an ISO timestamp to the start of its minute (in UTC, matching the cache key). */
export function roundToMinute(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  date.setUTCSeconds(0, 0);
  return date.toISOString();
}

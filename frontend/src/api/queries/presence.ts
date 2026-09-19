import type { PresenceEntry } from '@iamscope/types';
import { MOTION } from '@iamscope/tokens';
import { api } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { useLiveQuery, type LiveQueryResult } from '@/hooks/useLiveQuery';

interface Options {
  enabled?: boolean;
}

/**
 * `GET /presence` - the org roster (Plan §14). Kept on the heartbeat clock so the
 * header avatar stack decays within one TTL even if the SSE stream is down.
 */
export function usePresenceList(
  orgId: string | null,
  options: Options = {},
): LiveQueryResult<PresenceEntry[]> {
  return useLiveQuery<PresenceEntry[]>(
    queryKeys.presence.list(orgId ?? 'none'),
    (signal) => api.get<PresenceEntry[]>('/presence', undefined, { signal }),
    {
      enabled: (options.enabled ?? true) && orgId !== null,
      staleTime: MOTION.presenceHeartbeatMs,
      refetchInterval: MOTION.presenceHeartbeatMs,
    },
  );
}

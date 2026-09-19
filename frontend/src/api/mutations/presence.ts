import { useMutation } from '@tanstack/react-query';
import type { PresenceCursor, PresenceHeartbeatPayload } from '@iamscope/types';
import { api } from '@/api/client';
import { noOrgError } from './shared';
import { useActiveOrgId } from '@/stores/session';

/**
 * `POST /presence/heartbeat` (Plan §14.1).
 *
 * Deliberately silent: presence is best-effort telemetry, so failures never
 * toast and never roll anything back. `usePresence` owns the 20s cadence; this
 * hook exists so feature code (e.g. the graph cursor) can beat on demand.
 */
export function useHeartbeat() {
  const orgId = useActiveOrgId();

  return useMutation({
    mutationFn: (payload: {
      location: PresenceHeartbeatPayload['location'];
      cursor?: PresenceCursor | null;
    }) => {
      if (orgId === null) throw noOrgError();
      return api.post<null>('/presence/heartbeat', payload);
    },
    retry: false,
  });
}

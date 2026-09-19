import type { AuthMeResponse, Session } from '@iamscope/types';
import { api } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { useLiveQuery, type LiveQueryResult } from '@/hooks/useLiveQuery';

interface Options {
  enabled?: boolean;
}

/** `GET /auth/me` - the session bootstrap query (Plan §8.1). */
export function useMe(options: Options = {}): LiveQueryResult<AuthMeResponse> {
  return useLiveQuery<AuthMeResponse>(
    queryKeys.auth.me(),
    (signal) => api.get<AuthMeResponse>('/auth/me', undefined, { signal }),
    { enabled: options.enabled ?? true, staleTime: 60_000 },
  );
}

/** `GET /auth/sessions` - active sessions for the account security panel. */
export function useSessions(options: Options = {}): LiveQueryResult<Session[]> {
  return useLiveQuery<Session[]>(
    queryKeys.auth.sessions(),
    (signal) => api.get<Session[]>('/auth/sessions', undefined, { signal }),
    { enabled: options.enabled ?? true, staleTime: 15_000 },
  );
}

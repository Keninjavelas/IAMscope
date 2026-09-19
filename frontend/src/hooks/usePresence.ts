import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { MOTION } from '@iamscope/tokens';
import type { PresenceCursor, PresenceEntry } from '@iamscope/types';
import { api } from '@/api/client';
import { queryKeys } from '@/api/keys';
import { useActiveOrgId, useCurrentUser } from '@/stores/session';
import { useLiveQuery } from './useLiveQuery';

interface PresenceOptions {
  enabled?: boolean;
  /** Entity the current view is focused on, for "Alice is editing" badges. */
  entityType?: string | null;
  entityId?: string | null;
}

export interface UsePresenceResult {
  /** Everyone currently present in the org, including the current user. */
  peers: PresenceEntry[];
  /** Everyone except the current user. */
  others: PresenceEntry[];
  /** Peers (excluding self) whose location points at this entity. */
  editorsFor: (entityId: string) => PresenceEntry[];
  /** Publish a cursor position; delivered with the next heartbeat. */
  publishCursor: (cursor: PresenceCursor | null) => void;
  isLoading: boolean;
  refetch: () => void;
}

/**
 * Presence (Plan §14): a 20s heartbeat carrying the current route and, on the
 * graph lens, the cursor position. The roster comes from `GET /presence` and is
 * kept fresh both by the heartbeat interval and by SSE presence events.
 */
export function usePresence(options: PresenceOptions = {}): UsePresenceResult {
  const { enabled = true, entityType = null, entityId = null } = options;

  const orgId = useActiveOrgId();
  const user = useCurrentUser();
  const location = useLocation();

  const cursorRef = useRef<PresenceCursor | null>(null);
  const lastSentRef = useRef<string>('');

  const roster = useLiveQuery<PresenceEntry[]>(
    queryKeys.presence.list(orgId ?? 'none'),
    async (signal) => {
      const controller = new AbortController();
      signal.addEventListener('abort', () => controller.abort());
      return api.get<PresenceEntry[]>('/presence', undefined, { signal: controller.signal });
    },
    {
      enabled: enabled && orgId !== null,
      staleTime: MOTION.presenceHeartbeatMs,
      refetchInterval: MOTION.presenceHeartbeatMs,
    },
  );

  const beat = useCallback(
    async (force = false): Promise<void> => {
      if (!enabled || orgId === null || user === null) return;

      const payload = {
        location: { route: location.pathname, entityType, entityId },
        cursor: cursorRef.current,
      };
      const signature = JSON.stringify(payload);
      if (!force && signature === lastSentRef.current) return;
      lastSentRef.current = signature;

      try {
        await api.post('/presence/heartbeat', payload);
      } catch {
        // Presence is best-effort: never surface heartbeat failures to the user.
      }
    },
    [enabled, entityId, entityType, location.pathname, orgId, user],
  );

  // Heartbeat loop.
  useEffect(() => {
    if (!enabled || orgId === null || user === null) return;

    void beat(true);
    const interval = setInterval(() => void beat(), MOTION.presenceHeartbeatMs);

    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void beat(true);
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [beat, enabled, orgId, user]);

  // Route or entity change should update presence immediately.
  useEffect(() => {
    void beat(true);
  }, [beat, location.pathname, entityType, entityId]);

  const publishCursor = useCallback(
    (cursor: PresenceCursor | null): void => {
      cursorRef.current = cursor;
      void beat(true);
    },
    [beat],
  );

  const peers = roster.data ?? [];

  const others = useMemo(
    () => peers.filter((entry) => entry.userId !== user?.id),
    [peers, user?.id],
  );

  const editorsFor = useCallback(
    (targetId: string): PresenceEntry[] =>
      others.filter(
        (entry) => entry.location.entityId === targetId || entry.location.entityId === null,
      ),
    [others],
  );

  return {
    peers,
    others,
    editorsFor,
    publishCursor,
    isLoading: roster.isLoading,
    refetch: () => void roster.refetch(),
  };
}

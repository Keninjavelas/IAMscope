import { createContext, useContext, useMemo, type ReactNode, type JSX } from 'react';
import type { PresenceEntry, PresenceLocation } from '@iamscope/types';
import { usePresenceList } from '@/api/queries/presence';
import { useActiveOrgId } from '@/stores/session';

export interface PresenceRosterValue {
  entries: PresenceEntry[];
  isLoading: boolean;
  /** The full roster, for avatar stacks. */
  others: PresenceEntry[];
  /** Peers whose current location bucket matches (e.g. `policy-detail`). */
  activeOn: (location: PresenceLocation) => PresenceEntry[];
}

const PresenceRosterContext = createContext<PresenceRosterValue | null>(null);

/**
 * Exposes the org-wide presence roster to the shell.
 *
 * Deliberately does NOT call `usePresence` again: the heartbeat has exactly one
 * owner (`SessionProvider` in `App.tsx`), and a second owner would double the
 * write rate for no benefit. This provider reads the same cached query, so it
 * stays in lockstep with the heartbeat without adding network traffic.
 */
export function PresenceProvider({ children }: { children: ReactNode }): JSX.Element {
  const orgId = useActiveOrgId();
  const roster = usePresenceList(orgId);

  const value = useMemo<PresenceRosterValue>(() => {
    const entries = roster.data ?? [];
    return {
      entries,
      isLoading: roster.isLoading,
      others: entries,
      // The roster payload carries a `location` bucket, not entity ids, so
      // per-entity peer lists come from `usePresence({ entityType, entityId })`
      // inside the feature that owns the entity.
      activeOn: (location: PresenceLocation) =>
        entries.filter((entry) => entry.location === location),
    };
  }, [roster.data, roster.isLoading]);

  return <PresenceRosterContext.Provider value={value}>{children}</PresenceRosterContext.Provider>;
}

export function usePresenceRoster(): PresenceRosterValue {
  const value = useContext(PresenceRosterContext);
  if (value === null) {
    // Outside the provider the roster is simply empty - never throw in the shell.
    return {
      entries: [],
      isLoading: false,
      others: [],
      activeOn: () => [],
    };
  }
  return value;
}

import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { MOTION } from '@iamscope/tokens';
import type { SseCollection, SseEvent } from '@iamscope/types';
import { create } from 'zustand';
import { api, eventsUrl, tokenEventsUrl } from '@/api/client';
import { SSE_INVALIDATION_ROOTS, queryKeys } from '@/api/keys';
import { env } from '@/env';
import { useSessionStore } from '@/stores/session';

/* ------------------------------------------------------------------ */
/* Shared live state                                                  */
/* ------------------------------------------------------------------ */

export type SseStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

interface SseState {
  status: SseStatus;
  clientId: string | null;
  lastEventAt: number | null;
  lastCollection: SseCollection | null;
  attempts: number;
  setStatus: (status: SseStatus) => void;
  setHello: (clientId: string) => void;
  setEvent: (collection: SseCollection) => void;
  setAttempts: (attempts: number) => void;
  reset: () => void;
}

/**
 * Connection state lives in a store rather than component state so the header
 * indicator, the ARIA announcer and `useLiveQuery` all read the same truth.
 */
export const useSseStore = create<SseState>()((set) => ({
  status: 'idle',
  clientId: null,
  lastEventAt: null,
  lastCollection: null,
  attempts: 0,
  setStatus: (status) => set({ status }),
  setHello: (clientId) => set({ clientId }),
  setEvent: (collection) => set({ lastEventAt: Date.now(), lastCollection: collection }),
  setAttempts: (attempts) => set({ attempts }),
  reset: () => set({ status: 'idle', clientId: null, attempts: 0, lastEventAt: null }),
}));

export const useSseStatus = (): SseStatus => useSseStore((state) => state.status);

/* ------------------------------------------------------------------ */
/* Polite announcements (Plan §15.4 - aria-live)                      */
/* ------------------------------------------------------------------ */

type AnnouncementListener = (message: string) => void;

const announcementListeners = new Set<AnnouncementListener>();
let lastAnnouncement = { message: '', at: 0 };

/** Coalesces identical bursts so the live region does not chatter. */
export function announce(message: string): void {
  const now = Date.now();
  if (message === lastAnnouncement.message && now - lastAnnouncement.at < 1500) return;
  lastAnnouncement = { message, at: now };
  for (const listener of announcementListeners) listener(message);
}

export function subscribeAnnouncements(listener: AnnouncementListener): () => void {
  announcementListeners.add(listener);
  return () => announcementListeners.delete(listener);
}

/* ------------------------------------------------------------------ */
/* Invalidation                                                       */
/* ------------------------------------------------------------------ */

const COLLECTION_LABELS: Record<SseCollection, string> = {
  policies: 'policy',
  policy_versions: 'policy version',
  principals: 'principal',
  resources: 'resource',
  scenarios: 'scenario',
  evaluation_runs: 'evaluation run',
  escalation_paths: 'escalation path',
  presence: 'presence',
};

function invalidateForEvent(
  queryClient: QueryClient,
  orgId: string,
  collection: SseCollection,
): void {
  const roots = SSE_INVALIDATION_ROOTS[collection];

  if (roots === 'self') {
    // Presence is high-frequency: refresh the roster without a full refetch storm.
    void queryClient.invalidateQueries({ queryKey: queryKeys.presence.list(orgId) });
    return;
  }

  for (const root of roots) {
    void queryClient.invalidateQueries({ queryKey: [orgId, root] });
  }

  if (collection !== 'escalation_paths') {
    void queryClient.invalidateQueries({ queryKey: queryKeys.audit.root(orgId) });
  }
}

/* ------------------------------------------------------------------ */
/* The hook                                                           */
/* ------------------------------------------------------------------ */

interface UseSseOptions {
  enabled?: boolean;
}

/**
 * Opens the org-scoped EventSource and translates change-stream events into
 * TanStack Query invalidations (Plan §13.3). Reconnects with exponential backoff
 * capped at 30s and reopens whenever the active org changes.
 */
export function useSSE(options: UseSseOptions = {}): void {
  const { enabled = true } = options;
  const queryClient = useQueryClient();
  const orgId = useSessionStore((state) => state.activeOrg?.id ?? null);
  const hydrated = useSessionStore((state) => state.hydrated);

  const sourceRef = useRef<EventSource | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<Set<SseCollection>>(new Set());
  const flushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedRef = useRef(false);

  useEffect(() => {
    if (!enabled || !hydrated || !orgId) {
      useSseStore.getState().reset();
      return;
    }

    closedRef.current = false;
    let attempts = 0;

    const flush = (): void => {
      const collections = pendingRef.current;
      pendingRef.current = new Set();
      for (const collection of collections) {
        invalidateForEvent(queryClient, orgId, collection);
      }
    };

    const queue = (collection: SseCollection): void => {
      pendingRef.current.add(collection);
      // Coalesce bursts (a policy update emits policy + version + run events).
      flushRef.current ??= setTimeout(() => {
        flushRef.current = null;
        flush();
      }, 150);
    };

    /** Closes the current source and schedules another attempt with capped backoff. */
    function scheduleReconnect(): void {
      if (closedRef.current) return;

      attempts += 1;
      useSseStore.getState().setAttempts(attempts);
      useSseStore.getState().setStatus('reconnecting');

      const delay = Math.min(1000 * 2 ** Math.min(attempts, 6), MOTION.sseMaxBackoffMs);
      timerRef.current = setTimeout(open, delay);
    }

    /**
     * Cookie mode uses a same-origin `EventSource`, so the session cookie rides along with
     * every request. Token mode mints a short-lived token and connects straight to the API
     * origin - only needed when the same-origin rewrite buffers the stream, and it means the
     * token, not a cookie, is the credential for that one connection (DECISIONS D24).
     */
    async function createSource(): Promise<EventSource> {
      if (env.sseMode === 'token') {
        const { token } = await api.post<{ token: string; expiresAt: string }>('/events/token');
        return new EventSource(tokenEventsUrl(token));
      }
      return new EventSource(eventsUrl(), { withCredentials: true });
    }

    function attach(source: EventSource): void {
      sourceRef.current = source;

      source.addEventListener('open', () => {
        attempts = 0;
        useSseStore.getState().setAttempts(0);
        useSseStore.getState().setStatus('open');
      });

      source.addEventListener('hello', (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent<string>).data) as { clientId?: string };
          if (payload.clientId) useSseStore.getState().setHello(payload.clientId);
        } catch {
          /* malformed hello is not fatal */
        }
      });

      const handleChange = (event: Event): void => {
        try {
          const payload = JSON.parse((event as MessageEvent<string>).data) as SseEvent;
          if (payload.orgId && payload.orgId !== orgId) return;
          useSseStore.getState().setEvent(payload.collection);
          queue(payload.collection);
          announce(`${COLLECTION_LABELS[payload.collection]} updated`);
        } catch {
          /* ignore malformed frames */
        }
      };

      source.addEventListener('change', handleChange);
      source.addEventListener('message', handleChange);
      source.addEventListener('presence', handleChange);

      source.addEventListener('error', () => {
        source.close();
        sourceRef.current = null;
        // Never let `EventSource` retry by itself. Its built-in retry reuses the same URL, so
        // in token mode it would replay a token that has already been consumed and fail
        // forever; reconnecting has to go back through `createSource` to re-mint.
        scheduleReconnect();
      });
    }

    function open(): void {
      if (closedRef.current) return;
      useSseStore.getState().setStatus(attempts === 0 ? 'connecting' : 'reconnecting');

      void createSource().then(attach, scheduleReconnect);
    }

    open();

    // Manual reconnect from the header's connection indicator.
    const onManualReconnect = (): void => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      sourceRef.current?.close();
      sourceRef.current = null;
      attempts = 0;
      useSseStore.getState().setAttempts(0);
      open();
    };
    window.addEventListener('iamscope:sse-reconnect', onManualReconnect);

    return () => {
      closedRef.current = true;
      window.removeEventListener('iamscope:sse-reconnect', onManualReconnect);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (flushRef.current) clearTimeout(flushRef.current);
      timerRef.current = null;
      flushRef.current = null;
      pendingRef.current = new Set();
      sourceRef.current?.close();
      sourceRef.current = null;
      useSseStore.getState().setStatus('closed');
    };
  }, [enabled, hydrated, orgId, queryClient]);
}

/** Manual reconnect, wired to the header's connection indicator. */
export function reconnectSse(): void {
  useSseStore.setState({ attempts: 0 });
  window.dispatchEvent(new Event('iamscope:sse-reconnect'));
}

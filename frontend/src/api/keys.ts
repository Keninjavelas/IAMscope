import type { ListQuery, ListScenariosQuery, SseCollection } from '@iamscope/types';

/**
 * Query key factory (Plan §17). Every server-state key is namespaced by `orgId`
 * first so switching orgs silently re-scopes the cache and a stale response from
 * org A can never be read while org B is active.
 */
export const queryKeys = {
  session: {
    root: () => ['session'] as const,
    csrf: () => ['session', 'csrf'] as const,
  },
  auth: {
    me: () => ['auth', 'me'] as const,
    sessions: () => ['auth', 'sessions'] as const,
  },
  orgs: {
    root: () => ['orgs'] as const,
    list: () => ['orgs', 'list'] as const,
    detail: (orgId: string) => ['orgs', 'detail', orgId] as const,
    members: (orgId: string, filters?: Record<string, unknown>) =>
      ['orgs', orgId, 'members', filters ?? {}] as const,
    invitations: (orgId: string) => ['orgs', orgId, 'invitations'] as const,
    invitationPreview: (token: string) => ['invitations', 'preview', token] as const,
    apiKeys: (orgId: string) => ['orgs', orgId, 'api-keys'] as const,
  },
  policies: {
    root: (orgId: string) => [orgId, 'policies'] as const,
    list: (orgId: string, filters?: ListQuery) =>
      [orgId, 'policies', 'list', filters ?? {}] as const,
    detail: (orgId: string, id: string) => [orgId, 'policies', 'detail', id] as const,
    versions: (orgId: string, id: string) => [orgId, 'policies', 'versions', id] as const,
    version: (orgId: string, id: string, version: number) =>
      [orgId, 'policies', 'versions', id, version] as const,
  },
  principals: {
    root: (orgId: string) => [orgId, 'principals'] as const,
    list: (orgId: string, filters?: ListQuery) =>
      [orgId, 'principals', 'list', filters ?? {}] as const,
    detail: (orgId: string, id: string) => [orgId, 'principals', 'detail', id] as const,
  },
  resources: {
    root: (orgId: string) => [orgId, 'resources'] as const,
    list: (orgId: string, filters?: ListQuery) =>
      [orgId, 'resources', 'list', filters ?? {}] as const,
    detail: (orgId: string, id: string) => [orgId, 'resources', 'detail', id] as const,
  },
  scenarios: {
    root: (orgId: string) => [orgId, 'scenarios'] as const,
    list: (orgId: string, filters?: ListScenariosQuery) =>
      [orgId, 'scenarios', 'list', filters ?? {}] as const,
    detail: (orgId: string, id: string) => [orgId, 'scenarios', 'detail', id] as const,
  },
  evaluations: {
    root: (orgId: string) => [orgId, 'evaluations'] as const,
    list: (orgId: string, filters?: ListQuery) =>
      [orgId, 'evaluations', 'list', filters ?? {}] as const,
    detail: (orgId: string, id: string) => [orgId, 'evaluations', 'detail', id] as const,
    diff: (orgId: string, before: string | null, after: string | null) =>
      [orgId, 'evaluations', 'diff', before ?? 'latest', after ?? 'latest'] as const,
  },
  graph: {
    root: (orgId: string) => [orgId, 'graph'] as const,
    escalation: (orgId: string, from: string | null) =>
      [orgId, 'graph', 'escalation', from ?? 'all'] as const,
    paths: (orgId: string, from: string | null) =>
      [orgId, 'graph', 'paths', from ?? 'all'] as const,
  },
  timeline: {
    root: (orgId: string) => [orgId, 'timeline'] as const,
    state: (orgId: string, at: string) => [orgId, 'timeline', 'state', at] as const,
    events: (orgId: string, from: string | null, to: string | null) =>
      [orgId, 'timeline', 'events', from ?? 'min', to ?? 'max'] as const,
    diff: (orgId: string, at: string, compareTo: string | null) =>
      [orgId, 'timeline', 'diff', at, compareTo ?? 'prev'] as const,
  },
  audit: {
    root: (orgId: string) => [orgId, 'audit'] as const,
    list: (orgId: string, filters?: Record<string, unknown>) =>
      [orgId, 'audit', 'list', filters ?? {}] as const,
    attribution: (orgId: string, scenarioId: string, before: string | null, after: string | null) =>
      [orgId, 'audit', 'attribution', scenarioId, before ?? 'prev', after ?? 'latest'] as const,
  },
  presence: {
    root: (orgId: string) => [orgId, 'presence'] as const,
    list: (orgId: string) => [orgId, 'presence', 'list'] as const,
  },
  health: {
    ping: () => ['health'] as const,
  },
} as const;

/**
 * Which query-key roots a change-stream event should invalidate (Plan §13.3).
 * The value is the second element of the query key, so a single
 * `invalidateQueries({ queryKey: [orgId, root] })` reaches every variant.
 */
export const SSE_INVALIDATION_ROOTS: Record<SseCollection, readonly string[] | 'self'> = {
  policies: ['policies', 'evaluations', 'graph', 'timeline', 'audit'],
  policy_versions: ['policies', 'timeline', 'audit', 'evaluations'],
  principals: ['principals', 'graph', 'evaluations', 'timeline', 'audit'],
  resources: ['resources', 'evaluations', 'timeline', 'audit'],
  scenarios: ['scenarios', 'evaluations', 'timeline', 'audit'],
  evaluation_runs: ['evaluations', 'audit'],
  escalation_paths: ['graph'],
  presence: 'self',
} as const;

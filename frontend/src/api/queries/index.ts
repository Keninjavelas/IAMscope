/**
 * Query hooks - one module per resource (Plan §6, contract §api/queries).
 * Every list endpoint keeps `Paginated<T>` in the generic so pages can read `.total`.
 */
export { useMe, useSessions } from './auth';

export {
  useApiKeys,
  useInvitationPreview,
  useInvitations,
  useMembers,
  useOrg,
  useOrgs,
} from './orgs';

export { usePolicies, usePolicy, usePolicyVersion, usePolicyVersions } from './policies';

export { usePrincipal, usePrincipals } from './principals';
export type { PrincipalFilters } from './principals';

export { useResource, useResources } from './resources';
export type { ResourceFilters } from './resources';

export { useScenarios } from './scenarios';

export { useEvaluationDiff, useEvaluationRun, useEvaluationRuns } from './evaluations';

export { useEscalationGraph, useEscalationPaths } from './graph';

export { roundToMinute, useTimelineDiff, useTimelineEvents, useTimelineState } from './timeline';

export { useAttribution, useAuditEvents } from './audit';

export { usePresenceList } from './presence';

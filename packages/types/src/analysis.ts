/**
 * Analysis wire types: evaluation runs, escalation paths, audit events, presence,
 * plus the derived shapes used by the Impact / Graph / Timeline lenses.
 */
import type { PolicyEffect, PolicyStatement } from './domain';

/** 1 hop -> low, 2 hops -> medium, 3+ hops -> high (Plan §11.3). */
export type EscalationSeverity = 'low' | 'medium' | 'high';

/* ------------------------------------------------------------------ */
/* Evaluator                                                           */
/* ------------------------------------------------------------------ */

export const EVALUATION_TRIGGERS = [
  'manual',
  'policy.update',
  'policy.create',
  'principal.update',
  'principal.attach',
  'principal.detach',
  'resource.update',
  'scenario.update',
  'seed',
  'api',
] as const;

export type EvaluationTrigger = (typeof EVALUATION_TRIGGERS)[number];

/** A single matched statement in a decision trace. */
export interface TraceEntry {
  policyId: string;
  policyName: string;
  policyArn: string;
  sid: string;
  effect: PolicyEffect;
  /** Which statement fields matched, for explainability in the UI. */
  matchedAction: string;
  matchedResource: string;
  matchedConditions: TraceConditionResult[];
  source: 'principal' | 'group' | 'boundary';
  sourceName: string;
}

export interface TraceConditionResult {
  operator: string;
  key: string;
  expected: string[];
  satisfied: boolean;
}

export interface EvaluationOutcome {
  result: PolicyEffect;
  /** Why the engine settled on `result`. */
  reason: 'explicit-deny' | 'explicit-allow' | 'implicit-deny' | 'boundary-deny' | 'no-policy';
  trace: TraceEntry[];
  evaluatedPolicies: number;
  durationMs: number;
  principalArn: string;
  action: string;
  resourceArn: string;
  boundaryPolicyId: string | null;
}

export interface EvaluatePayload {
  principalArn: string;
  action: string;
  resourceArn: string;
  persist?: boolean;
  label?: string;
}

export interface EvaluationRunResult {
  scenarioId: string;
  scenarioName: string;
  principalArn: string;
  action: string;
  resourceArn: string;
  expectedResult: PolicyEffect;
  result: PolicyEffect;
  passed: boolean;
  trace: TraceEntry[];
  reason: EvaluationOutcome['reason'];
}

export interface EvaluationSummary {
  total: number;
  passed: number;
  failed: number;
}

export interface EvaluationRun {
  id: string;
  orgId: string;
  label: string;
  snapshotAt: string;
  triggeredBy: EvaluationTrigger | (string & {});
  triggeredByUserId: string | null;
  triggeredByName?: string | null;
  causedByAuditEventId: string | null;
  results: EvaluationRunResult[];
  summary: EvaluationSummary;
  createdAt: string;
}

/** Compact form for the run list / Impact lens selectors. */
export interface EvaluationRunSummary {
  id: string;
  label: string;
  snapshotAt: string;
  triggeredBy: string;
  triggeredByName: string | null;
  summary: EvaluationSummary;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Impact lens                                                         */
/* ------------------------------------------------------------------ */

export interface EvaluationDiffEntry {
  scenarioId: string;
  scenarioName: string;
  principalArn: string;
  action: string;
  resourceArn: string;
  before: PolicyEffect | null;
  after: PolicyEffect | null;
  transition: 'allow-to-deny' | 'deny-to-allow' | 'unchanged' | 'added' | 'removed';
  beforeTrace: TraceEntry[];
  afterTrace: TraceEntry[];
  /** Statements present before but gone after (policyId:sid). */
  removedStatements: string[];
  addedStatements: string[];
}

export interface EvaluationDiff {
  before: EvaluationRunSummary | null;
  after: EvaluationRunSummary;
  counts: {
    total: number;
    changed: number;
    allowToDeny: number;
    denyToAllow: number;
    unchanged: number;
    added: number;
    removed: number;
  };
  entries: EvaluationDiffEntry[];
}

/* ------------------------------------------------------------------ */
/* Graph lens                                                          */
/* ------------------------------------------------------------------ */

export interface EscalationHop {
  /** Edge kind traversed on this hop. */
  via:
    | 'assume-role'
    | 'pass-role'
    | 'attach-policy'
    | 'create-function'
    | 'invoke-function'
    | 'run-instances'
    | 'create-policy-version'
    | 'set-default-policy-version'
    | 'group-membership';
  /** ARN of the principal/resource reached. */
  target: string;
  targetName: string;
  policyId: string | null;
  policyName: string | null;
  sid: string | null;
  action: string;
}

export interface EscalationPath {
  id: string;
  orgId: string;
  pattern: string;
  fromPrincipalArn: string;
  fromPrincipalName: string;
  toPrincipalArn: string;
  toPrincipalName: string;
  hops: EscalationHop[];
  severity: EscalationSeverity;
  computedAt: string;
  policySnapshotVersion: number;
}

export interface GraphNode {
  id: string;
  arn: string;
  name: string;
  type: string;
  severity: EscalationSeverity | null;
  hopDepth: number;
  tags: Record<string, string>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: EscalationHop['via'];
  /** Number of permissions flowing along this edge (thickness). */
  weight: number;
  label: string;
  onEscalationPath: boolean;
}

export interface EscalationGraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
  paths: EscalationPath[];
  computedAt: string;
  truncated: boolean;
}

export interface EscalationQueryPayload {
  fromPrincipalArn: string;
  maxDepth?: number;
}

/* ------------------------------------------------------------------ */
/* Timeline lens                                                       */
/* ------------------------------------------------------------------ */

export interface TimelineEventMarker {
  id: string;
  timestamp: string;
  action: string;
  category: TimelineCategory;
  actorEmail: string | null;
  targetType: string;
  targetId: string;
  targetName: string;
  summary: string;
}

export const TIMELINE_CATEGORIES = [
  'policy',
  'principal',
  'resource',
  'scenario',
  'membership',
  'org',
  'apikey',
] as const;
export type TimelineCategory = (typeof TIMELINE_CATEGORIES)[number];

export interface TimelineStatePolicy {
  policyId: string;
  name: string;
  arn: string;
  version: number;
  statements: PolicyStatement[];
  deleted: boolean;
  mutatedAt: string | null;
}

export interface TimelineStatePrincipal {
  principalId: string;
  name: string;
  arn: string;
  type: string;
  attachedPolicies: string[];
  groupMemberships: string[];
  assumeRoleTargets: string[];
  deleted: boolean;
  mutatedAt: string | null;
}

export interface TimelineStateResource {
  resourceId: string;
  arn: string;
  type: string;
  tags: Record<string, string>;
  deleted: boolean;
  mutatedAt: string | null;
}

export interface TimelineState {
  at: string;
  orgId: string;
  policies: TimelineStatePolicy[];
  principals: TimelineStatePrincipal[];
  resources: TimelineStateResource[];
  counts: {
    policies: number;
    principals: number;
    resources: number;
    deletedPolicies: number;
    deletedPrincipals: number;
  };
  /** Cached reconstruction is rounded to the minute. */
  cacheKey: string;
  reconstructedFrom: 'versions+audit' | 'current';
  durationMs: number;
}

export interface TimelineEventsPayload {
  from: string;
  to: string;
  events: TimelineEventMarker[];
  buckets: TimelineBucket[];
}

export interface TimelineBucket {
  /** ISO date (day granularity). */
  day: string;
  counts: Record<TimelineCategory, number>;
  total: number;
}

/** Diff preview shown next to the scrubber: state at T vs state at T-1 event. */
export interface TimelineDiffPreview {
  at: string;
  comparedTo: string | null;
  addedPolicies: number;
  removedPolicies: number;
  changedPolicies: number;
  addedPrincipals: number;
  removedPrincipals: number;
  changedPrincipals: number;
  addedResources: number;
  removedResources: number;
  changedResources: number;
  topChanges: TimelineChangeSummary[];
}

export interface TimelineChangeSummary {
  entityType: string;
  entityId: string;
  name: string;
  change: 'added' | 'removed' | 'changed';
  detail: string;
  version?: number;
}

/* ------------------------------------------------------------------ */
/* Audit                                                               */
/* ------------------------------------------------------------------ */

export interface AuditTarget {
  type: string;
  id: string;
  name: string;
}

export interface AuditEvent {
  id: string;
  orgId: string;
  timestamp: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorType: 'user' | 'api_key' | 'system';
  action: string;
  target: AuditTarget;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
}

export interface AuditAttribution {
  scenarioId: string;
  scenarioName: string;
  before: string | null;
  after: string;
  resultBefore: PolicyEffect | null;
  resultAfter: PolicyEffect;
  causes: AuditAttributionCause[];
  confidence: 'high' | 'medium' | 'low';
  confidenceScore: number;
  explanation: string;
}

export interface AuditAttributionCause {
  auditEventId: string;
  timestamp: string;
  action: string;
  actorEmail: string | null;
  target: AuditTarget;
  changedFields: string[];
  /** 0..1 - how strongly this event explains the delta. */
  weight: number;
  rationale: string;
}

/* ------------------------------------------------------------------ */
/* Presence                                                            */
/* ------------------------------------------------------------------ */

export interface PresenceLocation {
  route: string;
  entityType: string | null;
  entityId: string | null;
}

export interface PresenceCursor {
  x: number;
  y: number;
}

export interface PresenceEntry {
  id: string;
  orgId: string;
  userId: string;
  sessionId: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
  };
  location: PresenceLocation;
  cursor: PresenceCursor | null;
  lastSeenAt: string;
  /** Accent assigned deterministically from userId for cursors. */
  color: string;
}

export interface PresenceHeartbeatPayload {
  location: PresenceLocation;
  cursor?: PresenceCursor | null;
}

/* ------------------------------------------------------------------ */
/* SSE                                                                 */
/* ------------------------------------------------------------------ */

export const SSE_COLLECTIONS = [
  'policies',
  'policy_versions',
  'principals',
  'resources',
  'scenarios',
  'evaluation_runs',
  'escalation_paths',
  'presence',
] as const;
export type SseCollection = (typeof SSE_COLLECTIONS)[number];

export interface SseEvent {
  id: string;
  collection: SseCollection;
  op: 'insert' | 'update' | 'replace' | 'delete';
  orgId: string;
  documentId: string;
  timestamp: string;
  /** Present for `presence` events so cursors can animate without a refetch. */
  payload?: Record<string, unknown>;
}

export interface SseHelloEvent {
  type: 'hello';
  orgId: string;
  clientId: string;
  heartbeatSeconds: number;
}

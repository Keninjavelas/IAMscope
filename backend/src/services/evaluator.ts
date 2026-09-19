/**
 * IAM evaluation engine (Plan §10).
 *
 * Resolution order (§10.2): principal by org+ARN -> groups via `groupMemberships` -> direct +
 * group policy ids -> non-deleted policies -> optional permission boundary.
 *
 * Statement resolution uses the §10.3 aggregation pipeline (`$match` / `$lookup` / `$addFields` /
 * `$unwind` / `$group`) when the deployment supports it, with a plain-driver fallback.
 * Action/resource/condition matching always happens in JS: `$regexMatch` cannot be built from a
 * *per-statement* pattern inside a static pipeline, so the pipeline narrows by structure and the
 * authoritative wildcard matcher confirms each candidate.
 */
import { type ObjectId } from 'mongodb';
import type {
  ConditionOperator,
  EvaluationOutcome,
  PolicyCondition,
  PolicyEffect,
  PolicyStatement,
  TraceConditionResult,
  TraceEntry,
} from '@iamscope/types';
import { data } from '../db/data';
import type { PolicyDoc, PrincipalDoc } from '../db/documents';
import { logger } from '../logger';
import { oidRequired } from '../lib/objectId';
import { matchesAction, matchesResource, wildcardToRegExp } from '../lib/wildcard';

export { wildcardToRegExp };

/* ------------------------------------------------------------------ */
/* Condition context                                                   */
/* ------------------------------------------------------------------ */

export type ConditionContextValue = string | string[] | undefined;
export type ConditionContext = Record<string, ConditionContextValue>;

function normaliseContextValue(value: ConditionContextValue): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** v1 evaluates these three operators; anything else is accepted by the schema but not enforced. */
export const SUPPORTED_CONDITION_OPERATORS: readonly ConditionOperator[] = [
  'StringEquals',
  'StringLike',
  'ArnLike',
];

/**
 * True when the condition is satisfied for the request context.
 * A **missing** context key never satisfies a condition (Plan §10.4).
 */
export function conditionSatisfied(
  condition: PolicyCondition,
  actualValues: readonly string[],
): boolean {
  // NOTE(spec): StringNotEquals / ArnEquals / Bool / IpAddress / NotIpAddress are v2 operators
  // (Plan §2.2). v1 does not evaluate them, so they must not cause a false Deny. This check runs
  // before the "missing key" check on purpose.
  if (!SUPPORTED_CONDITION_OPERATORS.includes(condition.operator)) return true;

  // A **missing** context key never satisfies a v1 condition (Plan §10.4).
  if (actualValues.length === 0) return false;

  switch (condition.operator) {
    case 'StringEquals':
      return condition.values.some((expected) => actualValues.includes(expected));
    case 'StringLike':
      return condition.values.some((expected) =>
        actualValues.some((actual) => matchesResource(expected, actual)),
      );
    case 'ArnLike':
      return condition.values.some((expected) =>
        actualValues.some((actual) =>
          matchesResource(expected.toLowerCase(), actual.toLowerCase()),
        ),
      );
    default:
      return true;
  }
}

export function evaluateCondition(
  condition: PolicyCondition,
  context: ConditionContext,
): TraceConditionResult {
  const actual = normaliseContextValue(context[condition.key]);
  return {
    operator: condition.operator,
    key: condition.key,
    expected: condition.values,
    satisfied: conditionSatisfied(condition, actual),
  };
}

/* ------------------------------------------------------------------ */
/* Statement matching (§10.4)                                          */
/* ------------------------------------------------------------------ */

export interface StatementMatch {
  matched: boolean;
  matchedAction: string;
  matchedResource: string;
  conditions: TraceConditionResult[];
}

export const EMPTY_STATEMENT_MATCH: StatementMatch = {
  matched: false,
  matchedAction: '',
  matchedResource: '',
  conditions: [],
};

export function matchStatement(
  statement: PolicyStatement,
  action: string,
  resourceArn: string,
  context: ConditionContext = {},
): StatementMatch {
  const matchedAction = statement.actions.find((pattern) => matchesAction(pattern, action));
  if (matchedAction === undefined) return EMPTY_STATEMENT_MATCH;

  const matchedResource = statement.resources.find((pattern) =>
    matchesResource(pattern, resourceArn),
  );
  if (matchedResource === undefined) return EMPTY_STATEMENT_MATCH;

  const conditions = statement.conditions.map((condition) => evaluateCondition(condition, context));
  const conditionsOk = conditions.every((result) => result.satisfied);
  if (!conditionsOk) {
    return { matched: false, matchedAction, matchedResource, conditions };
  }

  return { matched: true, matchedAction, matchedResource, conditions };
}

/* ------------------------------------------------------------------ */
/* Pure evaluation (§10.5, §10.6)                                      */
/* ------------------------------------------------------------------ */

export type PolicySource = 'principal' | 'group' | 'boundary';

export interface EvaluatorPolicySource {
  id: string;
  name: string;
  arn: string;
  statements: PolicyStatement[];
  source: PolicySource;
  sourceName: string;
}

export interface BoundarySource {
  policyId: string;
  name: string;
  arn: string;
  statements: PolicyStatement[];
}

export interface PureEvaluationInput {
  /** Principal + group policies that produced at least one matching statement. */
  policies: EvaluatorPolicySource[];
  boundary?: BoundarySource | null;
  action: string;
  resourceArn: string;
  context?: ConditionContext;
  /**
   * Total number of policies attached to the principal (direct + group), including ones with no
   * matching statement. Distinguishes `implicit-deny` from `no-policy` (Plan §10.5).
   */
  attachedPolicyCount?: number | undefined;
}

export interface PureEvaluationResult {
  result: PolicyEffect;
  reason: EvaluationOutcome['reason'];
  trace: TraceEntry[];
  evaluatedPolicies: number;
  boundaryPolicyId: string | null;
}

function traceEntry(
  policy: EvaluatorPolicySource | BoundarySource,
  statement: PolicyStatement,
  match: StatementMatch,
  source: PolicySource,
  sourceName: string,
): TraceEntry {
  return {
    policyId: 'id' in policy ? policy.id : policy.policyId,
    policyName: policy.name,
    policyArn: policy.arn,
    sid: statement.sid,
    effect: statement.effect,
    matchedAction: match.matchedAction,
    matchedResource: match.matchedResource,
    matchedConditions: match.conditions,
    source,
    sourceName,
  };
}

/**
 * Applies the v1 result logic (Plan §10.5):
 * 1. explicit Deny wins, 2. else Allow, 3. else implicit Deny, 4. a boundary that does not
 * allow the action denies it.
 */
export function evaluatePolicies(input: PureEvaluationInput): PureEvaluationResult {
  const context = input.context ?? {};
  const boundary = input.boundary ?? null;
  const trace: TraceEntry[] = [];

  let hasAllow = false;
  let hasDeny = false;
  const matchedPolicyIds = new Set<string>();

  for (const policy of input.policies) {
    for (const statement of policy.statements) {
      const match = matchStatement(statement, input.action, input.resourceArn, context);
      if (!match.matched) continue;
      matchedPolicyIds.add(policy.id);
      trace.push(traceEntry(policy, statement, match, policy.source, policy.sourceName));
      if (statement.effect === 'Deny') hasDeny = true;
      else hasAllow = true;
    }
  }

  const attachedPolicyCount = Math.max(input.attachedPolicyCount ?? 0, input.policies.length);
  const evaluatedPolicies = attachedPolicyCount + (boundary === null ? 0 : 1);

  let boundaryAllows = false;
  let boundaryDenies = false;

  if (boundary !== null) {
    for (const statement of boundary.statements) {
      const match = matchStatement(statement, input.action, input.resourceArn, context);
      if (!match.matched) continue;
      trace.push(traceEntry(boundary, statement, match, 'boundary', boundary.name));
      if (statement.effect === 'Deny') boundaryDenies = true;
      else boundaryAllows = true;
    }
  }

  if (hasDeny) {
    return {
      result: 'Deny',
      reason: 'explicit-deny',
      trace,
      evaluatedPolicies,
      boundaryPolicyId: boundary?.policyId ?? null,
    };
  }

  // A boundary is a ceiling: existing but not granting the action means Deny (§10.5 rule 4).
  if (boundary !== null && (boundaryDenies || !boundaryAllows)) {
    return {
      result: 'Deny',
      reason: 'boundary-deny',
      trace,
      evaluatedPolicies,
      boundaryPolicyId: boundary.policyId,
    };
  }

  if (hasAllow) {
    return {
      result: 'Allow',
      reason: 'explicit-allow',
      trace,
      evaluatedPolicies,
      boundaryPolicyId: boundary?.policyId ?? null,
    };
  }

  return {
    result: 'Deny',
    // `no-policy` means the principal has nothing attached at all; a policy that simply did not
    // grant the action is an implicit deny.
    reason: attachedPolicyCount === 0 && boundary === null ? 'no-policy' : 'implicit-deny',
    trace,
    evaluatedPolicies,
    boundaryPolicyId: boundary?.policyId ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Resolution (§10.2, §10.3)                                           */
/* ------------------------------------------------------------------ */

export interface GroupSummary {
  id: ObjectId;
  name: string;
  arn: string;
  attachedPolicies: ObjectId[];
}

export interface StatementCandidate {
  policyId: string;
  policyName: string;
  policyArn: string;
  statement: PolicyStatement;
}

export interface PrincipalResolution {
  principal: PrincipalDoc;
  groups: GroupSummary[];
  candidates: StatementCandidate[];
  /** Distinct policies whose statements were considered. */
  policyCount: number;
  resolvedVia: 'aggregation' | 'driver';
}

interface AggregatedStatementRow {
  policyId: ObjectId;
  policyName: string;
  policyArn: string;
  statement: PolicyStatement;
}

interface AggregatedResolutionRow {
  statements: AggregatedStatementRow[];
  groups: { _id: ObjectId; name: string; arn: string; attachedPolicies: ObjectId[] }[];
  /** Policies that produced at least one candidate statement. */
  policyCount: number;
  /** Policies attached to the principal + its groups, matching or not. */
  allPolicyCount: number;
}

function staticRegex(value: string): RegExp {
  return new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
}

/** §10.3 pipeline. Returns `null` when it cannot produce a usable result so the caller falls back. */
async function resolveViaAggregation(
  orgId: ObjectId,
  principalArn: string,
  action: string,
  resourceArn: string,
): Promise<AggregatedResolutionRow | null> {
  const actionRegex = staticRegex(action);
  const resourceRegex = staticRegex(resourceArn);

  const rows = await data
    .principals()
    .aggregate<AggregatedResolutionRow>([
      { $match: { orgId, arn: principalArn, deleted: { $ne: true } } },
      {
        $lookup: {
          from: 'principals',
          let: { groupArns: { $ifNull: ['$groupMemberships', []] } },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$orgId', orgId] },
                    { $eq: ['$type', 'Group'] },
                    { $ne: ['$deleted', true] },
                    { $in: ['$arn', '$$groupArns'] },
                  ],
                },
              },
            },
            { $project: { name: 1, arn: 1, attachedPolicies: 1 } },
          ],
          as: 'groups',
        },
      },
      {
        $addFields: {
          groupPolicyIds: {
            $reduce: {
              input: { $ifNull: ['$groups', []] },
              initialValue: [],
              in: { $concatArrays: ['$$value', { $ifNull: ['$$this.attachedPolicies', []] }] },
            },
          },
        },
      },
      {
        $addFields: {
          allPolicyIds: { $setUnion: [{ $ifNull: ['$attachedPolicies', []] }, '$groupPolicyIds'] },
        },
      },
      {
        $lookup: {
          from: 'policies',
          let: { ids: '$allPolicyIds' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$orgId', orgId] },
                    { $ne: ['$deleted', true] },
                    { $in: ['$_id', '$$ids'] },
                  ],
                },
              },
            },
          ],
          as: 'policies',
        },
      },
      { $unwind: '$policies' },
      { $unwind: '$policies.statements' },
      {
        $match: {
          $expr: {
            $and: [
              {
                $anyElementTrue: {
                  $map: {
                    input: { $ifNull: ['$policies.statements.actions', []] },
                    in: {
                      $or: [
                        { $regexMatch: { input: '$$this', regex: actionRegex } },
                        { $regexMatch: { input: '$$this', regex: /[*?]/ } },
                      ],
                    },
                  },
                },
              },
              {
                $anyElementTrue: {
                  $map: {
                    input: { $ifNull: ['$policies.statements.resources', []] },
                    in: {
                      $or: [
                        { $regexMatch: { input: '$$this', regex: resourceRegex } },
                        { $eq: ['$$this', '*'] },
                        { $regexMatch: { input: '$$this', regex: /[*?]/ } },
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          groups: { $first: '$groups' },
          allPolicyCount: { $first: { $size: { $ifNull: ['$allPolicyIds', []] } } },
          policyCount: { $addToSet: '$policies._id' },
          statements: {
            $push: {
              policyId: '$policies._id',
              policyName: '$policies.name',
              policyArn: '$policies.arn',
              statement: '$policies.statements',
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          groups: 1,
          statements: 1,
          allPolicyCount: 1,
          policyCount: { $size: '$policyCount' },
        },
      },
    ])
    .toArray();

  const first = rows[0];
  if (first === undefined) return null;
  return first;
}

async function resolveViaDriver(
  orgId: ObjectId,
  principal: PrincipalDoc,
  action: string,
  resourceArn: string,
): Promise<PrincipalResolution> {
  const groups =
    principal.groupMemberships.length === 0
      ? []
      : await data
          .principals()
          .find({
            orgId,
            type: 'Group',
            arn: { $in: principal.groupMemberships },
            deleted: { $ne: true },
          })
          .toArray();

  const ids = new Map<string, ObjectId>();
  for (const id of principal.attachedPolicies) ids.set(oidRequired(id), id);
  for (const group of groups) for (const id of group.attachedPolicies) ids.set(oidRequired(id), id);

  const policies: PolicyDoc[] =
    ids.size === 0
      ? []
      : await data
          .policies()
          .find({ orgId, _id: { $in: [...ids.values()] }, deleted: { $ne: true } })
          .toArray();

  const candidates: StatementCandidate[] = [];
  for (const policy of policies) {
    for (const statement of policy.statements) {
      if (matchStatement(statement, action, resourceArn).matched) {
        candidates.push({
          policyId: oidRequired(policy._id),
          policyName: policy.name,
          policyArn: policy.arn,
          statement,
        });
      }
    }
  }

  return {
    principal,
    groups: groups.map((group) => ({
      id: group._id,
      name: group.name,
      arn: group.arn,
      attachedPolicies: group.attachedPolicies,
    })),
    candidates,
    policyCount: policies.length,
    resolvedVia: 'driver',
  };
}

/**
 * Resolves principal -> groups -> policies -> matching statement candidates.
 * Tries the §10.3 aggregation pipeline first; falls back to the plain driver on any error or
 * empty result. Returns `null` when the principal does not exist in the org.
 */
export async function resolvePrincipal(
  orgId: ObjectId,
  principalArn: string,
  action: string,
  resourceArn: string,
): Promise<PrincipalResolution | null> {
  const principal = await data
    .principals()
    .findOne({ orgId, arn: principalArn, deleted: { $ne: true } });
  if (principal === null) return null;

  try {
    const aggregated = await resolveViaAggregation(orgId, principalArn, action, resourceArn);
    if (aggregated !== null && aggregated.statements.length > 0) {
      return {
        principal,
        groups: aggregated.groups.map((group) => ({
          id: group._id,
          name: group.name,
          arn: group.arn,
          attachedPolicies: group.attachedPolicies,
        })),
        candidates: aggregated.statements.map((row) => ({
          policyId: oidRequired(row.policyId),
          policyName: row.policyName,
          policyArn: row.policyArn,
          statement: row.statement,
        })),
        policyCount: Math.max(aggregated.allPolicyCount, aggregated.policyCount),
        resolvedVia: 'aggregation',
      };
    }
  } catch (error) {
    logger.warn(
      { err: error, orgId: oidRequired(orgId) },
      'statement aggregation failed - using plain driver',
    );
  }

  return resolveViaDriver(orgId, principal, action, resourceArn);
}

function buildSources(resolution: PrincipalResolution): EvaluatorPolicySource[] {
  const direct = new Set(resolution.principal.attachedPolicies.map(oidRequired));
  const groupByPolicyId = new Map<string, string>();
  for (const group of resolution.groups) {
    for (const policyId of group.attachedPolicies) {
      const key = oidRequired(policyId);
      if (!groupByPolicyId.has(key)) groupByPolicyId.set(key, group.name);
    }
  }

  const byPolicy = new Map<string, EvaluatorPolicySource>();
  for (const candidate of resolution.candidates) {
    const existing = byPolicy.get(candidate.policyId);
    if (existing !== undefined) {
      existing.statements.push(candidate.statement);
      continue;
    }
    const fromGroup = !direct.has(candidate.policyId) && groupByPolicyId.has(candidate.policyId);
    byPolicy.set(candidate.policyId, {
      id: candidate.policyId,
      name: candidate.policyName,
      arn: candidate.policyArn,
      statements: [candidate.statement],
      source: fromGroup ? 'group' : 'principal',
      sourceName: fromGroup
        ? (groupByPolicyId.get(candidate.policyId) ?? resolution.principal.name)
        : resolution.principal.name,
    });
  }

  return [...byPolicy.values()];
}

async function loadBoundary(
  orgId: ObjectId,
  principal: PrincipalDoc,
): Promise<BoundarySource | null> {
  if (principal.boundaryPolicyId === null) return null;
  const policy = await data
    .policies()
    .findOne({ orgId, _id: principal.boundaryPolicyId, deleted: { $ne: true } });
  if (policy === null) return null;
  return {
    policyId: oidRequired(policy._id),
    name: policy.name,
    arn: policy.arn,
    statements: policy.statements,
  };
}

export interface EvaluateRequest {
  principalArn: string;
  action: string;
  resourceArn: string;
  context?: ConditionContext;
}

/** Full evaluation against Mongo, returning the §10.6 trace. */
export async function evaluateForOrg(
  orgId: ObjectId,
  request: EvaluateRequest,
): Promise<EvaluationOutcome> {
  const startedAt = Date.now();
  const context = request.context ?? {};

  const resolution = await resolvePrincipal(
    orgId,
    request.principalArn,
    request.action,
    request.resourceArn,
  );

  if (resolution === null) {
    return {
      result: 'Deny',
      reason: 'no-policy',
      trace: [],
      evaluatedPolicies: 0,
      durationMs: Date.now() - startedAt,
      principalArn: request.principalArn,
      action: request.action,
      resourceArn: request.resourceArn,
      boundaryPolicyId: null,
    };
  }

  const boundary = await loadBoundary(orgId, resolution.principal);
  const evaluated = evaluatePolicies({
    policies: buildSources(resolution),
    boundary,
    action: request.action,
    resourceArn: request.resourceArn,
    context,
    attachedPolicyCount: resolution.policyCount,
  });

  return {
    result: evaluated.result,
    reason: evaluated.reason,
    trace: evaluated.trace,
    evaluatedPolicies: evaluated.evaluatedPolicies,
    durationMs: Date.now() - startedAt,
    principalArn: request.principalArn,
    action: request.action,
    resourceArn: request.resourceArn,
    boundaryPolicyId: evaluated.boundaryPolicyId,
  };
}

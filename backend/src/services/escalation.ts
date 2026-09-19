/**
 * Escalation engine (Plan §11): five v1 pattern detectors, `$graphLookup` traversal over
 * `principals.assumeRoleTargets` to depth 5, severity by hop count, cached in `escalation_paths`.
 */
import { ObjectId } from 'mongodb';
import type {
  EscalationGraphPayload,
  EscalationHop,
  EscalationSeverity,
  GraphEdge,
  GraphNode,
  PolicyStatement,
} from '@iamscope/types';
import { data } from '../db/data';
import type { EscalationPathDoc, PolicyDoc, PrincipalDoc } from '../db/documents';
import { logger } from '../logger';
import { matchesAction } from '../lib/wildcard';
import { oidRequired } from '../lib/objectId';
import { toEscalationPathDTO } from '../lib/serialize';

export const MAX_GRAPH_DEPTH = 5;

/* ------------------------------------------------------------------ */
/* Pattern detectors (§11.1) - pure                                    */
/* ------------------------------------------------------------------ */

export interface PatternDefinition {
  pattern: string;
  label: string;
  via: EscalationHop['via'];
  actions: readonly string[];
  /** `all` = every action must be granted in sequence; `any` = one of them suffices. */
  mode: 'all' | 'any';
  /** True when the pattern escalates the principal's *own* permissions. */
  selfEscalating: boolean;
}

export const ESCALATION_PATTERNS: readonly PatternDefinition[] = [
  {
    pattern: 'passrole-createfunction-invoke',
    label: 'iam:PassRole + lambda:CreateFunction + lambda:InvokeFunction',
    via: 'create-function',
    actions: ['iam:PassRole', 'lambda:CreateFunction', 'lambda:InvokeFunction'],
    mode: 'all',
    selfEscalating: false,
  },
  {
    pattern: 'passrole-runinstances',
    label: 'iam:PassRole + ec2:RunInstances',
    via: 'run-instances',
    actions: ['iam:PassRole', 'ec2:RunInstances'],
    mode: 'all',
    selfEscalating: false,
  },
  {
    pattern: 'create-policy-version-set-default',
    label: 'iam:CreatePolicyVersion + iam:SetDefaultPolicyVersion',
    via: 'create-policy-version',
    actions: ['iam:CreatePolicyVersion', 'iam:SetDefaultPolicyVersion'],
    mode: 'all',
    selfEscalating: true,
  },
  {
    pattern: 'attach-policy',
    label: 'iam:AttachUserPolicy / iam:AttachRolePolicy / iam:AttachGroupPolicy',
    via: 'attach-policy',
    actions: ['iam:AttachUserPolicy', 'iam:AttachRolePolicy', 'iam:AttachGroupPolicy'],
    mode: 'any',
    selfEscalating: true,
  },
  {
    pattern: 'assume-role-broader',
    label: 'sts:AssumeRole into a broader role',
    via: 'assume-role',
    actions: ['sts:AssumeRole'],
    mode: 'any',
    selfEscalating: false,
  },
];

export interface ActionGrant {
  granted: boolean;
  /** `policyId:sid` of the Allow statement that granted it, when one exists. */
  grantedBy: string | null;
  /** The matching action pattern from the statement. */
  matchedPattern: string | null;
  denied: boolean;
}

const EMPTY_GRANT: ActionGrant = {
  granted: false,
  grantedBy: null,
  matchedPattern: null,
  denied: false,
};

/**
 * Statement-level grant check: an Allow wins unless a matching Deny also covers the action.
 * `policyId` is used to build the `policyId:sid` reference stored on the hop.
 */
export function statementGrantsAction(
  statements: readonly PolicyStatement[],
  action: string,
  policyId = '',
): ActionGrant {
  let grantedBy: string | null = null;
  let matchedPattern: string | null = null;
  let denied = false;

  for (const statement of statements) {
    const pattern = statement.actions.find((candidate) => matchesAction(candidate, action));
    if (pattern === undefined) continue;
    if (statement.effect === 'Deny') {
      denied = true;
      continue;
    }
    if (grantedBy === null) {
      grantedBy = `${policyId}:${statement.sid}`;
      matchedPattern = pattern;
    }
  }

  if (denied) return { granted: false, grantedBy: null, matchedPattern: null, denied: true };
  if (grantedBy === null) return EMPTY_GRANT;
  return { granted: true, grantedBy, matchedPattern, denied: false };
}

export interface DetectedPattern {
  pattern: string;
  label: string;
  via: EscalationHop['via'];
  actions: readonly string[];
  selfEscalating: boolean;
  /** `policyId:sid` references that granted the required actions. */
  grantedBy: string[];
  /** The action patterns that matched, for hop labels. */
  matchedPatterns: string[];
}

/** Detects which of the five v1 escalation patterns the given statements grant. */
export function detectPatterns(
  statements: readonly PolicyStatement[],
  policyId = '',
): DetectedPattern[] {
  const detected: DetectedPattern[] = [];

  for (const definition of ESCALATION_PATTERNS) {
    const grants = definition.actions.map((action) =>
      statementGrantsAction(statements, action, policyId),
    );
    const qualified =
      definition.mode === 'all'
        ? grants.every((grant) => grant.granted)
        : grants.some((grant) => grant.granted);
    if (!qualified) continue;

    detected.push({
      pattern: definition.pattern,
      label: definition.label,
      via: definition.via,
      actions: definition.actions,
      selfEscalating: definition.selfEscalating,
      grantedBy: grants.filter((grant) => grant.granted).map((grant) => grant.grantedBy ?? ''),
      matchedPatterns: grants
        .filter((grant) => grant.granted)
        .map((grant) => grant.matchedPattern ?? ''),
    });
  }

  return detected;
}

/** 1 hop -> low, 2 hops -> medium, 3+ hops -> high (Plan §11.3). */
export function severityForHops(hopCount: number): EscalationSeverity {
  if (hopCount <= 1) return 'low';
  if (hopCount === 2) return 'medium';
  return 'high';
}

export function computePolicySnapshotVersion(
  policies: readonly Pick<PolicyDoc, 'currentVersion'>[],
): number {
  return policies.reduce((total, policy) => total + policy.currentVersion, 0) + policies.length;
}

/* ------------------------------------------------------------------ */
/* Traversal (§11.2)                                                   */
/* ------------------------------------------------------------------ */

export interface ReachableTarget {
  arn: string;
  name: string;
  hops: number;
  chain: string[];
}

/** BFS over `assumeRoleTargets`, capped at `maxDepth`. Pure - operates on an in-memory map. */
export function traverseAssumeRoleTargets(
  fromArn: string,
  principalByArn: ReadonlyMap<string, PrincipalDoc>,
  maxDepth: number = MAX_GRAPH_DEPTH,
): ReachableTarget[] {
  const results: ReachableTarget[] = [];
  const visited = new Set<string>([fromArn]);
  let frontier: { arn: string; chain: string[] }[] = [{ arn: fromArn, chain: [fromArn] }];

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const next: { arn: string; chain: string[] }[] = [];
    for (const node of frontier) {
      const principal = principalByArn.get(node.arn);
      if (principal === undefined) continue;
      for (const targetArn of principal.assumeRoleTargets) {
        if (visited.has(targetArn)) continue;
        visited.add(targetArn);
        const chain = [...node.chain, targetArn];
        const target = principalByArn.get(targetArn);
        results.push({
          arn: targetArn,
          name: target?.name ?? targetArn.split('/').pop() ?? targetArn,
          hops: depth,
          chain,
        });
        next.push({ arn: targetArn, chain });
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }

  return results;
}

/** `$graphLookup` reachable set, used before the BFS depths are computed. Falls back to `null`. */
async function graphLookupReachable(
  orgId: ObjectId,
  fromArn: string,
  maxDepth: number,
): Promise<string[] | null> {
  try {
    const rows = await data
      .principals()
      .aggregate<{ reachable: { arn: string }[] }>([
        { $match: { orgId, arn: fromArn, deleted: { $ne: true } } },
        {
          $graphLookup: {
            from: 'principals',
            startWith: '$assumeRoleTargets',
            connectFromField: 'assumeRoleTargets',
            connectToField: 'arn',
            as: 'reachable',
            maxDepth: Math.max(0, maxDepth - 1),
            restrictSearchWithMatch: { orgId, deleted: { $ne: true } },
          },
        },
        { $project: { reachable: { arn: 1 } } },
      ])
      .toArray();

    const first = rows[0];
    if (first === undefined) return null;
    return first.reachable.map((row) => row.arn);
  } catch (error) {
    logger.warn({ err: error }, '$graphLookup unavailable - falling back to in-memory traversal');
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Persistence (§11.3, §11.4)                                          */
/* ------------------------------------------------------------------ */

export interface ComputeEscalationOptions {
  fromPrincipalArn?: string | undefined;
  maxDepth?: number | undefined;
}

interface PrincipalBundle {
  principal: PrincipalDoc;
  statements: PolicyStatement[];
  policyId: string;
  policyNames: Map<string, string>;
}

async function loadPrincipalBundles(
  orgId: ObjectId,
  filter: Record<string, unknown>,
): Promise<{
  principals: PrincipalDoc[];
  byArn: Map<string, PrincipalDoc>;
  bundles: Map<string, PrincipalBundle>;
  policies: PolicyDoc[];
}> {
  const principals = await data
    .principals()
    .find({ orgId, deleted: { $ne: true }, ...filter })
    .toArray();
  const policies = await data
    .policies()
    .find({ orgId, deleted: { $ne: true } })
    .toArray();
  const policyById = new Map(policies.map((policy) => [oidRequired(policy._id), policy]));

  const groupArns = new Set<string>();
  for (const principal of principals) {
    if (principal.type === 'Group') continue;
    for (const arn of principal.groupMemberships) groupArns.add(arn);
  }

  const groups =
    groupArns.size === 0
      ? []
      : await data
          .principals()
          .find({ orgId, type: 'Group', arn: { $in: [...groupArns] }, deleted: { $ne: true } })
          .toArray();

  const byArn = new Map<string, PrincipalDoc>();
  for (const principal of principals) byArn.set(principal.arn, principal);
  for (const group of groups) byArn.set(group.arn, group);

  const bundles = new Map<string, PrincipalBundle>();
  for (const principal of principals) {
    const statements: PolicyStatement[] = [];
    const policyNames = new Map<string, string>();
    let firstPolicyId = '';

    const attachedIds = [...principal.attachedPolicies];
    for (const arn of principal.groupMemberships) {
      const group = byArn.get(arn);
      if (group === undefined) continue;
      attachedIds.push(...group.attachedPolicies);
    }

    for (const policyId of attachedIds) {
      const key = oidRequired(policyId);
      const policy = policyById.get(key);
      if (policy === undefined) continue;
      if (firstPolicyId === '') firstPolicyId = key;
      policyNames.set(key, policy.name);
      statements.push(...policy.statements);
    }

    bundles.set(principal.arn, { principal, statements, policyId: firstPolicyId, policyNames });
  }

  return { principals, byArn, bundles, policies };
}

function hopForTarget(
  target: PrincipalDoc | undefined,
  arn: string,
  policy: PolicyDoc | null,
  sid: string | null,
  action: string,
): EscalationHop {
  return {
    via: 'assume-role',
    target: arn,
    targetName: target?.name ?? arn.split('/').pop() ?? arn,
    policyId: policy === null ? null : oidRequired(policy._id),
    policyName: policy?.name ?? null,
    sid,
    action,
  };
}

export interface ComputeEscalationResult {
  paths: EscalationPathDoc[];
  policySnapshotVersion: number;
  truncated: boolean;
}

/**
 * Recomputes escalation paths for an org (or a single principal) and upserts them.
 * `switch` is atomic per (orgId, from, to) via the unique index.
 */
export async function computeEscalationPaths(
  orgId: ObjectId,
  options: ComputeEscalationOptions = {},
): Promise<ComputeEscalationResult> {
  const maxDepth = Math.min(Math.max(options.maxDepth ?? MAX_GRAPH_DEPTH, 1), MAX_GRAPH_DEPTH);
  const filter = options.fromPrincipalArn === undefined ? {} : { arn: options.fromPrincipalArn };
  const { principals, byArn, bundles, policies } = await loadPrincipalBundles(orgId, filter);
  const policySnapshotVersion = computePolicySnapshotVersion(policies);
  const now = new Date();
  const computed: EscalationPathDoc[] = [];
  const policyById = new Map(policies.map((policy) => [oidRequired(policy._id), policy]));

  for (const principal of principals) {
    const bundle = bundles.get(principal.arn);
    if (bundle === undefined) continue;

    const detected = detectPatterns(bundle.statements, bundle.policyId);
    if (detected.length === 0) continue;

    const reachable = traverseAssumeRoleTargets(principal.arn, byArn, maxDepth);

    // `$graphLookup` result is used to sanity-check the in-memory traversal; if it disagrees we
    // trust the BFS (it carries hop counts) but log the divergence.
    if (reachable.length > 0) {
      const viaLookup = await graphLookupReachable(orgId, principal.arn, maxDepth);
      if (viaLookup !== null && viaLookup.length > reachable.length) {
        logger.debug(
          { orgId: oidRequired(orgId), from: principal.arn },
          'graphLookup found more nodes than BFS',
        );
      }
    }

    for (const pattern of detected) {
      if (pattern.selfEscalating) {
        const policyId = pattern.grantedBy[0]?.split(':')[0] ?? '';
        const policy = policyById.get(policyId) ?? null;
        const hop: EscalationHop = {
          via: pattern.via,
          target: principal.arn,
          targetName: principal.name,
          policyId: policy === null ? null : oidRequired(policy._id),
          policyName: policy?.name ?? null,
          sid: pattern.grantedBy[0]?.split(':')[1] ?? null,
          action: pattern.actions[0] ?? '',
        };
        computed.push({
          _id: new ObjectId(),
          orgId,
          pattern: pattern.pattern,
          fromPrincipalArn: principal.arn,
          fromPrincipalName: principal.name,
          toPrincipalArn: principal.arn,
          toPrincipalName: principal.name,
          hops: [hop],
          severity: severityForHops(1),
          computedAt: now,
          policySnapshotVersion,
        });
        continue;
      }

      for (const target of reachable) {
        const targetDoc = byArn.get(target.arn);
        const chain: EscalationHop[] = [];
        for (let index = 1; index < target.chain.length; index += 1) {
          const arn = target.chain[index] ?? '';
          chain.push(hopForTarget(byArn.get(arn), arn, null, null, 'sts:AssumeRole'));
        }

        const policyId = pattern.grantedBy[0]?.split(':')[0] ?? '';
        const policy = policyById.get(policyId) ?? null;
        chain.push({
          via: pattern.via,
          target: target.arn,
          targetName: targetDoc?.name ?? target.name,
          policyId: policy === null ? null : oidRequired(policy._id),
          policyName: policy?.name ?? null,
          sid: pattern.grantedBy[0]?.split(':')[1] ?? null,
          action: pattern.actions[0] ?? '',
        });

        computed.push({
          _id: new ObjectId(),
          orgId,
          pattern: pattern.pattern,
          fromPrincipalArn: principal.arn,
          fromPrincipalName: principal.name,
          toPrincipalArn: target.arn,
          toPrincipalName: targetDoc?.name ?? target.name,
          hops: chain,
          severity: severityForHops(chain.length),
          computedAt: now,
          policySnapshotVersion,
        });
      }
    }
  }

  if (computed.length > 0) {
    // `updateOne` + `$setOnInsert`, never `replaceOne`: replacing a matched document
    // with a fresh `_id` is rejected by MongoDB ("the (immutable) field '_id' was found
    // to have been altered"), which used to kill the seed and every recomputation after
    // a policy mutation. `$setOnInsert` only applies on the insert branch, so an existing
    // path keeps its `_id` while a brand-new one is born with the id we hand back below.
    await data.escalationPaths().bulkWrite(
      computed.map((path) => {
        const { _id, ...fields } = path;
        return {
          updateOne: {
            filter: {
              orgId,
              fromPrincipalArn: path.fromPrincipalArn,
              toPrincipalArn: path.toPrincipalArn,
            },
            update: { $set: fields, $setOnInsert: { _id } },
            upsert: true,
          },
        };
      }),
      { ordered: false },
    );
  }

  return { paths: computed, policySnapshotVersion, truncated: computed.length >= 500 };
}

/** Deletes cached paths originating from the affected principals and re-enqueues computation. */
export async function invalidateForPrincipals(
  orgId: ObjectId,
  principalArns: readonly string[],
): Promise<number> {
  if (principalArns.length === 0) return 0;
  const result = await data
    .escalationPaths()
    .deleteMany({ orgId, fromPrincipalArn: { $in: [...principalArns] } });
  logger.debug(
    { orgId: oidRequired(orgId), removed: result.deletedCount },
    'escalation paths invalidated',
  );
  return result.deletedCount;
}

export async function invalidateForPolicy(orgId: ObjectId): Promise<number> {
  const result = await data.escalationPaths().deleteMany({ orgId });
  return result.deletedCount;
}

export async function listEscalationPaths(
  orgId: ObjectId,
  fromPrincipalArn?: string,
  limit = 500,
): Promise<EscalationPathDoc[]> {
  const filter: Record<string, unknown> = { orgId };
  if (fromPrincipalArn !== undefined) filter.fromPrincipalArn = fromPrincipalArn;

  return data
    .escalationPaths()
    .find(filter)
    .sort({ severity: -1, computedAt: -1 })
    .limit(limit)
    .toArray();
}

/* ------------------------------------------------------------------ */
/* Graph payload (§15.5)                                               */
/* ------------------------------------------------------------------ */

export interface EscalationGraphOptions {
  fromPrincipalArn?: string | undefined;
  maxDepth?: number | undefined;
  refresh?: boolean | undefined;
}

const VIA_KIND: Record<EscalationHop['via'], GraphEdge['kind']> = {
  'assume-role': 'assume-role',
  'pass-role': 'pass-role',
  'attach-policy': 'attach-policy',
  'create-function': 'create-function',
  'invoke-function': 'invoke-function',
  'run-instances': 'run-instances',
  'create-policy-version': 'create-policy-version',
  'set-default-policy-version': 'set-default-policy-version',
  'group-membership': 'group-membership',
};

/** Builds the node/edge payload the Graph lens renders. */
export function buildGraphPayload(
  paths: readonly EscalationPathDoc[],
  principalsByArn: ReadonlyMap<string, PrincipalDoc>,
  computedAt: Date,
  truncated = false,
): EscalationGraphPayload {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  const nodeFor = (arn: string, fallbackName?: string, hopDepth = 0): GraphNode => {
    const existing = nodes.get(arn);
    const doc = principalsByArn.get(arn);
    const node: GraphNode = existing ?? {
      id: arn,
      arn,
      name: doc?.name ?? fallbackName ?? arn.split('/').pop() ?? arn,
      type: doc?.type ?? 'Role',
      severity: null,
      hopDepth,
      tags: doc?.tags ?? {},
    };
    if (hopDepth > node.hopDepth) node.hopDepth = hopDepth;
    nodes.set(arn, node);
    return node;
  };

  for (const path of paths) {
    const from = nodeFor(path.fromPrincipalArn, path.fromPrincipalName, 0);
    if (from.severity === null || from.severity === 'low') from.severity = path.severity;

    let previous = path.fromPrincipalArn;
    path.hops.forEach((hop, index) => {
      const target = nodeFor(hop.target, hop.targetName, index + 1);
      const severity = severityForHops(index + 1);
      target.severity ??= severity;

      const edgeId = `${previous}->${hop.target}:${hop.via}`;
      const existing = edges.get(edgeId);
      if (existing === undefined) {
        edges.set(edgeId, {
          id: edgeId,
          source: previous,
          target: hop.target,
          kind: VIA_KIND[hop.via],
          weight: 1,
          label: hop.action === '' ? hop.via : hop.action,
          onEscalationPath: true,
        });
      } else {
        existing.weight += 1;
      }
      previous = hop.target;
    });
  }

  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    paths: paths.map(toEscalationPathDTO),
    computedAt: computedAt.toISOString(),
    truncated,
  };
}

/** Convenience wrapper used by the graph routes. */
export async function getEscalationGraph(
  orgId: ObjectId,
  options: EscalationGraphOptions = {},
): Promise<EscalationGraphPayload> {
  if (options.fromPrincipalArn === undefined && options.refresh !== true) {
    const cached = await listEscalationPaths(orgId, undefined, 500);
    if (cached.length > 0) {
      const principals = await data.principals().find({ orgId }).toArray();
      const byArn = new Map(principals.map((principal) => [principal.arn, principal]));
      return buildGraphPayload(cached, byArn, new Date(), false);
    }
  }

  const result = await computeEscalationPaths(orgId, {
    fromPrincipalArn: options.fromPrincipalArn,
    maxDepth: options.maxDepth,
  });
  const principals = await data.principals().find({ orgId }).toArray();
  const byArn = new Map(principals.map((principal) => [principal.arn, principal]));
  return buildGraphPayload(result.paths, byArn, new Date(), result.truncated);
}

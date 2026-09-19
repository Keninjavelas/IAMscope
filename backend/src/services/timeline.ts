/**
 * Timeline engine (Plan §12).
 *
 * `reconstructState(orgId, at)` rebuilds the org at a point in time: the latest
 * `policy_versions` row per policy with `createdAt <= at`, plus principals/resources taken from
 * the latest `audit_events` at or before `at`, falling back to current state when a document has
 * no history. Results are cached in-process, keyed by `(orgId, at rounded to the minute)`.
 */
import { type ObjectId } from 'mongodb';
import type {
  PolicyStatement,
  TimelineBucket,
  TimelineChangeSummary,
  TimelineCategory,
  TimelineDiffPreview,
  TimelineEventMarker,
  TimelineEventsPayload,
  TimelineState,
  TimelineStatePolicy,
  TimelineStatePrincipal,
  TimelineStateResource,
} from '@iamscope/types';
import { TIMELINE_CATEGORIES } from '@iamscope/types';
import { data } from '../db/data';
import type { AuditEventDoc, PrincipalDoc, ResourceDoc } from '../db/documents';
import { oidRequired, oidString } from '../lib/objectId';
import { auditCategory } from './audit';

export const MAX_CACHE_ENTRIES = 256;

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

export function roundToMinute(at: Date): Date {
  const rounded = new Date(at);
  rounded.setSeconds(0, 0);
  return rounded;
}

export function timelineCacheKey(orgId: ObjectId | string, at: Date): string {
  const id = typeof orgId === 'string' ? orgId : orgId.toHexString();
  return `${id}:${roundToMinute(at).toISOString()}`;
}

export function emptyCategoryCounts(): Record<TimelineCategory, number> {
  const counts = {} as Record<TimelineCategory, number>;
  for (const category of TIMELINE_CATEGORIES) counts[category] = 0;
  return counts;
}

export interface BucketInput {
  timestamp: Date;
  category: TimelineCategory;
}

/** Groups events into UTC day buckets (Plan §12.3). Pure - unit tested. */
export function bucketByDay(events: readonly BucketInput[]): TimelineBucket[] {
  const byDay = new Map<string, TimelineBucket>();

  for (const event of events) {
    const day = event.timestamp.toISOString().slice(0, 10);
    let bucket = byDay.get(day);
    if (bucket === undefined) {
      bucket = { day, counts: emptyCategoryCounts(), total: 0 };
      byDay.set(day, bucket);
    }
    bucket.counts[event.category] += 1;
    bucket.total += 1;
  }

  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

function summaryForAction(action: string, targetName: string): string {
  const verb = action.includes('.') ? (action.split('.')[1] ?? action) : action;
  return `${verb.replace(/[.-]/g, ' ')}: ${targetName}`;
}

export function toEventMarker(doc: AuditEventDoc): TimelineEventMarker {
  return {
    id: oidRequired(doc._id),
    timestamp: doc.timestamp.toISOString(),
    action: doc.action,
    category: auditCategory(doc.action),
    actorEmail: doc.actorEmail,
    targetType: doc.target.type,
    targetId: doc.target.id,
    targetName: doc.target.name,
    summary: summaryForAction(doc.action, doc.target.name),
  };
}

/* ------------------------------------------------------------------ */
/* Cache                                                               */
/* ------------------------------------------------------------------ */

const cache = new Map<string, TimelineState>();

function cacheGet(key: string): TimelineState | undefined {
  const hit = cache.get(key);
  if (hit === undefined) return undefined;
  // Refresh recency for the LRU ordering.
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function cacheSet(key: string, value: TimelineState): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, value);
}

/** Invalidated by any mutation in the org (Plan §12.2). */
export function invalidateTimelineCache(orgId?: ObjectId | string): void {
  if (orgId === undefined) {
    cache.clear();
    return;
  }
  const id = typeof orgId === 'string' ? orgId : orgId.toHexString();
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${id}:`)) cache.delete(key);
  }
}

export function timelineCacheSize(): number {
  return cache.size;
}

/* ------------------------------------------------------------------ */
/* Reconstruction                                                      */
/* ------------------------------------------------------------------ */

interface VersionRow {
  _id: ObjectId;
  policyId: ObjectId;
  version: number;
  statements: PolicyStatement[];
  createdAt: Date;
}

async function latestVersionsAt(orgId: ObjectId, at: Date): Promise<Map<string, VersionRow>> {
  const rows = await data
    .policyVersions()
    .aggregate<VersionRow>([
      { $match: { orgId, createdAt: { $lte: at } } },
      { $sort: { version: -1 } },
      { $group: { _id: '$policyId', doc: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } },
    ])
    .toArray();

  const byPolicy = new Map<string, VersionRow>();
  for (const row of rows) byPolicy.set(oidRequired(row.policyId), row);
  return byPolicy;
}

function policyFromVersion(
  policyId: string,
  name: string,
  arn: string,
  version: VersionRow | undefined,
  fallback: { version: number; statements: PolicyStatement[]; mutatedAt: Date; deleted: boolean },
): TimelineStatePolicy {
  return {
    policyId,
    name,
    arn,
    version: version?.version ?? fallback.version,
    statements: version?.statements ?? fallback.statements,
    deleted: fallback.deleted,
    mutatedAt: (version?.createdAt ?? fallback.mutatedAt).toISOString(),
  };
}

interface SnapshotRecord {
  id: string;
  payload: Record<string, unknown> | null;
  mutatedAt: Date;
  deleted: boolean;
}

function latestAuditSnapshots(
  events: readonly AuditEventDoc[],
  prefix: string,
): Map<string, SnapshotRecord> {
  const byId = new Map<string, SnapshotRecord>();

  for (const event of events) {
    if (!event.action.startsWith(prefix)) continue;
    const id = event.target.id;
    if (event.action.endsWith('.delete')) {
      const previous = byId.get(id);
      byId.set(id, {
        id,
        payload: previous?.payload ?? event.before ?? null,
        mutatedAt: event.timestamp,
        deleted: true,
      });
      continue;
    }
    byId.set(id, {
      id,
      payload: event.after ?? event.before ?? null,
      mutatedAt: event.timestamp,
      deleted: false,
    });
  }

  return byId;
}

function principalFromSnapshot(
  record: SnapshotRecord,
  current: PrincipalDoc | undefined,
): TimelineStatePrincipal {
  const payload = record.payload ?? {};
  const attachedPolicies = Array.isArray(payload.attachedPolicies)
    ? (payload.attachedPolicies as unknown[]).map((value) => String(value))
    : (current?.attachedPolicies ?? []).map(oidRequired);

  const groupMemberships = Array.isArray(payload.groupMemberships)
    ? (payload.groupMemberships as unknown[]).map((value) => String(value))
    : (current?.groupMemberships ?? []);

  const assumeRoleTargets = Array.isArray(payload.assumeRoleTargets)
    ? (payload.assumeRoleTargets as unknown[]).map((value) => String(value))
    : (current?.assumeRoleTargets ?? []);

  return {
    principalId: record.id,
    name: typeof payload.name === 'string' ? payload.name : (current?.name ?? record.id),
    arn: typeof payload.arn === 'string' ? payload.arn : (current?.arn ?? ''),
    type: typeof payload.type === 'string' ? payload.type : (current?.type ?? 'Role'),
    attachedPolicies,
    groupMemberships,
    assumeRoleTargets,
    deleted: record.deleted,
    mutatedAt: record.mutatedAt.toISOString(),
  };
}

function resourceFromSnapshot(
  record: SnapshotRecord,
  current: ResourceDoc | undefined,
): TimelineStateResource {
  const payload = record.payload ?? {};
  const tags =
    typeof payload.tags === 'object' && payload.tags !== null
      ? (payload.tags as Record<string, string>)
      : (current?.tags ?? {});

  return {
    resourceId: record.id,
    arn: typeof payload.arn === 'string' ? payload.arn : (current?.arn ?? ''),
    type: typeof payload.type === 'string' ? payload.type : (current?.type ?? ''),
    tags,
    deleted: record.deleted,
    mutatedAt: record.mutatedAt.toISOString(),
  };
}

export async function reconstructState(orgId: ObjectId, at: Date): Promise<TimelineState> {
  const startedAt = Date.now();
  const rounded = roundToMinute(at);
  const key = timelineCacheKey(orgId, rounded);
  const cached = cacheGet(key);
  if (cached !== undefined) return { ...cached, durationMs: Date.now() - startedAt };

  const [policies, versions, principalEvents, resourceEvents, currentPrincipals, currentResources] =
    await Promise.all([
      data.policies().find({ orgId }).toArray(),
      latestVersionsAt(orgId, rounded),
      data
        .auditEvents()
        .find({ orgId, timestamp: { $lte: rounded }, action: { $regex: '^principal\\.' } })
        .sort({ timestamp: 1 })
        .limit(5_000)
        .toArray(),
      data
        .auditEvents()
        .find({ orgId, timestamp: { $lte: rounded }, action: { $regex: '^resource\\.' } })
        .sort({ timestamp: 1 })
        .limit(5_000)
        .toArray(),
      data.principals().find({ orgId }).toArray(),
      data.resources().find({ orgId }).toArray(),
    ]);

  const statePolicies: TimelineStatePolicy[] = [];
  for (const policy of policies) {
    const policyId = oidRequired(policy._id);
    const version = versions.get(policyId);
    const existedAt = version !== undefined || policy.createdAt.getTime() <= rounded.getTime();
    if (!existedAt) continue;

    statePolicies.push(
      policyFromVersion(policyId, policy.name, policy.arn, version, {
        version: policy.currentVersion,
        statements: policy.statements,
        mutatedAt: policy.updatedAt,
        deleted: policy.deleted,
      }),
    );
  }

  const principalSnapshots = latestAuditSnapshots(principalEvents, 'principal.');
  const resourceSnapshots = latestAuditSnapshots(resourceEvents, 'resource.');
  const currentPrincipalById = new Map(
    currentPrincipals.map((principal) => [oidRequired(principal._id), principal]),
  );
  const currentResourceById = new Map(
    currentResources.map((resource) => [oidRequired(resource._id), resource]),
  );

  const statePrincipals: TimelineStatePrincipal[] = [];
  for (const [id, record] of principalSnapshots) {
    if (record.payload === null && currentPrincipalById.get(id) === undefined) continue;
    statePrincipals.push(principalFromSnapshot(record, currentPrincipalById.get(id)));
  }
  for (const principal of currentPrincipals) {
    const id = oidRequired(principal._id);
    if (principalSnapshots.has(id)) continue;
    if (principal.createdAt.getTime() > rounded.getTime()) continue;
    statePrincipals.push({
      principalId: id,
      name: principal.name,
      arn: principal.arn,
      type: principal.type,
      attachedPolicies: principal.attachedPolicies.map(oidRequired),
      groupMemberships: principal.groupMemberships,
      assumeRoleTargets: principal.assumeRoleTargets,
      deleted: principal.deleted,
      mutatedAt: principal.updatedAt.toISOString(),
    });
  }

  const stateResources: TimelineStateResource[] = [];
  for (const [id, record] of resourceSnapshots) {
    if (record.payload === null && currentResourceById.get(id) === undefined) continue;
    stateResources.push(resourceFromSnapshot(record, currentResourceById.get(id)));
  }
  for (const resource of currentResources) {
    const id = oidRequired(resource._id);
    if (resourceSnapshots.has(id)) continue;
    if (resource.createdAt.getTime() > rounded.getTime()) continue;
    stateResources.push({
      resourceId: id,
      arn: resource.arn,
      type: resource.type,
      tags: resource.tags,
      deleted: resource.deleted,
      mutatedAt: resource.updatedAt.toISOString(),
    });
  }

  const state: TimelineState = {
    at: rounded.toISOString(),
    orgId: oidRequired(orgId),
    policies: statePolicies,
    principals: statePrincipals,
    resources: stateResources,
    counts: {
      policies: statePolicies.filter((policy) => !policy.deleted).length,
      principals: statePrincipals.filter((principal) => !principal.deleted).length,
      resources: stateResources.filter((resource) => !resource.deleted).length,
      deletedPolicies: statePolicies.filter((policy) => policy.deleted).length,
      deletedPrincipals: statePrincipals.filter((principal) => principal.deleted).length,
    },
    cacheKey: key,
    reconstructedFrom:
      versions.size > 0 || principalSnapshots.size > 0 ? 'versions+audit' : 'current',
    durationMs: Date.now() - startedAt,
  };

  cacheSet(key, state);
  return state;
}

/* ------------------------------------------------------------------ */
/* Events + diff preview                                               */
/* ------------------------------------------------------------------ */

export interface EventsRangeOptions {
  from?: string | undefined;
  to?: string | undefined;
}

export async function eventsInRange(
  orgId: ObjectId,
  options: EventsRangeOptions,
): Promise<TimelineEventsPayload> {
  const to = options.to === undefined ? new Date() : new Date(options.to);
  const from =
    options.from === undefined
      ? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1_000)
      : new Date(options.from);

  const docs = await data
    .auditEvents()
    .find({ orgId, timestamp: { $gte: from, $lte: to } })
    .sort({ timestamp: 1 })
    .limit(2_000)
    .toArray();

  const events = docs.map(toEventMarker);
  const buckets = bucketByDay(
    docs.map((doc) => ({ timestamp: doc.timestamp, category: auditCategory(doc.action) })),
  );

  return { from: from.toISOString(), to: to.toISOString(), events, buckets };
}

function changedPolicies(before: TimelineStatePolicy, after: TimelineStatePolicy): boolean {
  if (before.version !== after.version) return true;
  return JSON.stringify(before.statements) !== JSON.stringify(after.statements);
}

function changedPrincipals(before: TimelineStatePrincipal, after: TimelineStatePrincipal): boolean {
  return (
    JSON.stringify(before.attachedPolicies) !== JSON.stringify(after.attachedPolicies) ||
    JSON.stringify(before.groupMemberships) !== JSON.stringify(after.groupMemberships) ||
    JSON.stringify(before.assumeRoleTargets) !== JSON.stringify(after.assumeRoleTargets) ||
    before.deleted !== after.deleted
  );
}

/** State at `at` compared with state at `compareTo` (default: 24h earlier). */
export async function diffPreview(
  orgId: ObjectId,
  at: Date,
  compareTo?: Date,
): Promise<TimelineDiffPreview> {
  const compared = compareTo ?? new Date(at.getTime() - 24 * 60 * 60 * 1_000);
  const [after, before] = await Promise.all([
    reconstructState(orgId, at),
    reconstructState(orgId, compared),
  ]);

  const beforePolicies = new Map(before.policies.map((policy) => [policy.policyId, policy]));
  const afterPolicies = new Map(after.policies.map((policy) => [policy.policyId, policy]));
  const beforePrincipals = new Map(
    before.principals.map((principal) => [principal.principalId, principal]),
  );
  const afterPrincipals = new Map(
    after.principals.map((principal) => [principal.principalId, principal]),
  );
  const beforeResources = new Map(
    before.resources.map((resource) => [resource.resourceId, resource]),
  );
  const afterResources = new Map(
    after.resources.map((resource) => [resource.resourceId, resource]),
  );

  const topChanges: TimelineChangeSummary[] = [];
  let addedPolicies = 0;
  let removedPolicies = 0;
  let changedPolicyCount = 0;

  for (const [id, policy] of afterPolicies) {
    const previous = beforePolicies.get(id);
    if (previous === undefined) {
      addedPolicies += 1;
      topChanges.push({
        entityType: 'policy',
        entityId: id,
        name: policy.name,
        change: 'added',
        detail: `v${policy.version}`,
        version: policy.version,
      });
    } else if (changedPolicies(previous, policy)) {
      changedPolicyCount += 1;
      topChanges.push({
        entityType: 'policy',
        entityId: id,
        name: policy.name,
        change: 'changed',
        detail: `v${previous.version} -> v${policy.version}`,
        version: policy.version,
      });
    }
  }
  for (const [id, policy] of beforePolicies) {
    if (afterPolicies.has(id)) continue;
    removedPolicies += 1;
    topChanges.push({
      entityType: 'policy',
      entityId: id,
      name: policy.name,
      change: 'removed',
      detail: 'not present after',
      version: policy.version,
    });
  }

  let addedPrincipals = 0;
  let removedPrincipals = 0;
  let changedPrincipalCount = 0;
  for (const [id, principal] of afterPrincipals) {
    const previous = beforePrincipals.get(id);
    if (previous === undefined) {
      addedPrincipals += 1;
      topChanges.push({
        entityType: 'principal',
        entityId: id,
        name: principal.name,
        change: 'added',
        detail: principal.type,
      });
    } else if (changedPrincipals(previous, principal)) {
      changedPrincipalCount += 1;
      topChanges.push({
        entityType: 'principal',
        entityId: id,
        name: principal.name,
        change: 'changed',
        detail: 'permissions changed',
      });
    }
  }
  for (const [id, principal] of beforePrincipals) {
    if (afterPrincipals.has(id)) continue;
    removedPrincipals += 1;
    topChanges.push({
      entityType: 'principal',
      entityId: id,
      name: principal.name,
      change: 'removed',
      detail: principal.type,
    });
  }

  let addedResources = 0;
  let removedResources = 0;
  for (const [id, resource] of afterResources) {
    if (!beforeResources.has(id)) {
      addedResources += 1;
      topChanges.push({
        entityType: 'resource',
        entityId: id,
        name: resource.arn,
        change: 'added',
        detail: resource.type,
      });
    }
  }
  for (const [id, resource] of beforeResources) {
    if (afterResources.has(id)) continue;
    removedResources += 1;
    topChanges.push({
      entityType: 'resource',
      entityId: id,
      name: resource.arn,
      change: 'removed',
      detail: resource.type,
    });
  }

  return {
    at: after.at,
    comparedTo: before.at,
    addedPolicies,
    removedPolicies,
    changedPolicies: changedPolicyCount,
    addedPrincipals,
    removedPrincipals,
    changedPrincipals: changedPrincipalCount,
    addedResources,
    removedResources,
    changedResources: 0,
    topChanges: topChanges.slice(0, 25),
  };
}

/** Reconstructs an entity's audit trail for the timeline detail drawer. */
export async function entityHistory(
  orgId: ObjectId,
  targetId: string,
  limit = 50,
): Promise<TimelineEventMarker[]> {
  const docs = await data
    .auditEvents()
    .find({ orgId, 'target.id': targetId })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();
  return docs.map(toEventMarker);
}

/** Exposed so callers can build a stable identity string for an audit target. */
export function targetKey(orgId: ObjectId | string, targetId: string): string {
  return `${oidString(orgId) ?? ''}:${targetId}`;
}

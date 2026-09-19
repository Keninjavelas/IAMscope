/**
 * Audit + auth-event writers and readers (Plan §7.2 `audit_events`, §7.1 `auth_events`, §18).
 *
 * Every mutation in the API funnels through `writeAuditEvent`. Failed mutations still write an
 * event, with `metadata.error` set. Writers never throw into the request path.
 */
import { ObjectId, type Filter } from 'mongodb';
import type { AuditEvent, AuditTarget, Paginated, TimelineCategory } from '@iamscope/types';
import { data } from '../db/data';
import { identity } from '../db/identity';
import type { AuditEventDoc } from '../db/documents';
import { oidRequired } from '../lib/objectId';
import { paginated, resolvePagination } from '../lib/pagination';
import { toAuditEventDTO } from '../lib/serialize';
import { logger } from '../logger';

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

const CATEGORY_PREFIXES: readonly [string, TimelineCategory][] = [
  ['policy.', 'policy'],
  ['principal.', 'principal'],
  ['resource.', 'resource'],
  ['scenario.', 'scenario'],
  ['member.', 'membership'],
  ['invitation.', 'membership'],
  ['org.', 'org'],
  ['apikey.', 'apikey'],
];

/** Maps an audit `action` onto a timeline category (Plan §12.3). */
export function auditCategory(action: string): TimelineCategory {
  for (const [prefix, category] of CATEGORY_PREFIXES) {
    if (action.startsWith(prefix)) return category;
  }
  return 'org';
}

/* ------------------------------------------------------------------ */
/* Writers                                                             */
/* ------------------------------------------------------------------ */

export interface AuditInput {
  orgId: ObjectId;
  actorUserId?: ObjectId | null;
  actorEmail?: string | null;
  actorType?: 'user' | 'api_key' | 'system';
  action: string;
  target: AuditTarget;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

/** Writes an `audit_events` document. Returns the new id, or `null` when the write failed. */
export async function writeAuditEvent(input: AuditInput): Promise<ObjectId | null> {
  const doc: Omit<AuditEventDoc, '_id'> = {
    orgId: input.orgId,
    timestamp: new Date(),
    actorUserId: input.actorUserId ?? null,
    actorEmail: input.actorEmail ?? null,
    actorType: input.actorType ?? 'user',
    action: input.action,
    target: input.target,
    before: input.before ?? null,
    after: input.after ?? null,
    metadata: input.metadata ?? {},
  };

  try {
    const result = await data.auditEvents().insertOne(doc as AuditEventDoc);
    return result.insertedId;
  } catch (error) {
    logger.error({ err: error, action: input.action }, 'failed to write audit event');
    return null;
  }
}

export interface AuthEventInput {
  userId?: ObjectId | null;
  email?: string | null;
  orgId?: ObjectId | null;
  type: string;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

/** Writes an `auth_events` document. Never throws. */
export async function recordAuthEvent(input: AuthEventInput): Promise<void> {
  try {
    await identity.authEvents().insertOne({
      userId: input.userId ?? null,
      email: input.email ?? null,
      orgId: input.orgId ?? null,
      type: input.type,
      ip: (input.ip ?? '').slice(0, 128),
      userAgent: (input.userAgent ?? '').slice(0, 512),
      metadata: input.metadata ?? {},
      timestamp: new Date(),
    } as never);
  } catch (error) {
    logger.error({ err: error, type: input.type }, 'failed to write auth event');
  }
}

/* ------------------------------------------------------------------ */
/* Readers                                                             */
/* ------------------------------------------------------------------ */

export interface AuditListQuery {
  page?: number | undefined;
  pageSize?: number | undefined;
  q?: string | undefined;
  targetType?: string | undefined;
  targetId?: string | undefined;
  actorId?: string | undefined;
  action?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export function buildAuditFilter(orgId: ObjectId, query: AuditListQuery): Filter<AuditEventDoc> {
  const filter: Record<string, unknown> = { orgId };

  if (query.targetType !== undefined) filter['target.type'] = query.targetType;
  if (query.targetId !== undefined) filter['target.id'] = query.targetId;
  if (query.actorId !== undefined && /^[a-f\d]{24}$/i.test(query.actorId)) {
    filter.actorUserId = new ObjectId(query.actorId);
  }
  if (query.action !== undefined) filter.action = query.action;

  if (query.from !== undefined || query.to !== undefined) {
    const range: Record<string, Date> = {};
    if (query.from !== undefined) range.$gte = new Date(query.from);
    if (query.to !== undefined) range.$lte = new Date(query.to);
    filter.timestamp = range;
  }

  if (query.q !== undefined && query.q.trim() !== '') {
    const pattern = new RegExp(query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ 'target.name': pattern }, { action: pattern }, { actorEmail: pattern }];
  }

  return filter;
}

export async function listAuditEvents(
  orgId: ObjectId,
  query: AuditListQuery,
): Promise<Paginated<AuditEvent>> {
  const args = resolvePagination(query);
  const collection = data.auditEvents();
  const filter = buildAuditFilter(orgId, query);

  const [docs, total] = await Promise.all([
    collection.find(filter).sort({ timestamp: -1 }).skip(args.skip).limit(args.limit).toArray(),
    collection.countDocuments(filter),
  ]);

  return paginated(docs.map(toAuditEventDTO), total, args);
}

export async function findAuditEventsInRange(
  orgId: ObjectId,
  from: Date,
  to: Date,
  extra: Filter<AuditEventDoc> = {},
  limit = 1_000,
): Promise<AuditEventDoc[]> {
  return data
    .auditEvents()
    .find({ ...extra, orgId, timestamp: { $gte: from, $lte: to } })
    .sort({ timestamp: 1 })
    .limit(limit)
    .toArray();
}

export async function findLatestAuditEventsBefore(
  orgId: ObjectId,
  at: Date,
  actions: readonly string[],
): Promise<AuditEventDoc[]> {
  return data
    .auditEvents()
    .find({ orgId, timestamp: { $lte: at }, action: { $in: [...actions] } })
    .sort({ timestamp: -1 })
    .limit(2_000)
    .toArray();
}

export interface AuditBucketRow {
  day: string;
  action: string;
  count: number;
}

/** Day+action aggregation used by the timeline scrubber buckets (Plan §12.3). */
export async function aggregateAuditBuckets(
  orgId: ObjectId,
  from: Date,
  to: Date,
): Promise<AuditBucketRow[]> {
  const rows = await data
    .auditEvents()
    .aggregate<{ _id: { day: string; action: string }; count: number }>([
      { $match: { orgId, timestamp: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: {
            day: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp', timezone: 'UTC' } },
            action: '$action',
          },
          count: { $sum: 1 },
        },
      },
    ])
    .toArray();

  return rows.map((row) => ({ day: row._id.day, action: row._id.action, count: row.count }));
}

/** Helper so callers never have to hand-build a target. */
export function auditTarget(type: string, id: ObjectId | string, name: string): AuditTarget {
  return { type, id: typeof id === 'string' ? id : oidRequired(id), name };
}

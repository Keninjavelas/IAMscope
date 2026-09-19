/**
 * Presence (Plan §14). Heartbeats upsert a row keyed by `(orgId, userId, sessionId)`;
 * `lastSeenAt` carries a 60s TTL so stale rows disappear on their own.
 */
import { ObjectId } from 'mongodb';
import type { PresenceEntry, PresenceHeartbeatPayload } from '@iamscope/types';
import { data } from '../db/data';
import { identity } from '../db/identity';
import type { PresenceDoc } from '../db/documents';
import { oidRequired } from '../lib/objectId';
import { presenceColorFor } from '../lib/presenceColor';
import { toPresenceDTO } from '../lib/serialize';

export const PRESENCE_TTL_SECONDS = 60;
export const PRESENCE_STALE_MS = PRESENCE_TTL_SECONDS * 1_000;

export function isStale(
  doc: Pick<PresenceDoc, 'lastSeenAt'>,
  now: Date,
  maxAgeMs = PRESENCE_STALE_MS,
): boolean {
  return now.getTime() - doc.lastSeenAt.getTime() > maxAgeMs;
}

export interface HeartbeatArgs {
  orgId: ObjectId;
  userId: ObjectId;
  sessionId: ObjectId;
  payload: PresenceHeartbeatPayload;
  now?: Date;
}

/** Upsert keyed by `(orgId, userId, sessionId)`. */
export async function heartbeat(args: HeartbeatArgs): Promise<PresenceDoc> {
  const now = args.now ?? new Date();
  const location = {
    route: args.payload.location.route.slice(0, 512),
    entityType: args.payload.location.entityType ?? null,
    entityId: args.payload.location.entityId ?? null,
  };
  const cursor = args.payload.cursor === undefined ? null : args.payload.cursor;

  const doc = await data.presence().findOneAndUpdate(
    { orgId: args.orgId, userId: args.userId, sessionId: args.sessionId },
    {
      $set: { location, cursor, lastSeenAt: now },
      $setOnInsert: { orgId: args.orgId, userId: args.userId, sessionId: args.sessionId },
    },
    { upsert: true, returnDocument: 'after' },
  );

  if (doc !== null) return doc;

  // A concurrent upsert can leave `findOneAndUpdate` returning null; read it back.
  const created = await data
    .presence()
    .findOne({ orgId: args.orgId, userId: args.userId, sessionId: args.sessionId });
  if (created === null) throw new Error('presence upsert failed');
  return created;
}

export async function listActive(
  orgId: ObjectId,
  maxAgeMs = PRESENCE_STALE_MS,
  now: Date = new Date(),
): Promise<PresenceEntry[]> {
  const since = new Date(now.getTime() - maxAgeMs);
  const docs = await data
    .presence()
    .find({ orgId, lastSeenAt: { $gte: since } })
    .sort({ lastSeenAt: -1 })
    .limit(200)
    .toArray();

  if (docs.length === 0) return [];

  const userIds = [...new Set(docs.map((doc) => oidRequired(doc.userId)))].map(
    (id) => new ObjectId(id),
  );
  const users = await identity
    .users()
    .find({ _id: { $in: userIds } })
    .toArray();
  const byId = new Map(users.map((user) => [oidRequired(user._id), user]));

  const entries: PresenceEntry[] = [];
  for (const doc of docs) {
    const id = oidRequired(doc.userId);
    const user = byId.get(id);
    if (user === undefined) continue;
    entries.push(
      toPresenceDTO(
        doc,
        { id, name: user.name, email: user.email, avatarUrl: user.avatarUrl },
        presenceColorFor(id),
      ),
    );
  }

  return entries;
}

/** Hard-deletes rows past the TTL (the TTL monitor is lazy, the API is not). */
export async function deleteStale(orgId: ObjectId, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - PRESENCE_STALE_MS);
  const result = await data.presence().deleteMany({ orgId, lastSeenAt: { $lt: cutoff } });
  return result.deletedCount;
}

export async function removeForSession(sessionId: ObjectId): Promise<number> {
  const result = await data.presence().deleteMany({ sessionId });
  return result.deletedCount;
}

export async function findEntry(
  orgId: ObjectId,
  userId: ObjectId,
  sessionId: ObjectId,
): Promise<PresenceDoc | null> {
  return data.presence().findOne({ orgId, userId, sessionId });
}

/**
 * Session lifecycle (Plan §9.1). Opaque bearer token -> sha256 hex -> `sessions.tokenHash`.
 * Tokens are rotated on org switch, password change and role change; the old document is
 * revoked and the new one records `rotatedFrom`.
 */
import type { ObjectId } from 'mongodb';
import { SESSION_TTL_MS, env } from '../env';
import { identity } from '../db/identity';
import { AppError } from '../lib/errors';
import { toObjectId } from '../lib/objectId';
import { randomToken, sha256Hex } from './tokens';
import type { SessionDoc } from '../db/documents';

/** `lastSeenAt` is written at most once per minute to keep writes off the hot path. */
export const LAST_SEEN_TOUCH_MS = 60_000;

export type SessionState = 'active' | 'expired' | 'revoked' | 'idle';

export interface SessionLookup {
  session: SessionDoc;
  state: SessionState;
}

type SessionDecisionInput = Pick<SessionDoc, 'expiresAt' | 'revokedAt' | 'lastSeenAt'>;

/**
 * Pure decision function - unit tested without Mongo.
 * Order matters: revocation beats expiry, expiry beats idleness.
 */
export function decideSessionState(
  session: SessionDecisionInput,
  now: Date,
  idleMinutes: number = env.SESSION_IDLE_MINUTES,
): SessionState {
  if (session.revokedAt !== null) return 'revoked';
  if (session.expiresAt.getTime() <= now.getTime()) return 'expired';

  if (idleMinutes > 0) {
    const idleMs = idleMinutes * 60_000;
    if (now.getTime() - session.lastSeenAt.getTime() > idleMs) return 'idle';
  }

  return 'active';
}

export function shouldTouchLastSeen(session: Pick<SessionDoc, 'lastSeenAt'>, now: Date): boolean {
  return now.getTime() - session.lastSeenAt.getTime() >= LAST_SEEN_TOUCH_MS;
}

export function sessionExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + SESSION_TTL_MS);
}

export interface CreateSessionArgs {
  userId: ObjectId;
  activeOrgId: ObjectId | null;
  userAgent: string;
  ip: string;
  rotatedFrom?: ObjectId | null;
  now?: Date;
}

export interface IssuedSession {
  session: SessionDoc;
  token: string;
}

export async function createSession(args: CreateSessionArgs): Promise<IssuedSession> {
  const now = args.now ?? new Date();
  const token = randomToken(32);
  const doc: Omit<SessionDoc, '_id'> = {
    userId: args.userId,
    tokenHash: sha256Hex(token),
    activeOrgId: args.activeOrgId,
    userAgent: args.userAgent.slice(0, 512),
    ip: args.ip.slice(0, 128),
    createdAt: now,
    expiresAt: sessionExpiresAt(now),
    lastSeenAt: now,
    revokedAt: null,
    rotatedFrom: args.rotatedFrom ?? null,
  };

  const result = await identity.sessions().insertOne(doc as SessionDoc);
  return { session: { ...doc, _id: result.insertedId }, token };
}

/** Finds a session by raw token, without applying the active/expired decision. */
export async function findSessionByToken(token: string): Promise<SessionLookup | null> {
  const session = await identity.sessions().findOne({ tokenHash: sha256Hex(token) });
  if (session === null) return null;
  return { session, state: decideSessionState(session, new Date()) };
}

/**
 * Applies the liveness decision and refreshes `lastSeenAt` (at most once per minute).
 *
 * This is the *only* place the active check and the sliding-window touch live, so every
 * transport that resolves a session - the session cookie and the cross-origin event token -
 * agrees on both. If a second transport re-implemented this, it could honour `revokedAt`
 * while ignoring `SESSION_IDLE_MINUTES`, and the difference would be an auth bypass that
 * cookie mode masks.
 */
export async function activateSession(
  session: SessionDoc,
  now: Date,
  idleMinutes: number = env.SESSION_IDLE_MINUTES,
): Promise<SessionDoc | null> {
  if (decideSessionState(session, now, idleMinutes) !== 'active') return null;

  if (shouldTouchLastSeen(session, now)) {
    session.lastSeenAt = now;
    await identity
      .sessions()
      .updateOne({ _id: session._id }, { $set: { lastSeenAt: now } })
      .catch(() => undefined);
  }

  return session;
}

/**
 * Validates a raw token and returns the session only when it is currently usable.
 * Also refreshes `lastSeenAt` (at most once per minute).
 */
export async function validateSessionToken(
  token: string,
  now: Date = new Date(),
): Promise<SessionDoc | null> {
  const found = await findSessionByToken(token);
  if (found === null) return null;
  return activateSession(found.session, now);
}

/**
 * Identical validation to `validateSessionToken`, keyed by session id instead of raw token.
 *
 * The event-token transport is handed a session *id* and never sees the raw session token,
 * so it cannot use the tokenHash lookup. Routing both through `activateSession` is what makes
 * the two paths equivalent rather than merely similar.
 */
export async function validateSessionById(
  id: ObjectId,
  now: Date = new Date(),
): Promise<SessionDoc | null> {
  const session = await identity.sessions().findOne({ _id: id });
  if (session === null) return null;
  return activateSession(session, now);
}

export async function touchSession(sessionId: ObjectId, now: Date = new Date()): Promise<void> {
  await identity.sessions().updateOne({ _id: sessionId }, { $set: { lastSeenAt: now } });
}

export async function revokeSession(sessionId: ObjectId, now: Date = new Date()): Promise<boolean> {
  const result = await identity
    .sessions()
    .updateOne({ _id: sessionId, revokedAt: null }, { $set: { revokedAt: now } });
  return result.modifiedCount > 0;
}

/** Revokes every active session for a user; `exceptSessionId` keeps the caller signed in. */
export async function revokeAllForUser(
  userId: ObjectId,
  exceptSessionId?: ObjectId | null,
  now: Date = new Date(),
): Promise<number> {
  const filter: Record<string, unknown> = { userId, revokedAt: null };
  if (exceptSessionId !== null && exceptSessionId !== undefined) {
    filter._id = { $ne: exceptSessionId };
  }
  const result = await identity.sessions().updateMany(filter, { $set: { revokedAt: now } });
  return result.modifiedCount;
}

export async function listSessionsForUser(userId: ObjectId): Promise<SessionDoc[]> {
  return identity
    .sessions()
    .find({ userId, revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ lastSeenAt: -1 })
    .toArray();
}

export async function getSessionForUser(
  sessionId: string | ObjectId,
  userId: ObjectId,
): Promise<SessionDoc> {
  const session = await identity.sessions().findOne({ _id: toObjectId(sessionId), userId });
  if (session === null) throw new AppError('NOT_FOUND', 'Session not found');
  return session;
}

export interface RotateSessionArgs {
  activeOrgId?: ObjectId | null;
  userAgent?: string;
  ip?: string;
  now?: Date;
}

/**
 * Issues a replacement session and revokes the previous one (Plan §9.1 step 4).
 * `rotatedFrom` links the chain for auditing.
 */
export async function rotateSession(
  session: SessionDoc,
  args: RotateSessionArgs = {},
): Promise<IssuedSession> {
  const now = args.now ?? new Date();
  const issued = await createSession({
    userId: session.userId,
    activeOrgId: args.activeOrgId === undefined ? session.activeOrgId : args.activeOrgId,
    userAgent: args.userAgent ?? session.userAgent,
    ip: args.ip ?? session.ip,
    rotatedFrom: session._id,
    now,
  });

  await revokeSession(session._id, now);
  return issued;
}

/**
 * Route-facing audit helpers (Plan §18): "every mutation writes `audit_events`; errors during a
 * mutation still write `audit_events` with `metadata.error`".
 */
import type { ObjectId } from 'mongodb';
import type { AuditTarget } from '@iamscope/types';
import type { Request } from 'express';
import { logger } from '../logger';
import { writeAuditEvent } from '../services/audit';

export interface ActorDescriptor {
  actorUserId: ObjectId | null;
  actorEmail: string | null;
  actorType: 'user' | 'api_key' | 'system';
}

export function actorFromRequest(req: Request): ActorDescriptor {
  const auth = req.auth;
  if (auth === undefined) {
    return { actorUserId: null, actorEmail: null, actorType: 'system' };
  }
  if (auth.actorType === 'api_key') {
    return { actorUserId: null, actorEmail: auth.apiKey?.name ?? null, actorType: 'api_key' };
  }
  return {
    actorUserId: auth.user?._id ?? null,
    actorEmail: auth.user?.email ?? null,
    actorType: 'user',
  };
}

export interface MutationAuditEntry {
  action: string;
  target: AuditTarget;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

/**
 * Records a successful mutation. Returns the audit event id so it can be threaded into
 * `evaluation_runs.causedByAuditEventId`.
 */
export async function auditMutation(
  req: Request,
  entry: MutationAuditEntry,
): Promise<ObjectId | null> {
  const auth = req.auth;
  if (auth?.orgId == null) {
    logger.warn({ action: entry.action }, 'audit skipped - request has no auth context');
    return null;
  }

  const actor = actorFromRequest(req);
  return writeAuditEvent({
    orgId: auth.orgId,
    actorUserId: actor.actorUserId,
    actorEmail: actor.actorEmail,
    actorType: actor.actorType,
    action: entry.action,
    target: entry.target,
    before: entry.before ?? null,
    after: entry.after ?? null,
    metadata: { requestId: req.requestId, ...(entry.metadata ?? {}) },
  });
}

/** Records a failed mutation, preserving the error message in `metadata.error`. */
export async function auditFailure(
  req: Request,
  entry: MutationAuditEntry,
  error: unknown,
): Promise<void> {
  const auth = req.auth;
  if (auth?.orgId == null) return;

  const actor = actorFromRequest(req);
  const message = error instanceof Error ? error.message : String(error);

  await writeAuditEvent({
    orgId: auth.orgId,
    actorUserId: actor.actorUserId,
    actorEmail: actor.actorEmail,
    actorType: actor.actorType,
    action: entry.action,
    target: entry.target,
    before: entry.before ?? null,
    after: null,
    metadata: { requestId: req.requestId, error: message, ...(entry.metadata ?? {}) },
  });
}

/**
 * Platform-admin surface (cross-tenant).
 *
 * Every handler here sees data from organizations the caller is not a member of, so
 * the gate is the allowlist middleware, not a membership role. `requireAuth` +
 * `requirePlatformAdmin` are mounted in `index.ts` before this router is reached.
 *
 * Mutations revoke the target's sessions (a suspended account must lose its live
 * tokens immediately) and write an `audit_events` row into the ACTOR's active org -
 * audit is tenant-scoped, so writing into the target's org would leak an
 * administrative action into a tenant that did not perform it.
 */
import { Router } from 'express';
import { ObjectId, type Filter } from 'mongodb';
import { z } from 'zod';
import type { Role, UserStatus } from '@iamscope/types';
import { identity } from '../db/identity';
import type { MembershipDoc, OrgDoc, UserDoc } from '../db/documents';
import { badRequest, notFound } from '../lib/errors';
import { oidRequired } from '../lib/objectId';
import { buildSearchRegex } from '../lib/mongoQuery';
import { paginated, resolvePagination } from '../lib/pagination';
import { asyncHandler, sendData } from '../middleware/errorHandler';
import { auditMutation } from '../middleware/audit';
import { validateBody, validateParams, validateQuery } from '../middleware/validate';
import { idParamSchema } from '@iamscope/schemas';

/* ------------------------------------------------------------------ */
/* Schemas                                                            */
/* ------------------------------------------------------------------ */

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(['active', 'suspended', 'deleted', 'all']).default('active'),
  q: z.string().trim().max(200).optional(),
});

const statusBodySchema = z.object({
  status: z.enum(['active', 'suspended']),
});

/**
 * Never read a credential column into memory for this surface. A projection (rather
 * than stripping after the fact) means the hash cannot leak through a later change.
 */
const SAFE_PROJECTION = {
  passwordHash: 0,
  mfaSecret: 0,
  emailVerificationToken: 0,
  passwordResetTokenHash: 0,
  passwordResetExpiresAt: 0,
  oauthProviders: 0,
} as const;

/* ------------------------------------------------------------------ */
/* Serialisation                                                      */
/* ------------------------------------------------------------------ */

export interface AdminUserOrgDTO {
  orgId: string;
  orgName: string;
  role: Role;
}

export interface AdminUserDTO {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  orgs: AdminUserOrgDTO[];
}

function toAdminUserDTO(doc: UserDoc, orgs: AdminUserOrgDTO[]): AdminUserDTO {
  return {
    id: oidRequired(doc._id),
    email: doc.email,
    name: doc.name,
    status: doc.status,
    emailVerified: doc.emailVerified,
    createdAt: doc.createdAt.toISOString(),
    lastLoginAt: doc.lastLoginAt === null ? null : doc.lastLoginAt.toISOString(),
    orgs,
  };
}

/** Memberships for a page of users, joined to org names in two queries (not N+1). */
async function orgsForUsers(userIds: readonly ObjectId[]): Promise<Map<string, AdminUserOrgDTO[]>> {
  const result = new Map<string, AdminUserOrgDTO[]>();
  if (userIds.length === 0) return result;

  const memberships = await identity
    .memberships()
    .find({ userId: { $in: [...userIds] }, status: 'active' })
    .project<MembershipDoc>({ orgId: 1, userId: 1, role: 1 })
    .toArray();

  if (memberships.length === 0) return result;

  const orgIds = [...new Map(memberships.map((m) => [oidRequired(m.orgId), m.orgId])).values()];
  const orgs = await identity
    .orgs()
    .find({ _id: { $in: orgIds } })
    .project<OrgDoc>({ name: 1 })
    .toArray();
  const orgNames = new Map<string, string>(orgs.map((org) => [oidRequired(org._id), org.name]));

  for (const membership of memberships) {
    const userId = oidRequired(membership.userId);
    const orgId = oidRequired(membership.orgId);
    const list = result.get(userId) ?? [];
    list.push({
      orgId,
      orgName: orgNames.get(orgId) ?? '(deleted organization)',
      role: membership.role,
    });
    result.set(userId, list);
  }

  return result;
}

async function revokeSessions(userId: ObjectId, now: Date): Promise<void> {
  await identity.sessions().updateMany({ userId, revokedAt: null }, { $set: { revokedAt: now } });
}

/* ------------------------------------------------------------------ */
/* Routes                                                             */
/* ------------------------------------------------------------------ */

export const adminRouter = Router();

/* GET /admin/users ---------------------------------------------------- */

adminRouter.get(
  '/users',
  validateQuery(listQuerySchema),
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const args = resolvePagination(query);

    const filter: Filter<UserDoc> = {};
    if (query.status !== 'all') filter.status = query.status;
    if (query.q !== undefined && query.q !== '') {
      const pattern = buildSearchRegex(query.q);
      filter.$or = [{ email: pattern }, { name: pattern }];
    }

    const [total, docs] = await Promise.all([
      identity.users().countDocuments(filter),
      identity
        .users()
        .find(filter, { projection: SAFE_PROJECTION })
        .sort({ createdAt: -1 })
        .skip(args.skip)
        .limit(args.limit)
        .toArray(),
    ]);

    const orgsByUser = await orgsForUsers(docs.map((doc) => doc._id));
    const items = docs.map((doc) =>
      toAdminUserDTO(doc, orgsByUser.get(oidRequired(doc._id)) ?? []),
    );

    sendData(res, paginated(items, total, args));
  }),
);

/* PATCH /admin/users/:id/status --------------------------------------- */

adminRouter.patch(
  '/users/:id/status',
  validateParams(idParamSchema),
  validateBody(statusBodySchema),
  asyncHandler(async (req, res) => {
    const auth = req.auth;
    if (auth?.user == null) throw notFound();

    const { id } = idParamSchema.parse(req.params);
    const { status } = statusBodySchema.parse(req.body);
    const targetId = new ObjectId(id);

    if (auth.user._id.equals(targetId)) {
      throw badRequest('Cannot change own status');
    }

    const target = await identity
      .users()
      .findOne({ _id: targetId }, { projection: SAFE_PROJECTION });
    if (target === null) throw notFound('User not found');

    const now = new Date();
    const previous = target.status;

    await identity.users().updateOne({ _id: targetId }, { $set: { status, updatedAt: now } });

    // Suspension must take effect for tokens already in flight.
    await revokeSessions(targetId, now);

    await auditMutation(req, {
      action: 'user.status.change',
      target: { type: 'user', id, name: target.email },
      before: { status: previous },
      after: { status },
    });

    const orgsByUser = await orgsForUsers([targetId]);
    sendData(res, toAdminUserDTO({ ...target, status }, orgsByUser.get(id) ?? []));
  }),
);

/* DELETE /admin/users/:id --------------------------------------------- */

adminRouter.delete(
  '/users/:id',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const auth = req.auth;
    if (auth?.user == null) throw notFound();

    const { id } = idParamSchema.parse(req.params);
    const targetId = new ObjectId(id);

    if (auth.user._id.equals(targetId)) {
      throw badRequest('Cannot delete own account');
    }

    const target = await identity
      .users()
      .findOne({ _id: targetId }, { projection: SAFE_PROJECTION });
    if (target === null) throw notFound('User not found');

    const now = new Date();

    // Soft delete: the row stays for audit and referential integrity, but the account
    // can no longer authenticate and its memberships are suspended.
    await identity
      .users()
      .updateOne(
        { _id: targetId },
        { $set: { status: 'deleted', deletedAt: now, updatedAt: now } },
      );

    await revokeSessions(targetId, now);

    await auditMutation(req, {
      action: 'user.delete',
      target: { type: 'user', id, name: target.email },
      before: { status: target.status },
      after: { status: 'deleted' },
    });

    // 200 with a body rather than 204: the browser client treats an empty success
    // payload as EMPTY_RESPONSE, which would make a successful delete look broken.
    sendData(res, { deleted: true });
  }),
);

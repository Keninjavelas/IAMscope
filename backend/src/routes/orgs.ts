/**
 * Org CRUD + member management (Plan §8.2, §9.5).
 * `orgId` comes from the session/API key; the `:id` path param is only accepted after
 * `requireOrgAccess` proves membership.
 */
import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { createOrgSchema, updateMemberRoleSchema, updateOrgSchema } from '@iamscope/schemas';
import {
  attachAuth,
  currentOrgId,
  requireAuth,
  requireOrgAccess,
  requireRole,
} from '../auth/middleware';
import { rotateSession } from '../auth/sessions';
import { identity } from '../db/identity';
import type { MembershipDoc } from '../db/documents';
import { conflict, forbidden, notFound } from '../lib/errors';
import { oidRequired } from '../lib/objectId';
import { toMembershipDTO, toPublicUserSummary } from '../lib/serialize';
import { asyncHandler, sendData } from '../middleware/errorHandler';
import { auditMutation } from '../middleware/audit';
import { validateBody, validateQuery } from '../middleware/validate';
import { listMembersQuerySchema } from '@iamscope/schemas';
import { recordAuthEvent } from '../services/audit';
import {
  assertNotLastOwner,
  createOrg,
  ensureMembership,
  getOrgOrThrow,
  listOrgMembers,
  listOrgsForUser,
  toOrgDTOForUser,
} from '../services/org';

export const orgsRouter = Router();

orgsRouter.use(attachAuth());

/* ------------------------------------------------------------------ */
/* Collection routes                                                   */
/* ------------------------------------------------------------------ */

orgsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth;
    if (auth?.user == null) throw forbidden('Authentication required');

    const memberships = await listOrgsForUser(auth.user._id);
    const orgs = await Promise.all(
      memberships.map((entry) => toOrgDTOForUser(entry.org, entry.role)),
    );
    sendData(res, orgs);
  }),
);

orgsRouter.post(
  '/',
  requireAuth,
  validateBody(createOrgSchema),
  asyncHandler(async (req, res) => {
    const auth = req.auth;
    if (auth?.user == null) throw forbidden('Authentication required');

    const { name, slug } = req.body as { name: string; slug?: string };
    const org = await createOrg({
      name,
      ...(slug === undefined ? {} : { slug }),
      createdBy: auth.user._id,
    });
    await ensureMembership(org._id, auth.user._id, 'owner');

    await auditMutation(req, {
      action: 'org.create',
      target: { type: 'org', id: oidRequired(org._id), name: org.name },
      after: { name: org.name, slug: org.slug },
    });
    void recordAuthEvent({
      userId: auth.user._id,
      email: auth.user.email,
      orgId: org._id,
      type: 'org.created',
      metadata: { slug: org.slug },
    });

    sendData(res, await toOrgDTOForUser(org, 'owner'), 201);
  }),
);

/* ------------------------------------------------------------------ */
/* Single org                                                          */
/* ------------------------------------------------------------------ */

orgsRouter.get(
  '/:id',
  requireOrgAccess('id'),
  asyncHandler(async (req, res) => {
    const org = await getOrgOrThrow(req.params.id ?? '');
    sendData(res, await toOrgDTOForUser(org, req.auth?.role ?? null));
  }),
);

orgsRouter.put(
  '/:id',
  requireOrgAccess('id'),
  requireRole('admin'),
  validateBody(updateOrgSchema),
  asyncHandler(async (req, res) => {
    const orgId = currentOrgId(req);
    const body = req.body as { name?: string; settings?: Record<string, string> };
    const org = await getOrgOrThrow(orgId);

    const update: Record<string, unknown> = { updatedAt: new Date() };
    const after: Record<string, unknown> = {};
    if (body.name !== undefined) {
      update.name = body.name;
      after.name = body.name;
    }
    if (body.settings !== undefined) {
      update.settings = { ...org.settings, ...body.settings };
      after.settings = update.settings;
    }

    await identity.orgs().updateOne({ _id: orgId }, { $set: update });
    const updated = await getOrgOrThrow(orgId);

    await auditMutation(req, {
      action: 'org.update',
      target: { type: 'org', id: oidRequired(orgId), name: updated.name },
      before: { name: org.name, settings: org.settings },
      after,
    });

    sendData(res, await toOrgDTOForUser(updated, req.auth?.role ?? null));
  }),
);

orgsRouter.delete(
  '/:id',
  requireOrgAccess('id'),
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const orgId = currentOrgId(req);
    const org = await getOrgOrThrow(orgId);
    const now = new Date();

    await identity.orgs().updateOne({ _id: orgId }, { $set: { deletedAt: now, updatedAt: now } });
    await identity.memberships().updateMany({ orgId }, { $set: { status: 'removed' } });

    await auditMutation(req, {
      action: 'org.delete',
      target: { type: 'org', id: oidRequired(orgId), name: org.name },
      before: { name: org.name, slug: org.slug },
    });
    void recordAuthEvent({
      userId: req.auth?.user?._id ?? null,
      email: req.auth?.user?.email ?? null,
      orgId,
      type: 'org.deleted',
    });

    sendData(res, { success: true });
  }),
);

/* ------------------------------------------------------------------ */
/* Members                                                             */
/* ------------------------------------------------------------------ */

orgsRouter.get(
  '/:id/members',
  requireOrgAccess('id'),
  requireRole('admin'),
  validateQuery(listMembersQuerySchema),
  asyncHandler(async (req, res) => {
    const orgId = currentOrgId(req);
    const query = req.query as {
      page?: number;
      pageSize?: number;
      q?: string;
      role?: MembershipDoc['role'];
      status?: MembershipDoc['status'];
    };
    const page = await listOrgMembers(orgId, query);
    sendData(res, page);
  }),
);

orgsRouter.put(
  '/:id/members/:userId',
  requireOrgAccess('id'),
  requireRole('admin'),
  validateBody(updateMemberRoleSchema),
  asyncHandler(async (req, res) => {
    const orgId = currentOrgId(req);
    const targetUserId = new ObjectId(req.params.userId ?? '');
    const { role } = req.body as { role: MembershipDoc['role'] };

    const membership = await identity.memberships().findOne({ orgId, userId: targetUserId });
    if (membership === null) throw notFound('That user is not a member of this organization');

    if (membership.role === 'owner' && role !== 'owner')
      await assertNotLastOwner(orgId, targetUserId);
    if (role === 'owner' && req.auth?.role !== 'owner') {
      throw forbidden('Only an owner can promote another member to owner');
    }

    await identity.memberships().updateOne({ _id: membership._id }, { $set: { role } });

    const user = await identity.users().findOne({ _id: targetUserId });
    await auditMutation(req, {
      action: 'member.role.change',
      target: {
        type: 'membership',
        id: oidRequired(membership._id),
        name: user?.email ?? oidRequired(targetUserId),
      },
      before: { role: membership.role },
      after: { role },
    });
    void recordAuthEvent({
      userId: targetUserId,
      email: user?.email ?? null,
      orgId,
      type: 'org.switch',
      metadata: { roleChange: true, from: membership.role, to: role },
    });

    const updatedMembership = toMembershipDTO(
      { ...membership, role },
      user === null ? null : toPublicUserSummary(user),
    );

    // A role change is a privilege change: rotate the actor's session if they changed their own.
    if (
      req.auth?.user !== null &&
      oidRequired(req.auth?.user?._id ?? targetUserId) === oidRequired(targetUserId) &&
      req.auth?.session != null
    ) {
      const rotated = await rotateSession(req.auth.session);
      sendData(res, { ...updatedMembership, rotatedSession: oidRequired(rotated.session._id) });
      return;
    }

    sendData(res, updatedMembership);
  }),
);

orgsRouter.delete(
  '/:id/members/:userId',
  requireOrgAccess('id'),
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const orgId = currentOrgId(req);
    const targetUserId = new ObjectId(req.params.userId ?? '');

    const membership = await identity.memberships().findOne({ orgId, userId: targetUserId });
    if (membership === null) throw notFound('That user is not a member of this organization');
    if (membership.role === 'owner') {
      await assertNotLastOwner(orgId, targetUserId);
      throw conflict('Transfer ownership before removing an owner');
    }
    if (
      req.auth?.user !== null &&
      req.auth?.user !== undefined &&
      oidRequired(req.auth.user._id) === oidRequired(targetUserId)
    ) {
      throw conflict('You cannot remove yourself - leave the organization instead');
    }

    await identity
      .memberships()
      .updateOne({ _id: membership._id }, { $set: { status: 'removed' } });
    const user = await identity.users().findOne({ _id: targetUserId });

    await auditMutation(req, {
      action: 'member.remove',
      target: {
        type: 'membership',
        id: oidRequired(membership._id),
        name: user?.email ?? oidRequired(targetUserId),
      },
      before: { role: membership.role, status: membership.status },
      after: { status: 'removed' },
    });

    sendData(res, { success: true, member: user === null ? null : toPublicUserSummary(user) });
  }),
);

/**
 * Invitations (Plan §8.2). Two routers:
 * - `orgInvitationsRouter` mounted at `/orgs` (`/:id/invitations`, admin+)
 * - `publicInvitationsRouter` mounted at `/invitations` (`/:token` preview + `/:token/accept`)
 */
import { Router } from 'express';
import { ObjectId } from 'mongodb';
import {
  acceptInvitationSchema,
  createInvitationSchema,
  type CreateInvitationInput,
} from '@iamscope/schemas';
import { attachAuth, currentOrgId, requireOrgAccess, requireRole } from '../auth/middleware';
import { issueCsrfToken } from '../auth/csrf';
import { setSessionCookie } from '../auth/cookies';
import { createSession } from '../auth/sessions';
import { hashPassword } from '../auth/password';
import { DEFAULT_USER_PREFERENCES, type InvitationPreview } from '@iamscope/types';
import { identity } from '../db/identity';
import type { InvitationDoc, UserDoc } from '../db/documents';
import { conflict, forbidden, notFound } from '../lib/errors';
import { oidRequired } from '../lib/objectId';
import { toInvitationDTO } from '../lib/serialize';
import { randomToken, sha256Hex } from '../auth/tokens';
import { asyncHandler, sendData } from '../middleware/errorHandler';
import { auditMutation } from '../middleware/audit';
import { validateBody } from '../middleware/validate';
import { recordAuthEvent } from '../services/audit';
import { ensureMembership, getOrgOrThrow } from '../services/org';
import { clientIp } from '../middleware/rateLimit';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

/** Pre-session route: no auth, no CSRF (see `shouldSkipCsrf`). */
export const publicInvitationsRouter = Router();

export const orgInvitationsRouter = Router();
orgInvitationsRouter.use(attachAuth());

/* ------------------------------------------------------------------ */
/* POST /orgs/:id/invitations                                          */
/* ------------------------------------------------------------------ */

orgInvitationsRouter.post(
  '/:id/invitations',
  requireOrgAccess('id'),
  requireRole('admin'),
  validateBody(createInvitationSchema),
  asyncHandler(async (req, res) => {
    const orgId = currentOrgId(req);
    const payload = req.body as CreateInvitationInput & {
      email: string;
      role: Exclude<InvitationDoc['role'], never>;
    };
    const org = await getOrgOrThrow(orgId);

    const existingUser = await identity.users().findOne({ email: payload.email });
    if (existingUser !== null) {
      const existingMembership = await identity.memberships().findOne({
        orgId,
        userId: existingUser._id,
        status: 'active',
      });
      if (existingMembership !== null)
        throw conflict('That person is already a member of this organization');
    }

    const pending = await identity
      .invitations()
      .findOne({ orgId, email: payload.email, acceptedAt: null });
    if (pending !== null) throw conflict('An invitation for that email is already pending');

    const token = randomToken(32);
    const now = new Date();
    const doc: Omit<InvitationDoc, '_id'> = {
      orgId,
      email: payload.email,
      role: payload.role,
      tokenHash: sha256Hex(token),
      invitedBy: req.auth?.user?._id ?? existingUser?._id ?? org.createdBy,
      createdAt: now,
      expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
      acceptedAt: null,
    };

    const inserted = await identity.invitations().insertOne(doc as InvitationDoc);

    await auditMutation(req, {
      action: 'invitation.create',
      target: { type: 'invitation', id: oidRequired(inserted.insertedId), name: payload.email },
      after: { email: payload.email, role: payload.role },
    });
    void recordAuthEvent({
      userId: req.auth?.user?._id ?? null,
      email: payload.email,
      orgId,
      type: 'invite.sent',
      ip: clientIp(req),
      metadata: { role: payload.role },
    });

    sendData(
      res,
      toInvitationDTO({ ...doc, _id: inserted.insertedId }, { token, orgName: org.name }),
      201,
    );
  }),
);

/* ------------------------------------------------------------------ */
/* GET /orgs/:id/invitations                                           */
/* ------------------------------------------------------------------ */

orgInvitationsRouter.get(
  '/:id/invitations',
  requireOrgAccess('id'),
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const orgId = currentOrgId(req);
    const docs = await identity
      .invitations()
      .find({ orgId, acceptedAt: null, expiresAt: { $gt: new Date() } })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();

    const inviterIds = [...new Set(docs.map((doc) => oidRequired(doc.invitedBy)))];
    const inviters =
      inviterIds.length === 0
        ? []
        : await identity
            .users()
            .find({ _id: { $in: inviterIds.map((id) => new ObjectId(id)) } })
            .toArray();
    const nameById = new Map(inviters.map((user) => [oidRequired(user._id), user.name]));

    sendData(
      res,
      docs.map((doc) => {
        const invitedByName = nameById.get(oidRequired(doc.invitedBy));
        return toInvitationDTO(doc, invitedByName === undefined ? {} : { invitedByName });
      }),
    );
  }),
);

/* ------------------------------------------------------------------ */
/* DELETE /orgs/:id/invitations/:invitationId                          */
/* ------------------------------------------------------------------ */

orgInvitationsRouter.delete(
  '/:id/invitations/:invitationId',
  requireOrgAccess('id'),
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const orgId = currentOrgId(req);
    const invitationId = req.params.invitationId ?? '';
    if (!/^[a-f\d]{24}$/i.test(invitationId)) throw notFound('Invitation not found');
    const invitation = await identity
      .invitations()
      .findOne({ _id: new ObjectId(invitationId), orgId });
    if (invitation === null) throw notFound('Invitation not found');

    await identity.invitations().deleteOne({ _id: invitation._id });
    await auditMutation(req, {
      action: 'invitation.revoke',
      target: { type: 'invitation', id: oidRequired(invitation._id), name: invitation.email },
      before: { email: invitation.email, role: invitation.role },
    });
    void recordAuthEvent({
      userId: req.auth?.user?._id ?? null,
      email: invitation.email,
      orgId,
      type: 'invite.revoked',
    });

    sendData(res, { success: true });
  }),
);

/* ------------------------------------------------------------------ */
/* Public preview + accept                                             */
/* ------------------------------------------------------------------ */

async function findInvitationByToken(token: string): Promise<InvitationDoc> {
  const invitation = await identity.invitations().findOne({ tokenHash: sha256Hex(token) });
  if (invitation === null) throw notFound('That invitation link is invalid');
  if (invitation.acceptedAt !== null) throw conflict('That invitation has already been accepted');
  if (invitation.expiresAt.getTime() <= Date.now()) throw conflict('That invitation has expired');
  return invitation;
}

publicInvitationsRouter.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const invitation = await findInvitationByToken(req.params.token ?? '');
    const [org, inviter] = await Promise.all([
      identity.orgs().findOne({ _id: invitation.orgId }),
      identity.users().findOne({ _id: invitation.invitedBy }),
    ]);
    if (org === null) throw notFound('Organization not found');

    const existingUser = await identity.users().findOne({ email: invitation.email });
    const existingMembership =
      existingUser === null
        ? null
        : await identity
            .memberships()
            .findOne({ orgId: invitation.orgId, userId: existingUser._id, status: 'active' });

    const preview: InvitationPreview = {
      email: invitation.email,
      role: invitation.role,
      orgName: org.name,
      orgSlug: org.slug,
      inviterName: inviter?.name ?? 'A teammate',
      expiresAt: invitation.expiresAt.toISOString(),
      alreadyMember: existingMembership !== null,
    };

    sendData(res, preview);
  }),
);

publicInvitationsRouter.post(
  '/:token/accept',
  validateBody(acceptInvitationSchema),
  asyncHandler(async (req, res) => {
    const invitation = await findInvitationByToken(req.params.token ?? '');
    const { name, password } = req.body as { name: string; password: string };
    const now = new Date();

    let user = await identity.users().findOne({ email: invitation.email });

    if (user === null) {
      const doc: Omit<UserDoc, '_id'> = {
        email: invitation.email,
        name,
        avatarUrl: null,
        passwordHash: await hashPassword(password),
        passwordUpdatedAt: now,
        emailVerified: true,
        emailVerificationToken: null,
        mfaEnabled: false,
        mfaSecret: null,
        status: 'active',
        preferences: { ...DEFAULT_USER_PREFERENCES },
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
      };
      const inserted = await identity.users().insertOne(doc as UserDoc);
      user = { ...doc, _id: inserted.insertedId };
    } else {
      const membership = await identity.memberships().findOne({
        orgId: invitation.orgId,
        userId: user._id,
        status: 'active',
      });
      if (membership !== null) throw conflict('You are already a member of this organization');
      await identity.users().updateOne({ _id: user._id }, { $set: { name, updatedAt: now } });
    }

    await ensureMembership(invitation.orgId, user._id, invitation.role, invitation.invitedBy);
    await identity.invitations().updateOne({ _id: invitation._id }, { $set: { acceptedAt: now } });

    const { token } = await createSession({
      userId: user._id,
      activeOrgId: invitation.orgId,
      userAgent: req.headers['user-agent'] ?? '',
      ip: clientIp(req),
    });
    setSessionCookie(res, token);
    issueCsrfToken(res);

    void recordAuthEvent({
      userId: user._id,
      email: user.email,
      orgId: invitation.orgId,
      type: 'invite.accepted',
      ip: clientIp(req),
      metadata: { role: invitation.role },
    });

    const org = await getOrgOrThrow(invitation.orgId);
    sendData(res, {
      // `orgId` is the field the client deactivates the invite screen on; the rest is
      // context for the toast.
      orgId: oidRequired(org._id),
      user: {
        id: oidRequired(user._id),
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
      org: { id: oidRequired(org._id), name: org.name, slug: org.slug },
      role: invitation.role,
    });
  }),
);

export function invitationGuard(): never {
  throw forbidden('Invitations are managed by an organization administrator');
}

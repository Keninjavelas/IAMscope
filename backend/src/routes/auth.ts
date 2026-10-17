/**
 * Auth routes (Plan §8.1, §9).
 * `POST /auth/*` write a single session/CSRF cookie pair; nothing here reads `orgId` from input.
 */
import { Router } from 'express';
import { env } from '../env';
import { ObjectId } from 'mongodb';
import {
  DEFAULT_USER_PREFERENCES,
  type AuthMeResponse,
  type LoginResult,
  type User,
  type UserPreferences,
} from '@iamscope/types';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  sessionIdParamSchema,
  signupSchema,
  switchOrgSchema,
  updatePreferencesSchema,
  updateProfileSchema,
  verifyEmailSchema,
} from '@iamscope/schemas';
import { clearCsrfToken, issueCsrfToken } from '../auth/csrf';
import { clearSessionCookie, setSessionCookie } from '../auth/cookies';
import { permissionsForRole } from '../auth/context';
import { requireAuth } from '../auth/middleware';
import { hashPassword, verifyPassword } from '../auth/password';
import {
  createSession,
  getSessionForUser,
  listSessionsForUser,
  revokeAllForUser,
  revokeSession,
  rotateSession,
} from '../auth/sessions';
import { randomToken, sha256Hex } from '../auth/tokens';
import { identity } from '../db/identity';
import type { UserDoc } from '../db/documents';
import { conflict, forbidden, notFound, unauthenticated } from '../lib/errors';
import { oidRequired } from '../lib/objectId';
import { toSessionDTO, toUserDTO } from '../lib/serialize';
import { asyncHandler, sendData } from '../middleware/errorHandler';
import { RATE_LIMIT_RULES, clientIp, enforceRateLimit } from '../middleware/rateLimit';
import { validateBody, validateParams } from '../middleware/validate';
import { recordAuthEvent } from '../services/audit';
import { createOrg, ensureMembership, listOrgsForUser, toOrgDTOForUser } from '../services/org';
import { removeForSession } from '../services/presence';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1_000;

export const authRouter = Router();

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** Issues the session cookie + CSRF cookie for a brand-new session. */
function issueCookies(res: Parameters<typeof issueCsrfToken>[0], token: string): void {
  setSessionCookie(res, token);
  issueCsrfToken(res);
}

/* ------------------------------------------------------------------ */
/* GET /auth/csrf                                                      */
/* ------------------------------------------------------------------ */

/**
 * Bootstraps the double-submit token for a browser that has no session yet
 * (Plan §9.3). `ensureCsrfToken()` in the frontend calls this before its first
 * mutation, and the smoke harness asserts the cookie is issued. Safe to call
 * repeatedly: outside a session the token carries no authority on its own, it
 * only has to match the `X-CSRF-Token` header the client echoes back.
 */
authRouter.get(
  '/csrf',
  asyncHandler((_req, res) => {
    const token = issueCsrfToken(res);
    sendData(res, { csrfToken: token });
  }),
);

/* ------------------------------------------------------------------ */
/* POST /auth/signup                                                   */
/* ------------------------------------------------------------------ */

authRouter.post(
  '/signup',
  validateBody(signupSchema),
  asyncHandler(async (req, res) => {
    const { email, password, name, orgName } = req.body as {
      email: string;
      password: string;
      name: string;
      orgName: string;
    };

    const ip = clientIp(req);
    await enforceRateLimit(req, ip, RATE_LIMIT_RULES.signupPerIp, { email });

    const existing = await identity.users().findOne({ email });
    if (existing !== null) throw conflict('An account with that email already exists');

    const now = new Date();
    const passwordHash = await hashPassword(password);
    const verificationToken = randomToken(24);

    const userDoc: Omit<UserDoc, '_id'> = {
      email,
      name,
      avatarUrl: null,
      passwordHash,
      passwordUpdatedAt: now,
      emailVerified: false,
      emailVerificationToken: verificationToken,
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

    const inserted = await identity.users().insertOne(userDoc as UserDoc);
    const userId = inserted.insertedId;

    const org = await createOrg({ name: orgName, createdBy: userId, now });
    await ensureMembership(org._id, userId, 'owner');

    const { token } = await createSession({
      userId,
      activeOrgId: org._id,
      userAgent: req.headers['user-agent'] ?? '',
      ip,
    });

    issueCookies(res, token);

    void recordAuthEvent({
      userId,
      email,
      orgId: org._id,
      type: 'signup',
      ip,
      userAgent: req.headers['user-agent'] ?? '',
      metadata: { orgSlug: org.slug },
    });
    void recordAuthEvent({
      userId,
      email,
      orgId: org._id,
      type: 'org.created',
      ip,
      userAgent: req.headers['user-agent'] ?? '',
      metadata: { slug: org.slug },
    });

    const user = toUserDTO({ ...userDoc, _id: userId });
    const payload: LoginResult = {
      user,
      activeOrg: await toOrgDTOForUser(org, 'owner'),
      role: 'owner',
      // Outside production email delivery is not wired up, so the token is returned inline.
      ...(isProduction() ? {} : { verificationToken }),
    };

    sendData(res, payload, 201);
  }),
);

/* ------------------------------------------------------------------ */
/* POST /auth/login                                                    */
/* ------------------------------------------------------------------ */

authRouter.post(
  '/login',
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };
    const ip = clientIp(req);
    const userAgent = req.headers['user-agent'] ?? '';

    await enforceRateLimit(req, `email:${email}`, RATE_LIMIT_RULES.loginPerEmail, { email });
    await enforceRateLimit(req, `ip:${ip}`, RATE_LIMIT_RULES.loginPerIp, { email });

    const user = await identity.users().findOne({ email });
    if (user?.status !== 'active') {
      void recordAuthEvent({
        email,
        type: 'login.fail',
        ip,
        userAgent,
        metadata: { reason: 'unknown-or-inactive' },
      });
      throw unauthenticated('Invalid email or password');
    }

    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      void recordAuthEvent({
        userId: user._id,
        email,
        type: 'login.fail',
        ip,
        userAgent,
        metadata: { reason: 'bad-password' },
      });
      throw unauthenticated('Invalid email or password');
    }

    const membership = await identity.memberships().findOne({ userId: user._id, status: 'active' });
    const activeOrgId = membership?.orgId ?? null;

    const { token } = await createSession({ userId: user._id, activeOrgId, userAgent, ip });
    const now = new Date();
    await identity
      .users()
      .updateOne({ _id: user._id }, { $set: { lastLoginAt: now, updatedAt: now } });

    issueCookies(res, token);

    void recordAuthEvent({
      userId: user._id,
      email,
      orgId: activeOrgId,
      type: 'login.success',
      ip,
      userAgent,
    });

    const org =
      activeOrgId === null
        ? null
        : await identity.orgs().findOne({ _id: activeOrgId, deletedAt: null });

    const payload: LoginResult = {
      user: toUserDTO({ ...user, lastLoginAt: now }),
      activeOrg: org === null ? null : await toOrgDTOForUser(org, membership?.role ?? null),
      role: membership?.role ?? null,
    };

    sendData(res, payload);
  }),
);

/* ------------------------------------------------------------------ */
/* POST /auth/logout                                                   */
/* ------------------------------------------------------------------ */

authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth;
    if (auth !== undefined && auth.session !== null) {
      await revokeSession(auth.session._id);
      await removeForSession(auth.session._id).catch(() => 0);
      void recordAuthEvent({
        userId: auth.user?._id ?? null,
        email: auth.user?.email ?? null,
        orgId: auth.orgId,
        type: 'logout',
        ip: clientIp(req),
        userAgent: req.headers['user-agent'] ?? '',
      });
    }

    clearSessionCookie(res);
    clearCsrfToken(res);
    sendData(res, { success: true });
  }),
);

/* ------------------------------------------------------------------ */
/* Password reset + email verification                                 */
/* ------------------------------------------------------------------ */

authRouter.post(
  '/forgot-password',
  validateBody(forgotPasswordSchema),
  asyncHandler(async (req, res) => {
    const { email } = req.body as { email: string };
    await enforceRateLimit(req, `email:${email}`, RATE_LIMIT_RULES.passwordResetPerEmail, {
      email,
    });

    const user = await identity.users().findOne({ email });
    let resetToken: string | undefined;

    if (user !== null) {
      resetToken = randomToken(24);
      await identity.users().updateOne(
        { _id: user._id },
        {
          $set: {
            passwordResetTokenHash: sha256Hex(resetToken),
            passwordResetExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
            updatedAt: new Date(),
          },
        },
      );
      void recordAuthEvent({
        userId: user._id,
        email,
        type: 'password.reset.requested',
        ip: clientIp(req),
        userAgent: req.headers['user-agent'] ?? '',
      });
    }

    // Always 200 so the endpoint cannot be used to enumerate accounts.
    sendData(res, {
      success: true,
      message: 'If that email is registered, a reset link has been sent.',
      ...(isProduction() || resetToken === undefined ? {} : { resetToken }),
    });
  }),
);

authRouter.post(
  '/reset-password',
  validateBody(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    const { token, newPassword } = req.body as { token: string; newPassword: string };
    const tokenHash = sha256Hex(token);

    const user = await identity.users().findOne({
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: { $gt: new Date() },
    });
    if (user === null) throw notFound('That reset link is invalid or has expired');

    const now = new Date();
    await identity.users().updateOne(
      { _id: user._id },
      {
        $set: {
          passwordHash: await hashPassword(newPassword),
          passwordUpdatedAt: now,
          passwordResetTokenHash: null,
          passwordResetExpiresAt: null,
          updatedAt: now,
        },
      },
    );

    const revoked = await revokeAllForUser(user._id);
    void recordAuthEvent({
      userId: user._id,
      email: user.email,
      type: 'password.reset',
      ip: clientIp(req),
      userAgent: req.headers['user-agent'] ?? '',
      metadata: { sessionsRevoked: revoked },
    });

    sendData(res, { success: true });
  }),
);

authRouter.post(
  '/verify-email',
  validateBody(verifyEmailSchema),
  asyncHandler(async (req, res) => {
    const { token } = req.body as { token: string };
    const user = await identity.users().findOne({ emailVerificationToken: token });
    if (user === null) throw notFound('That verification link is invalid or has already been used');

    const now = new Date();
    await identity
      .users()
      .updateOne(
        { _id: user._id },
        { $set: { emailVerified: true, emailVerificationToken: null, updatedAt: now } },
      );
    void recordAuthEvent({
      userId: user._id,
      email: user.email,
      type: 'email.verified',
      ip: clientIp(req),
      userAgent: req.headers['user-agent'] ?? '',
    });

    sendData(res, { verified: true });
  }),
);

/* ------------------------------------------------------------------ */
/* GET /auth/me                                                        */
/* ------------------------------------------------------------------ */

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth;
    if (auth?.user == null) throw unauthenticated();

    const memberships = await listOrgsForUser(auth.user._id);
    const orgs = await Promise.all(
      memberships.map((entry) => toOrgDTOForUser(entry.org, entry.role)),
    );

    const activeOrgId = auth.orgId;
    const active =
      activeOrgId === null
        ? null
        : await identity.orgs().findOne({ _id: activeOrgId, deletedAt: null });

    const payload: AuthMeResponse = {
      user: {
        ...toUserDTO(auth.user),
        // Platform-level grant, not an org role: every signup is an owner of its own org.
        isPlatformAdmin: env.PLATFORM_ADMIN_EMAILS.includes(auth.user.email.toLowerCase()),
      },
      activeOrg: active === null ? null : await toOrgDTOForUser(active, auth.role),
      role: auth.role,
      orgs,
      permissions: permissionsForRole(auth.role),
    };

    sendData(res, payload);
  }),
);

/* ------------------------------------------------------------------ */
/* Preferences + profile                                               */
/* ------------------------------------------------------------------ */

authRouter.put(
  '/preferences',
  requireAuth,
  validateBody(updatePreferencesSchema),
  asyncHandler(async (req, res) => {
    const auth = req.auth;
    if (auth?.user == null) throw unauthenticated();

    const patch = req.body as Partial<UserPreferences>;
    const preferences: UserPreferences = { ...auth.user.preferences, ...patch };
    await identity
      .users()
      .updateOne({ _id: auth.user._id }, { $set: { preferences, updatedAt: new Date() } });

    const user: User = toUserDTO({ ...auth.user, preferences });
    sendData(res, { user });
  }),
);

authRouter.put(
  '/profile',
  requireAuth,
  validateBody(updateProfileSchema),
  asyncHandler(async (req, res) => {
    const auth = req.auth;
    if (auth?.user == null) throw unauthenticated();

    const patch = req.body as { name?: string; avatarUrl?: string | null };
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.avatarUrl !== undefined) update.avatarUrl = patch.avatarUrl;

    await identity.users().updateOne({ _id: auth.user._id }, { $set: update });
    const user: User = toUserDTO({ ...auth.user, ...patch, updatedAt: new Date() });
    sendData(res, { user });
  }),
);

/* ------------------------------------------------------------------ */
/* POST /auth/switch-org                                               */
/* ------------------------------------------------------------------ */

authRouter.post(
  '/switch-org',
  requireAuth,
  validateBody(switchOrgSchema),
  asyncHandler(async (req, res) => {
    const auth = req.auth;
    if (auth?.user == null) throw unauthenticated();
    if (auth.session === null)
      throw forbidden('API keys are already bound to a single organization');

    const { orgId } = req.body as { orgId: string };
    const targetOrgId = new ObjectId(orgId);

    const membership = await identity
      .memberships()
      .findOne({ orgId: targetOrgId, userId: auth.user._id, status: 'active' });
    if (membership === null) throw forbidden('You are not a member of that organization');

    const org = await identity.orgs().findOne({ _id: targetOrgId, deletedAt: null });
    if (org === null) throw notFound('Organization not found');

    // Privilege context changes => rotate the session (Plan §9.1 step 4).
    const rotated = await rotateSession(auth.session, {
      activeOrgId: targetOrgId,
      userAgent: req.headers['user-agent'] ?? '',
      ip: clientIp(req),
    });
    issueCookies(res, rotated.token);

    void recordAuthEvent({
      userId: auth.user._id,
      email: auth.user.email,
      orgId: targetOrgId,
      type: 'org.switch',
      ip: clientIp(req),
      userAgent: req.headers['user-agent'] ?? '',
      metadata: { from: auth.orgId === null ? null : auth.orgId.toHexString() },
    });

    sendData(res, {
      activeOrg: await toOrgDTOForUser(org, membership.role),
      role: membership.role,
      session: toSessionDTO(rotated.session, rotated.session._id),
    });
  }),
);

/* ------------------------------------------------------------------ */
/* POST /auth/change-password                                          */
/* ------------------------------------------------------------------ */

authRouter.post(
  '/change-password',
  requireAuth,
  validateBody(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const auth = req.auth;
    if (auth?.user == null || auth.session == null) throw unauthenticated();

    const { currentPassword, newPassword } = req.body as {
      currentPassword: string;
      newPassword: string;
    };
    const ok = await verifyPassword(auth.user.passwordHash, currentPassword);
    if (!ok) throw forbidden('Current password is incorrect');

    const now = new Date();
    await identity.users().updateOne(
      { _id: auth.user._id },
      {
        $set: {
          passwordHash: await hashPassword(newPassword),
          passwordUpdatedAt: now,
          updatedAt: now,
        },
      },
    );

    await revokeAllForUser(auth.user._id, auth.session._id, now);
    const rotated = await rotateSession(auth.session, {
      userAgent: req.headers['user-agent'] ?? '',
      ip: clientIp(req),
    });
    issueCookies(res, rotated.token);

    void recordAuthEvent({
      userId: auth.user._id,
      email: auth.user.email,
      orgId: auth.orgId,
      type: 'password.change',
      ip: clientIp(req),
      userAgent: req.headers['user-agent'] ?? '',
    });

    sendData(res, { success: true });
  }),
);

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

authRouter.get(
  '/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth;
    if (auth?.user == null) throw unauthenticated();

    const sessions = await listSessionsForUser(auth.user._id);
    const currentId = auth.session?._id ?? null;
    sendData(
      res,
      sessions.map((session) => toSessionDTO(session, currentId)),
    );
  }),
);

authRouter.delete(
  '/sessions/:id',
  requireAuth,
  validateParams(sessionIdParamSchema),
  asyncHandler(async (req, res) => {
    const auth = req.auth;
    if (auth?.user == null) throw unauthenticated();

    const session = await getSessionForUser(req.params.id ?? '', auth.user._id);
    const revokingCurrent = oidRequired(session._id) === (auth.session?._id ?? null)?.toHexString();

    await revokeSession(session._id);
    await removeForSession(session._id).catch(() => 0);

    if (revokingCurrent) {
      clearSessionCookie(res);
      clearCsrfToken(res);
    }

    void recordAuthEvent({
      userId: auth.user._id,
      email: auth.user.email,
      orgId: auth.orgId,
      type: 'session.revoked',
      ip: clientIp(req),
      userAgent: req.headers['user-agent'] ?? '',
      metadata: { sessionId: oidRequired(session._id), self: revokingCurrent },
    });

    sendData(res, { success: true });
  }),
);

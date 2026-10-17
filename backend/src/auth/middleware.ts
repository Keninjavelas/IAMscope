/**
 * Auth + RBAC middleware (Plan Â§9.5, Â§9.6, Â§8.14).
 *
 * Chain per route: `attachAuth` -> `requireAuth` -> `requireOrg` -> `requireRole(min)` -> handler.
 * `orgId` is resolved from the session or the API key, never from the request body.
 */
import type { Request, RequestHandler } from 'express';
import { ObjectId } from 'mongodb';
import type { Role } from '@iamscope/types';
import { identity } from '../db/identity';
import type { SessionDoc } from '../db/documents';
import { forbidden, notFound, unauthenticated } from '../lib/errors';
import { isObjectIdString, oidRequired, toObjectId } from '../lib/objectId';
import { logger } from '../logger';
import { env } from '../env';
import { asyncHandler } from '../middleware/errorHandler';
import { recordAuthEvent } from '../services/audit';
import { readBearerToken, readSessionToken } from './cookies';
import {
  roleAtLeast,
  roleFromScopes,
  scopesSatisfy,
  type AuthContext,
  type ScopeRequirement,
} from './context';
import { verifyEventToken } from './eventTokens';
import { validateSessionById, validateSessionToken } from './sessions';
import { hashApiKey } from './tokens';

const API_KEY_TOUCH_INTERVAL_MS = 5 * 60_000;

async function resolveApiKeyAuth(req: Request, secret: string): Promise<AuthContext | null> {
  const keyHash = hashApiKey(secret);
  const doc = await identity.apiKeys().findOne({ keyHash });
  if (doc === null) return null;
  if (doc.revokedAt !== null) return null;
  if (doc.expiresAt !== null && doc.expiresAt.getTime() <= Date.now()) return null;

  const now = new Date();
  await identity
    .apiKeys()
    .updateOne({ _id: doc._id }, { $set: { lastUsedAt: now } })
    .catch(() => undefined);

  // `auth_events` records api_key usage, but at most once per 5 minutes so a busy integration
  // does not flood the collection (Plan Â§8.14).
  const lastUsed = doc.lastUsedAt === null ? 0 : doc.lastUsedAt.getTime();
  if (now.getTime() - lastUsed > API_KEY_TOUCH_INTERVAL_MS) {
    void recordAuthEvent({
      orgId: doc.orgId,
      type: 'login.success',
      ip: req.ip ?? '',
      userAgent: req.headers['user-agent'] ?? '',
      metadata: { actorType: 'api_key', apiKeyId: oidRequired(doc._id), apiKeyName: doc.name },
    });
  }

  return {
    actorType: 'api_key',
    orgId: doc.orgId,
    session: null,
    user: null,
    membership: null,
    role: roleFromScopes(doc.scopes),
    apiKey: doc,
    scopes: doc.scopes,
    ip: req.ip ?? '',
    userAgent: req.headers['user-agent'] ?? '',
  };
}

/** Stage 1a: the session behind the request's session cookie, if it is currently usable. */
async function sessionFromCookie(req: Request): Promise<SessionDoc | null> {
  const token = readSessionToken(req);
  if (token === undefined) return null;
  return validateSessionToken(token);
}

/**
 * Stage 1b: the session named by an event token (Fallback B - see `eventTokens.ts`).
 *
 * The token carries a session *id*, not a session token, so the lookup is by `_id`. The
 * liveness decision and the `lastSeenAt` refresh go through `validateSessionById`, which
 * shares `activateSession` with the cookie path - so a revoked, expired or idled-out session
 * is rejected here exactly as it would be on the cookie path. A valid token is not a session
 * bypass; it is a transport for the same validation.
 */
async function sessionFromEventToken(token: string): Promise<SessionDoc | null> {
  const payload = verifyEventToken(token);
  if (payload === null) return null;

  // `isObjectIdString` rather than `isObjectId`, and an explicit `toObjectId` after it.
  //
  // `isObjectId` is a *validator*, not a coercion: for a hex-string input it returns true
  // while the value is still a string, because its `value is ObjectId` predicate is unsound
  // for that branch. Passing the string straight on to `findOne({ _id })` matches nothing at
  // runtime - and TypeScript cannot see it, because the predicate claims `ObjectId`.
  // `toObjectId` on its own throws on malformed input, and this runs on an unauthenticated
  // query parameter, so guard first and convert second.
  const { sessionId } = payload;
  if (!isObjectIdString(sessionId)) return null;

  return validateSessionById(toObjectId(sessionId));
}

/** Stage 2: turn a usable session into the request-scoped `AuthContext`. */
async function buildAuthContext(session: SessionDoc, req: Request): Promise<AuthContext | null> {
  const user = await identity.users().findOne({ _id: session.userId });
  if (user?.status !== 'active') return null;

  const membership =
    session.activeOrgId === null
      ? null
      : await identity.memberships().findOne({
          orgId: session.activeOrgId,
          userId: session.userId,
          status: 'active',
        });

  return {
    actorType: 'user',
    orgId: session.activeOrgId,
    session,
    user,
    membership,
    role: membership === null ? null : membership.role,
    apiKey: null,
    scopes: [],
    ip: req.ip ?? '',
    userAgent: req.headers['user-agent'] ?? '',
  };
}

async function resolveSessionAuth(req: Request): Promise<AuthContext | null> {
  const session = await sessionFromCookie(req);
  return session === null ? null : buildAuthContext(session, req);
}

/**
 * Session cookie **or** event token, for the SSE stream only.
 *
 * Both transports converge on `buildAuthContext`, so `req.auth` has the same shape either
 * way and the handler never needs to know which one was used. The cookie path is unchanged.
 * Only the stream accepts a token, because it is the only endpoint that may be reached
 * directly instead of through the same-origin rewrite.
 */
async function resolveEventAuth(req: Request): Promise<AuthContext | null> {
  const tokenParam = typeof req.query.token === 'string' ? req.query.token : null;
  const session =
    tokenParam === null ? await sessionFromCookie(req) : await sessionFromEventToken(tokenParam);
  return session === null ? null : buildAuthContext(session, req);
}

/** Rejects the request unless a usable session cookie or event token resolves an identity. */
export function requireEventAuth(): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const auth = await resolveEventAuth(req);
    if (auth === null) throw unauthenticated();
    req.auth = auth;
    next();
  });
}

/**
 * Populates `req.auth` when the request carries a usable session cookie or API key.
 * Never rejects - anonymous requests simply continue with `req.auth === undefined`.
 */
export function attachAuth(): RequestHandler {
  return (req, _res, next) => {
    const bearer = readBearerToken(req);
    const work = bearer !== undefined ? resolveApiKeyAuth(req, bearer) : resolveSessionAuth(req);

    work
      .then((auth) => {
        if (auth !== null) req.auth = auth;
        next();
      })
      .catch((error: unknown) => {
        logger.error({ err: error, requestId: req.requestId }, 'auth resolution failed');
        next();
      });
  };
}

/** Alias documenting intent: `attachAuth` is inherently optional. */
export function optionalAuth(): RequestHandler {
  return attachAuth();
}

export function authContextOrThrow(req: Request): AuthContext {
  if (req.auth === undefined) throw unauthenticated();
  return req.auth;
}

/** The only supported way for a handler to learn its tenant (Plan Â§3.4). */
export function currentOrgId(req: Request): ObjectId {
  const auth = req.auth;
  if (auth === undefined) throw unauthenticated();
  if (auth.orgId === null)
    throw forbidden('No active organization - switch to an organization first');
  return auth.orgId;
}

/** Records an `authz.denied` auth event. Fire-and-forget - it must never block the 403. */
export function recordAuthzDenied(req: Request, reason: string, orgId: ObjectId | null): void {
  void recordAuthEvent({
    userId: req.auth?.user?._id ?? null,
    email: req.auth?.user?.email ?? null,
    orgId,
    type: 'authz.denied',
    ip: req.ip ?? '',
    userAgent: req.headers['user-agent'] ?? '',
    metadata: { reason, path: req.originalUrl, method: req.method, role: req.auth?.role ?? null },
  });
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (req.auth === undefined) {
    next(unauthenticated());
    return;
  }
  next();
};

/** Requires an authenticated actor *and* a resolved tenant. */
export const requireOrg: RequestHandler = (req, _res, next) => {
  const auth = req.auth;
  if (auth === undefined) {
    next(unauthenticated());
    return;
  }
  if (auth.orgId === null) {
    next(forbidden('No active organization - switch to an organization first'));
    return;
  }
  next();
};

/**
 * RBAC guard. Sessions are checked against the role hierarchy; API keys are checked against
 * their scopes via {@link roleFromScopes}.
 */
/**
 * Platform-admin gate for cross-tenant endpoints.
 *
 * Membership roles are per-org, so "owner" cannot express this: every signup mints
 * an owner. The allowlist is therefore an explicit platform-level grant.
 *
 * Fail-closed by construction: `[].includes(email)` is always false, so an unset or
 * empty `PLATFORM_ADMIN_EMAILS` forbids everyone rather than allowing everyone.
 */
export function requirePlatformAdmin(): RequestHandler {
  return (req, _res, next) => {
    if (req.auth?.user == null) {
      next(unauthenticated());
      return;
    }
    const email = req.auth.user.email.toLowerCase();
    if (!env.PLATFORM_ADMIN_EMAILS.includes(email)) {
      next(forbidden('Platform admin required'));
      return;
    }
    next();
  };
}

export function requireRole(minimum: Role): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const auth = authContextOrThrow(req);

    if (auth.actorType === 'api_key') {
      const effective = roleFromScopes(auth.scopes);
      auth.role = effective;
      if (!roleAtLeast(effective, minimum)) {
        recordAuthzDenied(req, `This API key cannot perform a ${minimum}-level action`, auth.orgId);
        throw forbidden(`This API key cannot perform a ${minimum}-level action`);
      }
      next();
      return;
    }

    if (auth.orgId === null)
      throw forbidden('No active organization - switch to an organization first');
    const orgId = auth.orgId;

    let membership = auth.membership;
    if (membership === null || oidRequired(membership.orgId) !== oidRequired(orgId)) {
      membership =
        auth.user === null
          ? null
          : await identity
              .memberships()
              .findOne({ orgId, userId: auth.user._id, status: 'active' });
    }

    if (membership?.status !== 'active') {
      recordAuthzDenied(req, 'You are not an active member of this organization', orgId);
      throw forbidden('You are not an active member of this organization');
    }

    auth.membership = membership;
    auth.role = membership.role;

    if (!roleAtLeast(membership.role, minimum)) {
      recordAuthzDenied(req, `This action requires the ${minimum} role`, orgId);
      throw forbidden(`This action requires the ${minimum} role`);
    }

    next();
  });
}

/** API-key scope guard. Session actors already passed `requireRole`. */
export function requireScope(requirement: ScopeRequirement): RequestHandler {
  return asyncHandler((req, _res, next) => {
    const auth = authContextOrThrow(req);
    if (auth.actorType !== 'api_key') {
      next();
      return;
    }
    if (!scopesSatisfy(auth.scopes, requirement)) {
      const reason = `This API key is missing the "${requirement}" scope`;
      recordAuthzDenied(req, reason, auth.orgId);
      throw forbidden(reason);
    }
    next();
  });
}

/** Reserved for endpoints that must be machine-authenticated. */
export function requireApiKey(): RequestHandler {
  return (req, _res, next) => {
    const auth = req.auth;
    if (auth === undefined) {
      next(unauthenticated());
      return;
    }
    if (auth.actorType !== 'api_key') {
      next(forbidden('This endpoint requires API key authentication'));
      return;
    }
    next();
  };
}

/**
 * Grants access to the org named by a path parameter (Plan Â§8.2 `/orgs/:id/...`).
 * For session actors membership must be active; for API keys the key's org must match exactly.
 */
export function requireOrgAccess(param = 'orgId'): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const auth = authContextOrThrow(req);
    const raw = req.params[param];
    if (raw === undefined || !/^[a-f\d]{24}$/i.test(raw)) throw notFound('Organization not found');
    const orgId = new ObjectId(raw);

    if (auth.actorType === 'api_key') {
      if (auth.apiKey === null || oidRequired(auth.apiKey.orgId) !== oidRequired(orgId)) {
        recordAuthzDenied(req, 'This API key is not scoped to that organization', orgId);
        throw forbidden('This API key is not scoped to that organization');
      }
      auth.orgId = orgId;
      next();
      return;
    }

    const userId = auth.user?._id ?? null;
    const membership =
      userId === null
        ? null
        : await identity.memberships().findOne({ orgId, userId, status: 'active' });

    if (membership?.status !== 'active') {
      recordAuthzDenied(req, 'You are not an active member of this organization', orgId);
      throw forbidden('You are not an active member of this organization');
    }

    auth.orgId = orgId;
    auth.membership = membership;
    auth.role = membership.role;
    next();
  });
}

/** Exported for tests that need to assert the request-scoped tenant. */
export function orgIdString(req: Request): string | null {
  const orgId = req.auth?.orgId;
  return orgId === null || orgId === undefined ? null : orgId.toHexString();
}

export type { AuthContext, ScopeRequirement };

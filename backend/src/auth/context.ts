/**
 * The authenticated request context attached to `req.auth` (see `src/types/express.d.ts`).
 *
 * `orgId` is *always* resolved from the session or the API key - never from the body, query or
 * params (Plan §3.4, §9.6). Org-scoped path params are only accepted after membership has been
 * verified, at which point the resolved value is copied here.
 */
import type { ObjectId } from 'mongodb';
import { ROLE_HIERARCHY, type ApiKeyScope, type Role } from '@iamscope/types';
import type { ApiKeyDoc, MembershipDoc, SessionDoc, UserDoc } from '../db/documents';

export interface AuthContext {
  actorType: 'user' | 'api_key';
  /**
   * Resolved tenant for the request. `null` only for a session that has not selected an org
   * yet (e.g. a brand-new user hitting `GET /auth/me`); `requireOrg` rejects those.
   */
  orgId: ObjectId | null;
  session: SessionDoc | null;
  user: UserDoc | null;
  membership: MembershipDoc | null;
  role: Role | null;
  apiKey: ApiKeyDoc | null;
  scopes: ApiKeyScope[];
  ip: string;
  userAgent: string;
}

export function roleAtLeast(role: Role | null, minimum: Role): boolean {
  if (role === null) return false;
  return ROLE_HIERARCHY.indexOf(role) >= ROLE_HIERARCHY.indexOf(minimum);
}

/** Maps an API key's scopes onto the session role hierarchy (Plan §8.14). */
export function roleFromScopes(scopes: readonly ApiKeyScope[]): Role {
  if (scopes.includes('admin')) return 'admin';
  if (scopes.includes('write')) return 'member';
  if (scopes.includes('evaluate')) return 'member';
  return 'viewer';
}

export type ScopeRequirement = 'read' | 'write' | 'evaluate' | 'admin';

/** `admin` implies everything; `write` implies `read`; `evaluate` implies `read`. */
export function scopesSatisfy(scopes: readonly ApiKeyScope[], required: ScopeRequirement): boolean {
  if (scopes.includes('admin')) return true;
  switch (required) {
    case 'read':
      return scopes.includes('read') || scopes.includes('write') || scopes.includes('evaluate');
    case 'write':
      return scopes.includes('write');
    case 'evaluate':
      return scopes.includes('evaluate') || scopes.includes('write');
    case 'admin':
      return false;
  }
}

/** Coarse permission flags surfaced by `GET /auth/me` (Plan §8.1). */
export function permissionsForRole(role: Role | null): {
  canRead: boolean;
  canWrite: boolean;
  canEvaluate: boolean;
  canAdmin: boolean;
  canDeleteOrg: boolean;
} {
  return {
    canRead: role !== null,
    canWrite: roleAtLeast(role, 'member'),
    canEvaluate: role !== null,
    canAdmin: roleAtLeast(role, 'admin'),
    canDeleteOrg: role === 'owner',
  };
}

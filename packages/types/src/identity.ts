/**
 * `iamscope_identity` wire types.
 *
 * These are the API-facing (JSON-serializable) shapes. Mongo documents store `_id: ObjectId`
 * and `Date`; the backend maps documents to these DTOs at the route boundary so the frontend
 * never has to deal with BSON.
 */
import type { PaginatedQuery } from './api';

/* ------------------------------------------------------------------ */
/* Enums / unions                                                      */
/* ------------------------------------------------------------------ */

export const ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

/** Higher index means more privilege. Used by `requireRole`. */
export const ROLE_HIERARCHY: readonly Role[] = ['viewer', 'member', 'admin', 'owner'];

export const DENSITY_MODES = ['compact', 'comfortable', 'spacious'] as const;
export type DensityMode = (typeof DENSITY_MODES)[number];

export const THEME_MODES = ['dark', 'light', 'system'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const RESOLVED_THEMES = ['dark', 'light'] as const;
export type ResolvedTheme = (typeof RESOLVED_THEMES)[number];

export const USER_STATUSES = ['active', 'suspended', 'deleted'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const MEMBERSHIP_STATUSES = ['active', 'invited', 'removed'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const API_KEY_SCOPES = ['read', 'write', 'evaluate', 'admin'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const ORG_PLANS = ['free'] as const;
export type OrgPlan = (typeof ORG_PLANS)[number];

/* ------------------------------------------------------------------ */
/* Auth events                                                         */
/* ------------------------------------------------------------------ */

export const AUTH_EVENT_TYPES = [
  'signup',
  'login.success',
  'login.fail',
  'logout',
  'logout.all',
  'password.reset.requested',
  'password.reset',
  'password.change',
  'email.verified',
  'invite.sent',
  'invite.accepted',
  'invite.revoked',
  'session.revoked',
  'session.rotated',
  'org.switch',
  'org.created',
  'org.deleted',
  'apikey.created',
  'apikey.revoked',
  'authz.denied',
  'rate.limited',
] as const;
export type AuthEventType = (typeof AUTH_EVENT_TYPES)[number];

/* ------------------------------------------------------------------ */
/* User                                                                */
/* ------------------------------------------------------------------ */

export interface UserPreferences {
  density: DensityMode;
  theme: ThemeMode;
  accent: string;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  density: 'compact',
  theme: 'dark',
  accent: 'blue',
};

export interface PublicUserSummary {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

/** Full user record as returned by `/auth/me` and the members list. */
export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  mfaEnabled: boolean;
  status: UserStatus;
  preferences: UserPreferences;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface Session {
  id: string;
  userId: string;
  activeOrgId: string | null;
  userAgent: string;
  ip: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  /** True for the session making the request. */
  current: boolean;
}

/* ------------------------------------------------------------------ */
/* Organization / membership / invitation                              */
/* ------------------------------------------------------------------ */

export interface OrgSettings {
  defaultDensity: DensityMode;
  defaultTheme: ThemeMode;
  accent: string;
}

export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  defaultDensity: 'compact',
  defaultTheme: 'dark',
  accent: 'blue',
};

export interface Org {
  id: string;
  name: string;
  slug: string;
  plan: OrgPlan;
  createdBy: string;
  settings: OrgSettings;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** Convenience field: the requesting user's role in this org. */
  role?: Role;
  memberCount?: number;
}

export interface Membership {
  id: string;
  orgId: string;
  userId: string;
  role: Role;
  invitedBy: string | null;
  joinedAt: string;
  status: MembershipStatus;
  /** Hydrated for list views. */
  user: PublicUserSummary | null;
}

export interface Invitation {
  id: string;
  orgId: string;
  email: string;
  role: Exclude<Role, 'owner'>;
  invitedBy: string;
  invitedByName?: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  /** Only present in the response to the create call. */
  token?: string;
  /** Only present on the public preview endpoint. */
  orgName?: string;
}

export interface InvitationPreview {
  email: string;
  role: Exclude<Role, 'owner'>;
  orgName: string;
  orgSlug: string;
  inviterName: string;
  expiresAt: string;
  alreadyMember: boolean;
}

/* ------------------------------------------------------------------ */
/* API keys                                                            */
/* ------------------------------------------------------------------ */

export interface ApiKey {
  id: string;
  orgId: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  /** Only present in the response to the create call. */
  secret?: string;
}

/* ------------------------------------------------------------------ */
/* Auth events                                                         */
/* ------------------------------------------------------------------ */

export interface AuthEvent {
  id: string;
  userId: string | null;
  email: string | null;
  orgId: string | null;
  type: AuthEventType | (string & {});
  ip: string;
  userAgent: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}

/* ------------------------------------------------------------------ */
/* Route payloads                                                      */
/* ------------------------------------------------------------------ */

export interface AuthMeUser extends User {
  /**
   * True when this email is listed in `PLATFORM_ADMIN_EMAILS`. Fail-closed: an
   * unset allowlist yields false for everyone, including the deployer.
   */
  isPlatformAdmin: boolean;
}

export interface AuthMeResponse {
  /** The session user, plus the platform-level admin grant (not an org role). */
  user: AuthMeUser;
  activeOrg: Org | null;
  role: Role | null;
  orgs: Org[];
  /** Coarse flags derived from `role` for the active org. */
  permissions: Permission;
}

/**
 * Coarse-grained flags derived from the role so the UI can disable controls
 * without duplicating the hierarchy in the frontend.
 */
export interface Permission {
  canRead: boolean;
  canWrite: boolean;
  canEvaluate: boolean;
  canAdmin: boolean;
  canDeleteOrg: boolean;
}

export interface SwitchOrgPayload {
  orgId: string;
}

export interface LoginResult {
  user: User;
  activeOrg: Org | null;
  role: Role | null;
  /** Only ever non-null outside production, where email delivery is not wired up. */
  verificationToken?: string;
  resetToken?: string;
}

export interface SignupPayload {
  email: string;
  password: string;
  name: string;
  orgName: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface ForgotPasswordPayload {
  email: string;
}

export interface ResetPasswordPayload {
  token: string;
  newPassword: string;
}

export interface VerifyEmailPayload {
  token: string;
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export interface AcceptInvitationPayload {
  name: string;
  password: string;
}

export interface CreateOrgPayload {
  name: string;
  slug?: string;
}

export interface UpdateOrgPayload {
  name?: string;
  settings?: Partial<OrgSettings>;
}

export interface CreateInvitationPayload {
  email: string;
  role: Exclude<Role, 'owner'>;
}

export interface UpdateMemberRolePayload {
  role: Role;
}

export interface CreateApiKeyPayload {
  name: string;
  scopes: ApiKeyScope[];
  expiresAt?: string | null;
}

export interface ListMembersQuery extends PaginatedQuery {
  q?: string;
  role?: Role;
  status?: MembershipStatus;
}

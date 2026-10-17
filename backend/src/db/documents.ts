/**
 * Mongo document shapes (Plan §7). These are the *storage* types - they carry real `ObjectId`
 * and `Date` values, unlike the wire DTOs in `@iamscope/types` which are BSON-free.
 * The mapping between the two lives in `src/lib/serialize.ts`.
 */
import type { ObjectId } from 'mongodb';
import type {
  ApiKeyScope,
  AuthEventType,
  EscalationHop,
  EvaluationOutcome,
  EvaluationRunResult,
  EvaluationSummary,
  EvaluationTrigger,
  MembershipStatus,
  OrgPlan,
  OrgSettings,
  PolicyEffect,
  PolicyStatement,
  PrincipalType,
  PresenceCursor,
  Role,
  UserPreferences,
  UserStatus,
} from '@iamscope/types';

/* ------------------------------------------------------------------ */
/* iamscope_identity                                                   */
/* ------------------------------------------------------------------ */

export interface UserDoc {
  _id: ObjectId;
  email: string;
  name: string;
  avatarUrl: string | null;
  passwordHash: string;
  passwordUpdatedAt: Date;
  emailVerified: boolean;
  emailVerificationToken: string | null;
  mfaEnabled: boolean;
  mfaSecret: string | null;
  status: UserStatus;
  /** Set only by the platform-admin soft delete; such accounts are never returned to login. */
  deletedAt?: Date | null;
  preferences: UserPreferences;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  /**
   * NOTE(spec): §7.1 does not give the password-reset flow a home. Rather than introduce a
   * third collection, the reset token is stored (hashed) on the user document.
   */
  passwordResetTokenHash: string | null;
  passwordResetExpiresAt: Date | null;
}

export interface SessionDoc {
  _id: ObjectId;
  userId: ObjectId;
  tokenHash: string;
  activeOrgId: ObjectId | null;
  userAgent: string;
  ip: string;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  rotatedFrom: ObjectId | null;
}

export interface OrgDoc {
  _id: ObjectId;
  name: string;
  slug: string;
  plan: OrgPlan;
  createdBy: ObjectId;
  settings: OrgSettings;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface MembershipDoc {
  _id: ObjectId;
  orgId: ObjectId;
  userId: ObjectId;
  role: Role;
  invitedBy: ObjectId | null;
  joinedAt: Date;
  status: MembershipStatus;
}

export interface InvitationDoc {
  _id: ObjectId;
  orgId: ObjectId;
  email: string;
  role: Exclude<Role, 'owner'>;
  tokenHash: string;
  invitedBy: ObjectId;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
}

export interface ApiKeyDoc {
  _id: ObjectId;
  orgId: ObjectId;
  name: string;
  keyHash: string;
  prefix: string;
  scopes: ApiKeyScope[];
  createdBy: ObjectId;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export interface AuthEventDoc {
  _id: ObjectId;
  userId: ObjectId | null;
  email: string | null;
  orgId: ObjectId | null;
  type: AuthEventType | (string & {});
  ip: string;
  userAgent: string;
  metadata: Record<string, unknown>;
  timestamp: Date;
}

/** Plan §9.4 - in-Mongo rate limiting with a TTL. */
export interface RateLimitDoc {
  _id: ObjectId;
  key: string;
  count: number;
  windowStart: Date;
  expiresAt: Date;
}

/* ------------------------------------------------------------------ */
/* iamscope_data                                                       */
/* ------------------------------------------------------------------ */

export interface PolicyDoc {
  _id: ObjectId;
  orgId: ObjectId;
  name: string;
  arn: string;
  currentVersion: number;
  statements: PolicyStatement[];
  tags: Record<string, string>;
  deleted: boolean;
  createdBy: ObjectId;
  updatedBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface PolicyVersionDoc {
  _id: ObjectId;
  orgId: ObjectId;
  policyId: ObjectId;
  version: number;
  statements: PolicyStatement[];
  changedBy: ObjectId;
  changeReason: string;
  createdAt: Date;
}

export interface PrincipalDoc {
  _id: ObjectId;
  orgId: ObjectId;
  type: PrincipalType;
  name: string;
  arn: string;
  attachedPolicies: ObjectId[];
  groupMemberships: string[];
  assumeRoleTargets: string[];
  boundaryPolicyId: ObjectId | null;
  tags: Record<string, string>;
  deleted: boolean;
  createdBy: ObjectId;
  updatedBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResourceDoc {
  _id: ObjectId;
  orgId: ObjectId;
  arn: string;
  type: string;
  tags: Record<string, string>;
  accountId: string | null;
  deleted: boolean;
  createdAt: Date;
  /** NOTE(spec): the `Resource` wire type requires `updatedAt`; §7.2 omits it. We store it. */
  updatedAt: Date;
}

export interface ScenarioDoc {
  _id: ObjectId;
  orgId: ObjectId;
  name: string;
  principalArn: string;
  action: string;
  resourceArn: string;
  expectedResult: PolicyEffect;
  tags: string[];
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
  /** Latest scenario result, denormalised for list views (`ScenarioWithResult`). */
  lastResult: PolicyEffect | null;
  lastRunAt: Date | null;
}

export interface EvaluationRunDoc {
  _id: ObjectId;
  orgId: ObjectId;
  label: string;
  snapshotAt: Date;
  triggeredBy: EvaluationTrigger | (string & {});
  triggeredByUserId: ObjectId | null;
  causedByAuditEventId: ObjectId | null;
  results: EvaluationRunResult[];
  summary: EvaluationSummary;
  createdAt: Date;
}

export interface EscalationPathDoc {
  _id: ObjectId;
  orgId: ObjectId;
  /**
   * NOTE(spec): `EscalationPath` (wire) requires `pattern` + both principal *names*, which §7.2
   * does not list. They are persisted so reads never need a join.
   */
  pattern: string;
  fromPrincipalArn: string;
  fromPrincipalName: string;
  toPrincipalArn: string;
  toPrincipalName: string;
  /** NOTE(spec): wire `EscalationHop` is a superset of §7.2's `{ via, target, policyId, sid }`. */
  hops: EscalationHop[];
  severity: 'low' | 'medium' | 'high';
  computedAt: Date;
  policySnapshotVersion: number;
}

export interface AuditTargetDoc {
  type: string;
  id: string;
  name: string;
}

export interface AuditEventDoc {
  _id: ObjectId;
  orgId: ObjectId;
  timestamp: Date;
  actorUserId: ObjectId | null;
  actorEmail: string | null;
  actorType: 'user' | 'api_key' | 'system';
  action: string;
  target: AuditTargetDoc;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
}

export interface PresenceLocationDoc {
  route: string;
  entityType: string | null;
  entityId: string | null;
}

export interface PresenceDoc {
  _id: ObjectId;
  orgId: ObjectId;
  userId: ObjectId;
  sessionId: ObjectId;
  location: PresenceLocationDoc;
  cursor: PresenceCursor | null;
  lastSeenAt: Date;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * The decision reasons are part of the frozen `EvaluationOutcome` type; this alias avoids
 * re-declaring the union by hand.
 */
export type EvaluationResultReason = EvaluationOutcome['reason'];

export function isDeleted(doc: { deleted?: boolean }): boolean {
  return doc.deleted === true;
}

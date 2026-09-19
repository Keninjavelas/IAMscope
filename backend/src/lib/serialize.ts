/**
 * Document -> wire DTO mappers. Every response body in the API goes through one of these so
 * `ObjectId`/`Date` never leak and no secret field (`passwordHash`, `tokenHash`, `mfaSecret`,
 * `keyHash`) can escape (Plan §7, §19).
 */
import type { ObjectId } from 'mongodb';
import type {
  ApiKey,
  AuditEvent,
  AuthEvent,
  EvaluationRun,
  EvaluationRunSummary,
  EscalationPath,
  Invitation,
  Membership,
  Org,
  Policy,
  PolicyVersion,
  PresenceEntry,
  PresenceCursor,
  Principal,
  PublicUserSummary,
  Resource,
  Role,
  Scenario,
  ScenarioWithResult,
  Session,
  User,
} from '@iamscope/types';
import type {
  ApiKeyDoc,
  AuditEventDoc,
  AuthEventDoc,
  EscalationPathDoc,
  EvaluationRunDoc,
  InvitationDoc,
  MembershipDoc,
  OrgDoc,
  PolicyDoc,
  PolicyVersionDoc,
  PresenceDoc,
  PrincipalDoc,
  ResourceDoc,
  ScenarioDoc,
  SessionDoc,
  UserDoc,
} from '../db/documents';
import { oidRequired, oidString } from './objectId';

/* ------------------------------------------------------------------ */
/* identity                                                            */
/* ------------------------------------------------------------------ */

export function toUserDTO(doc: UserDoc): User {
  return {
    id: oidRequired(doc._id),
    email: doc.email,
    name: doc.name,
    avatarUrl: doc.avatarUrl,
    emailVerified: doc.emailVerified,
    mfaEnabled: doc.mfaEnabled,
    status: doc.status,
    preferences: doc.preferences,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    lastLoginAt: doc.lastLoginAt === null ? null : doc.lastLoginAt.toISOString(),
  };
}

export function toPublicUserSummary(doc: UserDoc): PublicUserSummary {
  return {
    id: oidRequired(doc._id),
    email: doc.email,
    name: doc.name,
    avatarUrl: doc.avatarUrl,
  };
}

export function toSessionDTO(doc: SessionDoc, currentSessionId: ObjectId | string | null): Session {
  const id = oidRequired(doc._id);
  return {
    id,
    userId: oidRequired(doc.userId),
    activeOrgId: oidString(doc.activeOrgId),
    userAgent: doc.userAgent,
    ip: doc.ip,
    createdAt: doc.createdAt.toISOString(),
    expiresAt: doc.expiresAt.toISOString(),
    lastSeenAt: doc.lastSeenAt.toISOString(),
    revokedAt: doc.revokedAt === null ? null : doc.revokedAt.toISOString(),
    current: currentSessionId !== null && oidRequired(currentSessionId) === id,
  };
}

export interface OrgDTOExtras {
  role?: Role;
  memberCount?: number;
}

export function toOrgDTO(doc: OrgDoc, extras: OrgDTOExtras = {}): Org {
  const base: Org = {
    id: oidRequired(doc._id),
    name: doc.name,
    slug: doc.slug,
    plan: doc.plan,
    createdBy: oidRequired(doc.createdBy),
    settings: doc.settings,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    deletedAt: doc.deletedAt === null ? null : doc.deletedAt.toISOString(),
  };

  return {
    ...base,
    ...(extras.role === undefined ? {} : { role: extras.role }),
    ...(extras.memberCount === undefined ? {} : { memberCount: extras.memberCount }),
  };
}

export function toMembershipDTO(doc: MembershipDoc, user: PublicUserSummary | null): Membership {
  return {
    id: oidRequired(doc._id),
    orgId: oidRequired(doc.orgId),
    userId: oidRequired(doc.userId),
    role: doc.role,
    invitedBy: oidString(doc.invitedBy),
    joinedAt: doc.joinedAt.toISOString(),
    status: doc.status,
    user,
  };
}

export function toInvitationDTO(
  doc: InvitationDoc,
  extras: { token?: string; orgName?: string; invitedByName?: string } = {},
): Invitation {
  const base: Invitation = {
    id: oidRequired(doc._id),
    orgId: oidRequired(doc.orgId),
    email: doc.email,
    role: doc.role,
    invitedBy: oidRequired(doc.invitedBy),
    createdAt: doc.createdAt.toISOString(),
    expiresAt: doc.expiresAt.toISOString(),
    acceptedAt: doc.acceptedAt === null ? null : doc.acceptedAt.toISOString(),
  };

  return {
    ...base,
    ...(extras.invitedByName === undefined ? {} : { invitedByName: extras.invitedByName }),
    ...(extras.token === undefined ? {} : { token: extras.token }),
    ...(extras.orgName === undefined ? {} : { orgName: extras.orgName }),
  };
}

export function toApiKeyDTO(doc: ApiKeyDoc, secret?: string): ApiKey {
  const base: ApiKey = {
    id: oidRequired(doc._id),
    orgId: oidRequired(doc.orgId),
    name: doc.name,
    prefix: doc.prefix,
    scopes: doc.scopes,
    createdBy: oidRequired(doc.createdBy),
    createdAt: doc.createdAt.toISOString(),
    lastUsedAt: doc.lastUsedAt === null ? null : doc.lastUsedAt.toISOString(),
    expiresAt: doc.expiresAt === null ? null : doc.expiresAt.toISOString(),
    revokedAt: doc.revokedAt === null ? null : doc.revokedAt.toISOString(),
  };

  return secret === undefined ? base : { ...base, secret };
}

export function toAuthEventDTO(doc: AuthEventDoc): AuthEvent {
  return {
    id: oidRequired(doc._id),
    userId: oidString(doc.userId),
    email: doc.email,
    orgId: oidString(doc.orgId),
    type: doc.type,
    ip: doc.ip,
    userAgent: doc.userAgent,
    metadata: doc.metadata,
    timestamp: doc.timestamp.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* domain                                                              */
/* ------------------------------------------------------------------ */

export function toPolicyDTO(doc: PolicyDoc): Policy {
  return {
    id: oidRequired(doc._id),
    orgId: oidRequired(doc.orgId),
    name: doc.name,
    arn: doc.arn,
    currentVersion: doc.currentVersion,
    statements: doc.statements,
    tags: doc.tags,
    deleted: doc.deleted,
    createdBy: oidRequired(doc.createdBy),
    updatedBy: oidRequired(doc.updatedBy),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function toPolicyVersionDTO(doc: PolicyVersionDoc, changedByName?: string): PolicyVersion {
  const base: PolicyVersion = {
    id: oidRequired(doc._id),
    orgId: oidRequired(doc.orgId),
    policyId: oidRequired(doc.policyId),
    version: doc.version,
    statements: doc.statements,
    changedBy: oidRequired(doc.changedBy),
    changeReason: doc.changeReason,
    createdAt: doc.createdAt.toISOString(),
  };

  return changedByName === undefined ? base : { ...base, changedByName };
}

export function toPrincipalDTO(doc: PrincipalDoc): Principal {
  return {
    id: oidRequired(doc._id),
    orgId: oidRequired(doc.orgId),
    type: doc.type,
    name: doc.name,
    arn: doc.arn,
    attachedPolicies: doc.attachedPolicies.map((id) => oidRequired(id)),
    groupMemberships: doc.groupMemberships,
    assumeRoleTargets: doc.assumeRoleTargets,
    boundaryPolicyId: oidString(doc.boundaryPolicyId),
    tags: doc.tags,
    deleted: doc.deleted,
    createdBy: oidRequired(doc.createdBy),
    updatedBy: oidRequired(doc.updatedBy),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function toResourceDTO(doc: ResourceDoc): Resource {
  return {
    id: oidRequired(doc._id),
    orgId: oidRequired(doc.orgId),
    arn: doc.arn,
    type: doc.type,
    tags: doc.tags,
    accountId: doc.accountId,
    deleted: doc.deleted,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function toScenarioDTO(doc: ScenarioDoc): Scenario {
  return {
    id: oidRequired(doc._id),
    orgId: oidRequired(doc.orgId),
    name: doc.name,
    principalArn: doc.principalArn,
    action: doc.action,
    resourceArn: doc.resourceArn,
    expectedResult: doc.expectedResult,
    tags: doc.tags,
    createdBy: oidRequired(doc.createdBy),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function toScenarioWithResultDTO(doc: ScenarioDoc): ScenarioWithResult {
  return {
    ...toScenarioDTO(doc),
    lastResult: doc.lastResult,
    lastRunAt: doc.lastRunAt === null ? null : doc.lastRunAt.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* analysis                                                            */
/* ------------------------------------------------------------------ */

export function toEvaluationRunDTO(
  doc: EvaluationRunDoc,
  triggeredByName?: string | null,
): EvaluationRun {
  const base: EvaluationRun = {
    id: oidRequired(doc._id),
    orgId: oidRequired(doc.orgId),
    label: doc.label,
    snapshotAt: doc.snapshotAt.toISOString(),
    triggeredBy: doc.triggeredBy,
    triggeredByUserId: oidString(doc.triggeredByUserId),
    causedByAuditEventId: oidString(doc.causedByAuditEventId),
    results: doc.results,
    summary: doc.summary,
    createdAt: doc.createdAt.toISOString(),
  };

  return triggeredByName === undefined ? base : { ...base, triggeredByName };
}

export function toEvaluationRunSummaryDTO(
  doc: EvaluationRunDoc,
  triggeredByName: string | null,
): EvaluationRunSummary {
  return {
    id: oidRequired(doc._id),
    label: doc.label,
    snapshotAt: doc.snapshotAt.toISOString(),
    triggeredBy: String(doc.triggeredBy),
    triggeredByName,
    summary: doc.summary,
    createdAt: doc.createdAt.toISOString(),
  };
}

export function toEscalationPathDTO(doc: EscalationPathDoc): EscalationPath {
  return {
    id: oidRequired(doc._id),
    orgId: oidRequired(doc.orgId),
    pattern: doc.pattern,
    fromPrincipalArn: doc.fromPrincipalArn,
    fromPrincipalName: doc.fromPrincipalName,
    toPrincipalArn: doc.toPrincipalArn,
    toPrincipalName: doc.toPrincipalName,
    hops: doc.hops,
    severity: doc.severity,
    computedAt: doc.computedAt.toISOString(),
    policySnapshotVersion: doc.policySnapshotVersion,
  };
}

export function toAuditEventDTO(doc: AuditEventDoc): AuditEvent {
  return {
    id: oidRequired(doc._id),
    orgId: oidRequired(doc.orgId),
    timestamp: doc.timestamp.toISOString(),
    actorUserId: oidString(doc.actorUserId),
    actorEmail: doc.actorEmail,
    actorType: doc.actorType,
    action: doc.action,
    target: { type: doc.target.type, id: doc.target.id, name: doc.target.name },
    before: doc.before,
    after: doc.after,
    metadata: doc.metadata,
  };
}

export interface PresenceUserSummary {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export function toPresenceDTO(
  doc: PresenceDoc,
  user: PresenceUserSummary,
  color: string,
): PresenceEntry {
  const cursor: PresenceCursor | null =
    doc.cursor === null ? null : { x: doc.cursor.x, y: doc.cursor.y };
  return {
    id: oidRequired(doc._id),
    orgId: oidRequired(doc.orgId),
    userId: oidRequired(doc.userId),
    sessionId: oidRequired(doc.sessionId),
    user,
    location: {
      route: doc.location.route,
      entityType: doc.location.entityType,
      entityId: doc.location.entityId,
    },
    cursor,
    lastSeenAt: doc.lastSeenAt.toISOString(),
    color,
  };
}

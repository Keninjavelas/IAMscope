/**
 * Idempotent index creation (Plan §7.1, §7.2, §9.4, §20).
 *
 * Every compound index leads with `orgId` so a cross-tenant read can never be served by an
 * index (Plan §3.3). TTL indexes: sessions/invitations/rate_limits at 0s,
 * auth_events 180d, evaluation_runs 90d, presence 60s.
 */
import type { Collection, CreateIndexesOptions, IndexSpecification } from 'mongodb';
import { logger } from '../logger';
import { data } from './data';
import { identity } from './identity';

export interface IndexCreationReport {
  identity: number;
  data: number;
  failures: { collection: string; error: string }[];
}

interface IndexJob {
  /** Structural type so `Collection<SpecificDoc>` and `Collection<Document>` both work. */
  collection: Pick<Collection, 'createIndex'>;
  name: string;
  keys: IndexSpecification;
  options?: CreateIndexesOptions;
}

async function runJobs(
  jobs: IndexJob[],
): Promise<{ created: number; failures: IndexCreationReport['failures'] }> {
  let created = 0;
  const failures: IndexCreationReport['failures'] = [];

  for (const job of jobs) {
    try {
      await job.collection.createIndex(job.keys, job.options ?? {});
      created += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ collection: job.name, error: message });
      logger.warn({ collection: job.name, err: error }, 'index creation failed');
    }
  }

  return { created, failures };
}

function identityJobs(): IndexJob[] {
  return [
    /* users (Plan §7.1) */
    {
      name: 'users.email',
      collection: identity.users(),
      keys: { email: 1 },
      options: { unique: true },
    },
    { name: 'users.status', collection: identity.users(), keys: { status: 1 } },
    {
      name: 'users.emailVerificationToken',
      collection: identity.users(),
      keys: { emailVerificationToken: 1 },
      options: { sparse: true },
    },
    { name: 'users.createdAt', collection: identity.users(), keys: { createdAt: -1 } },

    /* sessions */
    {
      name: 'sessions.tokenHash',
      collection: identity.sessions(),
      keys: { tokenHash: 1 },
      options: { unique: true },
    },
    {
      name: 'sessions.userId.revokedAt',
      collection: identity.sessions(),
      keys: { userId: 1, revokedAt: 1 },
    },
    {
      name: 'sessions.expiresAt',
      collection: identity.sessions(),
      keys: { expiresAt: 1 },
      options: { expireAfterSeconds: 0 },
    },
    { name: 'sessions.activeOrgId', collection: identity.sessions(), keys: { activeOrgId: 1 } },

    /* orgs */
    {
      name: 'orgs.slug',
      collection: identity.orgs(),
      keys: { slug: 1 },
      options: { unique: true },
    },
    { name: 'orgs.createdBy', collection: identity.orgs(), keys: { createdBy: 1 } },
    { name: 'orgs.deletedAt', collection: identity.orgs(), keys: { deletedAt: 1 } },

    /* memberships */
    {
      name: 'memberships.orgId.userId',
      collection: identity.memberships(),
      keys: { orgId: 1, userId: 1 },
      options: { unique: true },
    },
    {
      name: 'memberships.userId.status',
      collection: identity.memberships(),
      keys: { userId: 1, status: 1 },
    },
    {
      name: 'memberships.orgId.role',
      collection: identity.memberships(),
      keys: { orgId: 1, role: 1 },
    },
    {
      name: 'memberships.orgId.status',
      collection: identity.memberships(),
      keys: { orgId: 1, status: 1 },
    },

    /* invitations */
    {
      name: 'invitations.tokenHash',
      collection: identity.invitations(),
      keys: { tokenHash: 1 },
      options: { unique: true },
    },
    {
      name: 'invitations.orgId.email',
      collection: identity.invitations(),
      keys: { orgId: 1, email: 1 },
    },
    {
      name: 'invitations.expiresAt',
      collection: identity.invitations(),
      keys: { expiresAt: 1 },
      options: { expireAfterSeconds: 0 },
    },

    /* api_keys */
    {
      name: 'api_keys.keyHash',
      collection: identity.apiKeys(),
      keys: { keyHash: 1 },
      options: { unique: true },
    },
    {
      name: 'api_keys.orgId.revokedAt',
      collection: identity.apiKeys(),
      keys: { orgId: 1, revokedAt: 1 },
    },
    { name: 'api_keys.prefix', collection: identity.apiKeys(), keys: { prefix: 1 } },

    /* auth_events - 180 day retention */
    {
      name: 'auth_events.userId.timestamp',
      collection: identity.authEvents(),
      keys: { userId: 1, timestamp: -1 },
    },
    {
      name: 'auth_events.email.timestamp',
      collection: identity.authEvents(),
      keys: { email: 1, timestamp: -1 },
    },
    {
      name: 'auth_events.timestamp',
      collection: identity.authEvents(),
      keys: { timestamp: -1 },
      options: { expireAfterSeconds: 15_552_000 },
    },

    /* rate_limits (Plan §9.4) */
    {
      name: 'rate_limits.key',
      collection: identity.rateLimits(),
      keys: { key: 1 },
      options: { unique: true },
    },
    {
      name: 'rate_limits.expiresAt',
      collection: identity.rateLimits(),
      keys: { expiresAt: 1 },
      options: { expireAfterSeconds: 0 },
    },
  ];
}

function dataJobs(): IndexJob[] {
  return [
    /* policies */
    {
      name: 'policies.orgId.name',
      collection: data.policies(),
      keys: { orgId: 1, name: 1 },
      options: { unique: true },
    },
    {
      name: 'policies.orgId.arn',
      collection: data.policies(),
      keys: { orgId: 1, arn: 1 },
      options: { unique: true },
    },
    {
      name: 'policies.orgId.deleted.updatedAt',
      collection: data.policies(),
      keys: { orgId: 1, deleted: 1, updatedAt: -1 },
    },
    {
      name: 'policies.orgId.tags.team',
      collection: data.policies(),
      keys: { orgId: 1, 'tags.team': 1 },
    },

    /* policy_versions */
    {
      name: 'policy_versions.orgId.policyId.version',
      collection: data.policyVersions(),
      keys: { orgId: 1, policyId: 1, version: -1 },
    },
    {
      name: 'policy_versions.orgId.createdAt',
      collection: data.policyVersions(),
      keys: { orgId: 1, createdAt: -1 },
    },

    /* principals */
    {
      name: 'principals.orgId.arn',
      collection: data.principals(),
      keys: { orgId: 1, arn: 1 },
      options: { unique: true },
    },
    {
      name: 'principals.orgId.name',
      collection: data.principals(),
      keys: { orgId: 1, name: 1 },
      options: { unique: true },
    },
    {
      name: 'principals.orgId.type.deleted',
      collection: data.principals(),
      keys: { orgId: 1, type: 1, deleted: 1 },
    },
    {
      name: 'principals.orgId.groupMemberships',
      collection: data.principals(),
      keys: { orgId: 1, groupMemberships: 1 },
    },
    {
      name: 'principals.orgId.assumeRoleTargets',
      collection: data.principals(),
      keys: { orgId: 1, assumeRoleTargets: 1 },
    },
    {
      name: 'principals.orgId.tags.team',
      collection: data.principals(),
      keys: { orgId: 1, 'tags.team': 1 },
    },

    /* resources */
    {
      name: 'resources.orgId.arn',
      collection: data.resources(),
      keys: { orgId: 1, arn: 1 },
      options: { unique: true },
    },
    {
      name: 'resources.orgId.type.deleted',
      collection: data.resources(),
      keys: { orgId: 1, type: 1, deleted: 1 },
    },
    {
      name: 'resources.orgId.tags.environment',
      collection: data.resources(),
      keys: { orgId: 1, 'tags.environment': 1 },
    },

    /* scenarios */
    { name: 'scenarios.orgId.tags', collection: data.scenarios(), keys: { orgId: 1, tags: 1 } },
    { name: 'scenarios.orgId.name', collection: data.scenarios(), keys: { orgId: 1, name: 1 } },
    {
      name: 'scenarios.orgId.updatedAt',
      collection: data.scenarios(),
      keys: { orgId: 1, updatedAt: -1 },
    },

    /* evaluation_runs - 90 day retention.
     * NOTE(spec): MongoDB rejects `expireAfterSeconds` on a compound index
     * ("TTL indexes are single-field indexes"), so §7.2's compound index and its TTL are created
     * as two separate indexes - the compound one for query shape, the single-field one for
     * retention. */
    {
      name: 'evaluation_runs.orgId.createdAt',
      collection: data.evaluationRuns(),
      keys: { orgId: 1, createdAt: -1 },
    },
    {
      name: 'evaluation_runs.createdAt.ttl',
      collection: data.evaluationRuns(),
      keys: { createdAt: 1 },
      options: { expireAfterSeconds: 7_776_000 },
    },
    {
      name: 'evaluation_runs.orgId.snapshotAt',
      collection: data.evaluationRuns(),
      keys: { orgId: 1, snapshotAt: -1 },
    },
    {
      name: 'evaluation_runs.orgId.causedByAuditEventId',
      collection: data.evaluationRuns(),
      keys: { orgId: 1, causedByAuditEventId: 1 },
    },

    /* escalation_paths */
    {
      name: 'escalation_paths.orgId.fromPrincipalArn.severity',
      collection: data.escalationPaths(),
      keys: { orgId: 1, fromPrincipalArn: 1, severity: -1 },
    },
    {
      name: 'escalation_paths.orgId.computedAt',
      collection: data.escalationPaths(),
      keys: { orgId: 1, computedAt: -1 },
    },
    {
      name: 'escalation_paths.orgId.fromPrincipalArn.toPrincipalArn',
      collection: data.escalationPaths(),
      keys: { orgId: 1, fromPrincipalArn: 1, toPrincipalArn: 1 },
      options: { unique: true },
    },

    /* audit_events */
    {
      name: 'audit_events.orgId.timestamp',
      collection: data.auditEvents(),
      keys: { orgId: 1, timestamp: -1 },
    },
    {
      name: 'audit_events.orgId.target',
      collection: data.auditEvents(),
      keys: { orgId: 1, 'target.type': 1, 'target.id': 1, timestamp: -1 },
    },
    {
      name: 'audit_events.orgId.actorUserId',
      collection: data.auditEvents(),
      keys: { orgId: 1, actorUserId: 1, timestamp: -1 },
    },
    {
      name: 'audit_events.orgId.action',
      collection: data.auditEvents(),
      keys: { orgId: 1, action: 1, timestamp: -1 },
    },

    /* presence - 60 second TTL (compound index + single-field TTL, see the note above) */
    {
      name: 'presence.orgId.lastSeenAt',
      collection: data.presence(),
      keys: { orgId: 1, lastSeenAt: -1 },
    },
    {
      name: 'presence.lastSeenAt.ttl',
      collection: data.presence(),
      keys: { lastSeenAt: 1 },
      options: { expireAfterSeconds: 60 },
    },
    {
      name: 'presence.orgId.userId.sessionId',
      collection: data.presence(),
      keys: { orgId: 1, userId: 1, sessionId: 1 },
      options: { unique: true },
    },
  ];
}

export function listIndexJobs(): { identity: IndexJob[]; data: IndexJob[] } {
  return { identity: identityJobs(), data: dataJobs() };
}

/** Creates every index. Safe to call on every boot. */
export async function createIndexes(): Promise<IndexCreationReport> {
  const identityResult = await runJobs(identityJobs());
  const dataResult = await runJobs(dataJobs());
  const report: IndexCreationReport = {
    identity: identityResult.created,
    data: dataResult.created,
    failures: [...identityResult.failures, ...dataResult.failures],
  };
  logger.info(
    {
      identityIndexes: report.identity,
      dataIndexes: report.data,
      failures: report.failures.length,
    },
    'indexes ensured',
  );
  return report;
}

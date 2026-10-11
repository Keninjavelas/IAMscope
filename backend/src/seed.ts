/**
 * Idempotent demo seed (Plan §22.4, §25 phase 11).
 *
 * Default demo credentials (development only):
 *   owner  demo@iamscope.dev     / iamscope-demo-2026
 *   admin  analyst@iamscope.dev  / iamscope-demo-2026
 *
 * Running this twice is safe: every insert is keyed by a natural unique field (email, slug, ARN,
 * policy name, scenario name) and skipped when it already exists. The final summary prints exactly
 * which collections were populated and which were skipped.
 */
import { type ObjectId } from 'mongodb';
import {
  DEFAULT_ORG_SETTINGS,
  DEFAULT_USER_PREFERENCES,
  type PolicyStatement,
  type PrincipalType,
} from '@iamscope/types';
import { hashPassword } from './auth/password';
import { data } from './db/data';
import { closeData, connectData } from './db/data';
import { closeIdentity, connectIdentity, identity } from './db/identity';
import { createIndexes } from './db/indexes';
import type {
  ApiKeyDoc,
  MembershipDoc,
  OrgDoc,
  PolicyDoc,
  PolicyVersionDoc,
  PrincipalDoc,
  ResourceDoc,
  ScenarioDoc,
  UserDoc,
} from './db/documents';
import { env } from './env';
import { logger } from './logger';
import { buildPolicyArn, buildRoleArn, buildUserArn } from './lib/arn';
import { oidRequired } from './lib/objectId';
import { computeEscalationPaths } from './services/escalation';
import { runEvaluationNow } from './services/evaluationRunner';
import { writeAuditEvent } from './services/audit';

const DEFAULT_DEMO_PASSWORD = 'iamscope-demo-2026';
const DEMO_PASSWORD = process.env.IAM_DEMO_PASSWORD ?? DEFAULT_DEMO_PASSWORD;
const DEMO_EMAIL = 'demo@iamscope.dev';
const ANALYST_EMAIL = 'analyst@iamscope.dev';
const ORG_NAME = 'Acme Cloud';
const ORG_SLUG = 'acme-cloud';
const ACCOUNT_ID = '123456789012';
const S3_BUCKET_ARN = `arn:aws:s3:::acme-prod-data`;
const S3_OBJECT_ARN = `arn:aws:s3:::acme-prod-data/*`;

interface SeedReport {
  created: Record<string, number>;
  skipped: Record<string, number>;
}

function bump(bucket: Record<string, number>, key: string): void {
  bucket[key] = (bucket[key] ?? 0) + 1;
}

/* ------------------------------------------------------------------ */
/* Static demo data                                                    */
/* ------------------------------------------------------------------ */

const POLICY_BLUEPRINTS: {
  name: string;
  tags: Record<string, string>;
  statements: PolicyStatement[];
}[] = [
  {
    name: 'S3-ReadOnly',
    tags: { team: 'platform', environment: 'production' },
    statements: [
      {
        sid: 'AllowListBucket',
        effect: 'Allow',
        actions: ['s3:ListBucket', 's3:GetBucketLocation'],
        resources: [S3_BUCKET_ARN],
        conditions: [],
      },
      {
        sid: 'AllowGetObject',
        effect: 'Allow',
        actions: ['s3:GetObject'],
        resources: [S3_OBJECT_ARN],
        conditions: [{ operator: 'StringLike', key: 's3:prefix', values: ['reports/*'] }],
      },
      {
        sid: 'DenySecretObjects',
        effect: 'Deny',
        actions: ['s3:GetObject'],
        resources: [`${S3_BUCKET_ARN}/secrets/*`],
        conditions: [],
      },
    ],
  },
  {
    name: 'Lambda-Deploy',
    tags: { team: 'platform', environment: 'production' },
    statements: [
      {
        sid: 'AllowPassRoleToLambda',
        effect: 'Allow',
        actions: ['iam:PassRole'],
        resources: [buildRoleArn(ACCOUNT_ID, 'LambdaExecRole')],
        conditions: [
          {
            operator: 'StringEquals',
            key: 'iam:PassedToService',
            values: ['lambda.amazonaws.com'],
          },
        ],
      },
      {
        sid: 'AllowFunctionLifecycle',
        effect: 'Allow',
        actions: ['lambda:CreateFunction', 'lambda:UpdateFunctionCode', 'lambda:InvokeFunction'],
        resources: [`arn:aws:lambda:us-east-1:${ACCOUNT_ID}:function:acme-*`],
        conditions: [],
      },
      {
        sid: 'DenyDeleteFunction',
        effect: 'Deny',
        actions: ['lambda:DeleteFunction'],
        resources: ['*'],
        conditions: [],
      },
    ],
  },
  {
    name: 'IAM-SelfService',
    tags: { team: 'security', environment: 'production' },
    statements: [
      {
        sid: 'AllowPolicyVersionManagement',
        effect: 'Allow',
        actions: ['iam:CreatePolicyVersion', 'iam:SetDefaultPolicyVersion'],
        resources: [`arn:aws:iam::${ACCOUNT_ID}:policy/*`],
        conditions: [],
      },
      {
        sid: 'AllowAttachToSelf',
        effect: 'Allow',
        actions: ['iam:AttachUserPolicy'],
        resources: [buildUserArn(ACCOUNT_ID, 'platform-engineer')],
        conditions: [],
      },
    ],
  },
  {
    name: 'EC2-Operator',
    tags: { team: 'platform', environment: 'staging' },
    statements: [
      {
        sid: 'AllowRunInstancesWithRole',
        effect: 'Allow',
        actions: ['ec2:RunInstances', 'iam:PassRole'],
        resources: ['*'],
        conditions: [],
      },
      {
        sid: 'DenyTerminateInstances',
        effect: 'Deny',
        actions: ['ec2:TerminateInstances'],
        resources: ['*'],
        conditions: [],
      },
    ],
  },
  {
    name: 'Audit-ReadOnly',
    tags: { team: 'security', environment: 'production' },
    statements: [
      {
        sid: 'AllowAuditReads',
        effect: 'Allow',
        actions: ['cloudtrail:LookupEvents', 's3:GetObject', 's3:ListBucket'],
        resources: ['*'],
        conditions: [
          { operator: 'StringEquals', key: 'aws:RequestedRegion', values: ['us-east-1'] },
        ],
      },
    ],
  },
  {
    name: 'AssumeRole-Broader',
    tags: { team: 'platform', environment: 'production' },
    statements: [
      {
        sid: 'AllowAssumeAdminRole',
        effect: 'Allow',
        actions: ['sts:AssumeRole'],
        resources: [buildRoleArn(ACCOUNT_ID, 'AdminRole')],
        conditions: [
          { operator: 'StringEquals', key: 'aws:PrincipalTag/team', values: ['platform'] },
        ],
      },
    ],
  },
];

interface PrincipalBlueprint {
  type: PrincipalType;
  name: string;
  arn: string;
  policies: string[];
  groups?: string[];
  assumeRoleTargets?: string[];
  tags: Record<string, string>;
}

const PRINCIPAL_BLUEPRINTS: PrincipalBlueprint[] = [
  {
    type: 'User',
    name: 'platform-engineer',
    arn: buildUserArn(ACCOUNT_ID, 'platform-engineer'),
    policies: ['IAM-SelfService'],
    groups: [buildRoleArn(ACCOUNT_ID, 'PlatformGroup')],
    assumeRoleTargets: [buildRoleArn(ACCOUNT_ID, 'DeployRole')],
    tags: { team: 'platform' },
  },
  {
    type: 'Group',
    name: 'PlatformGroup',
    arn: buildRoleArn(ACCOUNT_ID, 'PlatformGroup'),
    policies: ['S3-ReadOnly'],
    tags: { team: 'platform' },
  },
  {
    type: 'Role',
    name: 'DeployRole',
    arn: buildRoleArn(ACCOUNT_ID, 'DeployRole'),
    policies: ['Lambda-Deploy', 'EC2-Operator'],
    assumeRoleTargets: [buildRoleArn(ACCOUNT_ID, 'AdminRole')],
    tags: { team: 'platform' },
  },
  {
    type: 'Role',
    name: 'LambdaExecRole',
    arn: buildRoleArn(ACCOUNT_ID, 'LambdaExecRole'),
    policies: ['Audit-ReadOnly'],
    tags: { team: 'platform' },
  },
  {
    type: 'Role',
    name: 'AdminRole',
    arn: buildRoleArn(ACCOUNT_ID, 'AdminRole'),
    policies: ['AssumeRole-Broader'],
    assumeRoleTargets: [buildRoleArn(ACCOUNT_ID, 'SecurityAuditRole')],
    tags: { team: 'security' },
  },
  {
    type: 'Role',
    name: 'SecurityAuditRole',
    arn: buildRoleArn(ACCOUNT_ID, 'SecurityAuditRole'),
    policies: ['Audit-ReadOnly'],
    tags: { team: 'security' },
  },
  {
    type: 'User',
    name: 'data-analyst',
    arn: buildUserArn(ACCOUNT_ID, 'data-analyst'),
    policies: ['S3-ReadOnly'],
    groups: [buildRoleArn(ACCOUNT_ID, 'PlatformGroup')],
    tags: { team: 'data' },
  },
  {
    type: 'Group',
    name: 'Contractors',
    arn: buildRoleArn(ACCOUNT_ID, 'Contractors'),
    policies: [],
    tags: { team: 'external' },
  },
];

const RESOURCE_BLUEPRINTS: {
  arn: string;
  type: string;
  tags: Record<string, string>;
  accountId: string | null;
}[] = [
  {
    arn: S3_BUCKET_ARN,
    type: 's3-bucket',
    tags: { environment: 'production', team: 'platform' },
    accountId: ACCOUNT_ID,
  },
  {
    arn: S3_OBJECT_ARN,
    type: 's3-object',
    tags: { environment: 'production' },
    accountId: ACCOUNT_ID,
  },
  {
    arn: `${S3_BUCKET_ARN}/reports/2026-q1.csv`,
    type: 's3-object',
    tags: { environment: 'production' },
    accountId: ACCOUNT_ID,
  },
  {
    arn: `${S3_BUCKET_ARN}/secrets/rotation.json`,
    type: 's3-object',
    tags: { environment: 'production', team: 'security' },
    accountId: ACCOUNT_ID,
  },
  {
    arn: `arn:aws:lambda:us-east-1:${ACCOUNT_ID}:function:acme-etl`,
    type: 'lambda-function',
    tags: { environment: 'production' },
    accountId: ACCOUNT_ID,
  },
  {
    arn: `arn:aws:ec2:us-east-1:${ACCOUNT_ID}:instance/*`,
    type: 'ec2-instance',
    tags: { environment: 'staging' },
    accountId: ACCOUNT_ID,
  },
  {
    arn: `arn:aws:cloudtrail:us-east-1:${ACCOUNT_ID}:trail/acme-audit`,
    type: 'cloudtrail-trail',
    tags: { environment: 'production' },
    accountId: ACCOUNT_ID,
  },
  {
    arn: `arn:aws:dynamodb:us-east-1:${ACCOUNT_ID}:table/acme-sessions`,
    type: 'dynamodb-table',
    tags: { environment: 'production' },
    accountId: ACCOUNT_ID,
  },
];

const SCENARIO_BLUEPRINTS: {
  name: string;
  principalArn: string;
  action: string;
  resourceArn: string;
  expectedResult: 'Allow' | 'Deny';
  tags: string[];
}[] = [
  {
    name: 'Analyst can read reports',
    principalArn: buildUserArn(ACCOUNT_ID, 'data-analyst'),
    action: 's3:GetObject',
    resourceArn: `${S3_BUCKET_ARN}/reports/2026-q1.csv`,
    expectedResult: 'Allow',
    tags: ['regression', 's3'],
  },
  {
    name: 'Analyst cannot read secrets',
    principalArn: buildUserArn(ACCOUNT_ID, 'data-analyst'),
    action: 's3:GetObject',
    resourceArn: `${S3_BUCKET_ARN}/secrets/rotation.json`,
    expectedResult: 'Deny',
    tags: ['security', 's3'],
  },
  {
    name: 'Analyst can list the bucket',
    principalArn: buildUserArn(ACCOUNT_ID, 'data-analyst'),
    action: 's3:ListBucket',
    resourceArn: S3_BUCKET_ARN,
    expectedResult: 'Allow',
    tags: ['regression', 's3'],
  },
  {
    name: 'Engineer can deploy lambda',
    principalArn: buildUserArn(ACCOUNT_ID, 'platform-engineer'),
    action: 'lambda:CreateFunction',
    resourceArn: `arn:aws:lambda:us-east-1:${ACCOUNT_ID}:function:acme-etl`,
    expectedResult: 'Allow',
    tags: ['deploy', 'lambda'],
  },
  {
    name: 'DeployRole cannot delete lambda',
    principalArn: buildRoleArn(ACCOUNT_ID, 'DeployRole'),
    action: 'lambda:DeleteFunction',
    resourceArn: `arn:aws:lambda:us-east-1:${ACCOUNT_ID}:function:acme-etl`,
    expectedResult: 'Deny',
    tags: ['lambda'],
  },
  {
    name: 'DeployRole can launch instances',
    principalArn: buildRoleArn(ACCOUNT_ID, 'DeployRole'),
    action: 'ec2:RunInstances',
    resourceArn: `arn:aws:ec2:us-east-1:${ACCOUNT_ID}:instance/*`,
    expectedResult: 'Allow',
    tags: ['ec2'],
  },
  {
    name: 'DeployRole cannot terminate instances',
    principalArn: buildRoleArn(ACCOUNT_ID, 'DeployRole'),
    action: 'ec2:TerminateInstances',
    resourceArn: `arn:aws:ec2:us-east-1:${ACCOUNT_ID}:instance/*`,
    expectedResult: 'Deny',
    tags: ['ec2'],
  },
  {
    name: 'Engineer can assume DeployRole',
    principalArn: buildUserArn(ACCOUNT_ID, 'platform-engineer'),
    action: 'sts:AssumeRole',
    resourceArn: buildRoleArn(ACCOUNT_ID, 'DeployRole'),
    expectedResult: 'Deny',
    tags: ['escalation', 'sts'],
  },
  {
    name: 'AdminRole can assume SecurityAuditRole',
    principalArn: buildRoleArn(ACCOUNT_ID, 'AdminRole'),
    action: 'sts:AssumeRole',
    resourceArn: buildRoleArn(ACCOUNT_ID, 'SecurityAuditRole'),
    expectedResult: 'Allow',
    tags: ['escalation', 'sts'],
  },
  {
    name: 'Anonymous cannot read bucket',
    principalArn: buildUserArn(ACCOUNT_ID, 'ghost-user'),
    action: 's3:GetObject',
    resourceArn: S3_OBJECT_ARN,
    expectedResult: 'Deny',
    tags: ['regression'],
  },
];

/* ------------------------------------------------------------------ */
/* Seed                                                                */
/* ------------------------------------------------------------------ */

async function seedUser(email: string, name: string, report: SeedReport): Promise<UserDoc> {
  const existing = await identity.users().findOne({ email });
  if (existing !== null) {
    bump(report.skipped, 'users');
    return existing;
  }

  const now = new Date();
  const doc: Omit<UserDoc, '_id'> = {
    email,
    name,
    avatarUrl: null,
    passwordHash: await hashPassword(DEMO_PASSWORD),
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
  bump(report.created, 'users');
  return { ...doc, _id: inserted.insertedId };
}

async function seedOrg(ownerId: ObjectId, report: SeedReport): Promise<OrgDoc> {
  const existing = await identity.orgs().findOne({ slug: ORG_SLUG });
  if (existing !== null) {
    bump(report.skipped, 'orgs');
    return existing;
  }

  const now = new Date();
  const doc: Omit<OrgDoc, '_id'> = {
    name: ORG_NAME,
    slug: ORG_SLUG,
    plan: 'free',
    createdBy: ownerId,
    settings: { ...DEFAULT_ORG_SETTINGS },
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const inserted = await identity.orgs().insertOne(doc as OrgDoc);
  bump(report.created, 'orgs');
  return { ...doc, _id: inserted.insertedId };
}

async function seedMembership(
  orgId: ObjectId,
  userId: ObjectId,
  role: MembershipDoc['role'],
  report: SeedReport,
): Promise<void> {
  const existing = await identity.memberships().findOne({ orgId, userId });
  if (existing !== null) {
    bump(report.skipped, 'memberships');
    return;
  }

  const doc: Omit<MembershipDoc, '_id'> = {
    orgId,
    userId,
    role,
    invitedBy: null,
    joinedAt: new Date(),
    status: 'active',
  };
  await identity.memberships().insertOne(doc as MembershipDoc);
  bump(report.created, 'memberships');
}

async function seedPolicies(
  orgId: ObjectId,
  ownerId: ObjectId,
  report: SeedReport,
): Promise<Map<string, PolicyDoc>> {
  const result = new Map<string, PolicyDoc>();

  for (const blueprint of POLICY_BLUEPRINTS) {
    const existing = await data.policies().findOne({ orgId, name: blueprint.name });
    if (existing !== null) {
      result.set(blueprint.name, existing);
      bump(report.skipped, 'policies');
      continue;
    }

    const now = new Date();
    const doc: Omit<PolicyDoc, '_id'> = {
      orgId,
      name: blueprint.name,
      arn: buildPolicyArn(ACCOUNT_ID, blueprint.name),
      currentVersion: 1,
      statements: blueprint.statements,
      tags: blueprint.tags,
      deleted: false,
      createdBy: ownerId,
      updatedBy: ownerId,
      createdAt: now,
      updatedAt: now,
    };
    const inserted = await data.policies().insertOne(doc as PolicyDoc);
    result.set(blueprint.name, { ...doc, _id: inserted.insertedId });

    const version: Omit<PolicyVersionDoc, '_id'> = {
      orgId,
      policyId: inserted.insertedId,
      version: 1,
      statements: blueprint.statements,
      changedBy: ownerId,
      changeReason: 'seed: initial policy',
      createdAt: now,
    };
    await data.policyVersions().insertOne(version as PolicyVersionDoc);
    bump(report.created, 'policies');
    bump(report.created, 'policy_versions');
  }

  return result;
}

async function seedPrincipals(
  orgId: ObjectId,
  ownerId: ObjectId,
  policies: Map<string, PolicyDoc>,
  report: SeedReport,
): Promise<void> {
  for (const blueprint of PRINCIPAL_BLUEPRINTS) {
    const existing = await data.principals().findOne({ orgId, arn: blueprint.arn });
    if (existing !== null) {
      bump(report.skipped, 'principals');
      continue;
    }

    const now = new Date();
    const attached = blueprint.policies
      .map((name) => policies.get(name))
      .filter((policy): policy is PolicyDoc => policy !== undefined)
      .map((policy) => policy._id);

    const doc: Omit<PrincipalDoc, '_id'> = {
      orgId,
      type: blueprint.type,
      name: blueprint.name,
      arn: blueprint.arn,
      attachedPolicies: attached,
      groupMemberships: blueprint.groups ?? [],
      assumeRoleTargets: blueprint.assumeRoleTargets ?? [],
      boundaryPolicyId: null,
      tags: blueprint.tags,
      deleted: false,
      createdBy: ownerId,
      updatedBy: ownerId,
      createdAt: now,
      updatedAt: now,
    };
    await data.principals().insertOne(doc as PrincipalDoc);
    bump(report.created, 'principals');
  }
}

async function seedResources(orgId: ObjectId, report: SeedReport): Promise<void> {
  for (const blueprint of RESOURCE_BLUEPRINTS) {
    const existing = await data.resources().findOne({ orgId, arn: blueprint.arn });
    if (existing !== null) {
      bump(report.skipped, 'resources');
      continue;
    }

    const now = new Date();
    const doc: Omit<ResourceDoc, '_id'> = {
      orgId,
      arn: blueprint.arn,
      type: blueprint.type,
      tags: blueprint.tags,
      accountId: blueprint.accountId,
      deleted: false,
      createdAt: now,
      updatedAt: now,
    };
    await data.resources().insertOne(doc as ResourceDoc);
    bump(report.created, 'resources');
  }
}

async function seedScenarios(
  orgId: ObjectId,
  ownerId: ObjectId,
  report: SeedReport,
): Promise<void> {
  for (const blueprint of SCENARIO_BLUEPRINTS) {
    const existing = await data.scenarios().findOne({ orgId, name: blueprint.name });
    if (existing !== null) {
      bump(report.skipped, 'scenarios');
      continue;
    }

    const now = new Date();
    const doc: Omit<ScenarioDoc, '_id'> = {
      orgId,
      name: blueprint.name,
      principalArn: blueprint.principalArn,
      action: blueprint.action,
      resourceArn: blueprint.resourceArn,
      expectedResult: blueprint.expectedResult,
      tags: blueprint.tags,
      createdBy: ownerId,
      createdAt: now,
      updatedAt: now,
      lastResult: null,
      lastRunAt: null,
    };
    await data.scenarios().insertOne(doc as ScenarioDoc);
    bump(report.created, 'scenarios');
  }
}

async function seedApiKey(orgId: ObjectId, ownerId: ObjectId, report: SeedReport): Promise<void> {
  const existing = await identity.apiKeys().findOne({ orgId, name: 'seed-readonly' });
  if (existing !== null) {
    bump(report.skipped, 'api_keys');
    return;
  }

  const doc: Omit<ApiKeyDoc, '_id'> = {
    orgId,
    name: 'seed-readonly',
    // sha256 of a fixed demo secret; the plaintext is never stored.
    keyHash: '4a1d4f5b9d1f2c0d0d5f9b7a3c2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e',
    prefix: 'imsk_see',
    scopes: ['read', 'evaluate'],
    createdBy: ownerId,
    createdAt: new Date(),
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
  };
  await identity.apiKeys().insertOne(doc as ApiKeyDoc);
  bump(report.created, 'api_keys');
}

async function seedAuditNoise(
  orgId: ObjectId,
  ownerId: ObjectId,
  ownerEmail: string,
  report: SeedReport,
): Promise<void> {
  const marker = 'seed:baseline';
  const existing = await data.auditEvents().findOne({ orgId, 'metadata.marker': marker });
  if (existing !== null) {
    bump(report.skipped, 'audit_events');
    return;
  }

  const policies = await data.policies().find({ orgId }).toArray();
  const principals = await data.principals().find({ orgId }).toArray();
  const base = Date.now() - 3 * 24 * 60 * 60 * 1_000;

  let offset = 0;
  for (const policy of policies.slice(0, 4)) {
    offset += 1;
    await writeAuditEvent({
      orgId,
      actorUserId: ownerId,
      actorEmail: ownerEmail,
      actorType: 'user',
      action: 'policy.create',
      target: { type: 'policy', id: oidRequired(policy._id), name: policy.name },
      after: { name: policy.name, arn: policy.arn, version: policy.currentVersion },
      metadata: { marker },
    });
    bump(report.created, 'audit_events');
  }

  for (const principal of principals.slice(0, 3)) {
    offset += 1;
    await writeAuditEvent({
      orgId,
      actorUserId: ownerId,
      actorEmail: ownerEmail,
      actorType: 'user',
      action: 'principal.attach',
      target: { type: 'principal', id: oidRequired(principal._id), name: principal.name },
      after: {
        name: principal.name,
        arn: principal.arn,
        type: principal.type,
        attachedPolicies: principal.attachedPolicies.map(oidRequired),
      },
      metadata: { marker, order: offset, seededAt: new Date(base + offset * 60_000).toISOString() },
    });
    bump(report.created, 'audit_events');
  }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export async function seed(): Promise<SeedReport> {
  const report: SeedReport = { created: {}, skipped: {} };

  const owner = await seedUser(DEMO_EMAIL, 'Demo Owner', report);
  const analyst = await seedUser(ANALYST_EMAIL, 'Priya Analyst', report);

  const org = await seedOrg(owner._id, report);
  await seedMembership(org._id, owner._id, 'owner', report);
  await seedMembership(org._id, analyst._id, 'admin', report);

  const policies = await seedPolicies(org._id, owner._id, report);
  await seedPrincipals(org._id, owner._id, policies, report);
  await seedResources(org._id, report);
  await seedScenarios(org._id, owner._id, report);
  await seedApiKey(org._id, owner._id, report);
  await seedAuditNoise(org._id, owner._id, owner.email, report);

  // Escalation paths: the user -> DeployRole -> AdminRole -> SecurityAuditRole chain is a real
  // multi-hop path, so the Graph lens has something to render immediately.
  const escalation = await computeEscalationPaths(org._id, { maxDepth: 5 });
  report.created.escalation_paths = escalation.paths.length;

  // Three staggered evaluation runs so the Impact lens can diff two of them.
  const existingRuns = await data.evaluationRuns().countDocuments({ orgId: org._id });
  if (existingRuns === 0) {
    await runEvaluationNow({
      orgId: org._id,
      trigger: 'seed',
      triggeredByUserId: owner._id,
      label: 'seed: baseline',
    });
    bump(report.created, 'evaluation_runs');

    await runEvaluationNow({
      orgId: org._id,
      trigger: 'policy.update',
      triggeredByUserId: analyst._id,
      label: 'seed: after S3 read tightening',
    });
    bump(report.created, 'evaluation_runs');

    await runEvaluationNow({
      orgId: org._id,
      trigger: 'manual',
      triggeredByUserId: owner._id,
      label: 'seed: current',
    });
    bump(report.created, 'evaluation_runs');
  } else {
    bump(report.skipped, 'evaluation_runs');
  }

  return report;
}

function printReport(report: SeedReport): void {
  const created = Object.entries(report.created)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  const skipped = Object.entries(report.skipped)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');

  console.log('IAMScope seed summary');
  console.log('---------------------');
  console.log(`created : ${created === '' ? '(nothing)' : created}`);
  console.log(`skipped : ${skipped === '' ? '(nothing)' : skipped}`);
  console.log('');
  console.log('Demo accounts:');
  console.log(`  owner  ${DEMO_EMAIL}`);
  console.log(`  admin  ${ANALYST_EMAIL}`);
  console.log(
    process.env.IAM_DEMO_PASSWORD
      ? '  password supplied by IAM_DEMO_PASSWORD (not printed)'
      : `  development password  ${DEFAULT_DEMO_PASSWORD}`,
  );
  console.log(`  org    ${ORG_NAME} (${ORG_SLUG})`);
}

async function main(): Promise<void> {
  if (env.NODE_ENV === 'production' && !process.env.IAM_DEMO_PASSWORD) {
    throw new Error('IAM_DEMO_PASSWORD must be set when seeding in production');
  }
  if (process.env.IAM_DEMO_PASSWORD !== undefined && DEMO_PASSWORD.length < 16) {
    throw new Error('IAM_DEMO_PASSWORD must be at least 16 characters');
  }
  try {
    await connectIdentity();
    await connectData();
    await createIndexes();

    const report = await seed();
    printReport(report);
  } finally {
    // Always release the pools. A seed that fails part-way used to leave both Mongo
    // clients holding the event loop open, so the process hung instead of exiting and
    // the smoke harness could only report a timeout (Plan §22.4).
    await Promise.all([closeIdentity(), closeData()]);
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    logger.fatal({ err: error, env: env.NODE_ENV }, 'seed failed');
    process.exitCode = 1;
  });
}

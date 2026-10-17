#!/usr/bin/env node
/**
 * Multi-tenant volume seed.
 *
 * Creates 5 organizations, each with 3 users (1 owner + 2 members), 4 policies,
 * 4 resources, 3 principals, 3 scenarios, plus audit events and evaluation runs
 * for the first three organizations so the Timeline and Impact lenses have data.
 *
 * Idempotent by organization slug: re-running skips any organization that already
 * exists, so a second run cannot double the dataset or violate the unique email
 * index. Pass --force to delete and recreate the seeded organizations first.
 *
 *   node scripts/seed-volume.mjs
 *   node scripts/seed-volume.mjs --force
 *
 * Uses the mongodb driver and argon2 directly (both hoisted to the workspace root);
 * this file is intentionally plain ESM and is excluded from tsc/eslint.
 */
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import argon2 from 'argon2';
import { MongoClient, ObjectId } from 'mongodb';

/* ------------------------------------------------------------------ */
/* Connection                                                         */
/* ------------------------------------------------------------------ */

const HOST = 'cluster0.8zf7aek.mongodb.net';
const USER = 'aryankapoor0303_db_user';
const PASSWORD = 'Tbmi-741';

const uriFor = (db) =>
  `mongodb+srv://${USER}:${PASSWORD}@${HOST}/${db}?retryWrites=true&w=majority`;

/**
 * Some resolvers refuse SRV queries over the protocol Node's c-ares uses, which
 * surfaces as ECONNREFUSED on `querySrv` even though the record exists. Falling
 * back to a public resolver keeps the script usable without changing the URI.
 */
async function ensureSrvResolution() {
  try {
    await dnsPromises.resolveSrv(`_mongodb._tcp.${HOST}`);
  } catch (error) {
    console.log(`  ! SRV lookup failed (${error.code}); retrying via 1.1.1.1`);
    dns.setServers(['1.1.1.1', '8.8.8.8']);
  }
}

const ACCOUNT_ID = '123456789012';
const DEFAULT_PASSWORD = 'Password123!';
const NOW = new Date();
const FORCE = process.argv.includes('--force');

/* ------------------------------------------------------------------ */
/* Fixtures                                                           */
/* ------------------------------------------------------------------ */

const ORGS = [
  { name: 'Acme Cloud', slug: 'seed-acme-cloud', label: 'acme-1' },
  { name: 'Northwind Analytics', slug: 'seed-northwind', label: 'northwind-2' },
  { name: 'Globex Security', slug: 'seed-globex', label: 'globex-3' },
  { name: 'Initech Platform', slug: 'seed-initech', label: 'initech-4' },
  { name: 'Umbrella Logistics', slug: 'seed-umbrella', label: 'umbrella-5' },
];

const PEOPLE = [
  { key: 'alice', role: 'owner', first: 'Alice', last: 'Nguyen' },
  { key: 'bob', role: 'member', first: 'Bob', last: 'Martinez' },
  { key: 'carol', role: 'member', first: 'Carol', last: 'Okafor' },
];

const POLICY_BLUEPRINTS = [
  {
    key: 'S3ReadOnly',
    statements: [
      {
        sid: 'ReadObjects',
        effect: 'Allow',
        actions: ['s3:GetObject', 's3:ListBucket'],
        resources: ['arn:aws:s3:::BUCKET', 'arn:aws:s3:::BUCKET/*'],
        conditions: [],
      },
    ],
  },
  {
    key: 'S3FullAccess',
    statements: [
      {
        sid: 'FullS3',
        effect: 'Allow',
        actions: ['s3:*'],
        resources: ['arn:aws:s3:::BUCKET', 'arn:aws:s3:::BUCKET/*'],
        conditions: [],
      },
    ],
  },
  {
    key: 'EC2Admin',
    statements: [
      {
        sid: 'ManageInstances',
        effect: 'Allow',
        actions: ['ec2:DescribeInstances', 'ec2:StartInstances', 'ec2:StopInstances'],
        resources: ['arn:aws:ec2:us-east-1:ACCOUNT:instance/*'],
        conditions: [],
      },
    ],
  },
  {
    key: 'DenyDestructive',
    statements: [
      {
        sid: 'NoDeletes',
        effect: 'Deny',
        actions: ['s3:DeleteObject', 'ec2:TerminateInstances'],
        resources: ['*'],
        conditions: [],
      },
    ],
  },
];

const RESOURCE_BLUEPRINTS = [
  { suffix: 'data', arn: (b) => `arn:aws:s3:::${b}-data`, type: 's3-bucket' },
  { suffix: 'logs', arn: (b) => `arn:aws:s3:::${b}-logs`, type: 's3-bucket' },
  {
    suffix: 'instance',
    arn: () => `arn:aws:ec2:us-east-1:${ACCOUNT_ID}:instance/i-0abcdef`,
    type: 'ec2-instance',
  },
  {
    suffix: 'role',
    arn: () => `arn:aws:iam::${ACCOUNT_ID}:role/AdminRole`,
    type: 'iam-role',
  },
];

/* ------------------------------------------------------------------ */
/* Builders                                                           */
/* ------------------------------------------------------------------ */

const bucketOf = (index) => `acme-data-${index + 1}`;

function buildPolicy(blueprint, ctx) {
  const statements = blueprint.statements.map((statement) => ({
    ...statement,
    resources: statement.resources.map((resource) =>
      resource
        .replace('BUCKET', bucketOf(ctx.index))
        .replace('ACCOUNT', ACCOUNT_ID)
        .replace(/\/\*$/, '/*'),
    ),
  }));

  const id = new ObjectId();
  return {
    doc: {
      _id: id,
      orgId: ctx.orgId,
      name: blueprint.key,
      arn: `arn:aws:iam::${ACCOUNT_ID}:policy/${ctx.slug}/${blueprint.key}`,
      currentVersion: 1,
      statements,
      tags: { seeded: 'true' },
      deleted: false,
      createdBy: ctx.ownerId,
      updatedBy: ctx.ownerId,
      createdAt: ctx.createdAt,
      updatedAt: ctx.createdAt,
    },
    version: {
      _id: new ObjectId(),
      orgId: ctx.orgId,
      policyId: id,
      version: 1,
      statements,
      changedBy: ctx.ownerId,
      changeReason: 'Initial version (volume seed)',
      createdAt: ctx.createdAt,
    },
  };
}

function principalArn(type, name, ctx) {
  if (type === 'Group') return `arn:aws:iam::${ACCOUNT_ID}:group/${ctx.slug}/${name}`;
  if (type === 'Role') return `arn:aws:iam::${ACCOUNT_ID}:role/${ctx.slug}/${name}`;
  return `arn:aws:iam::${ACCOUNT_ID}:user/${ctx.slug}/${name}`;
}

/** Deterministic, evaluator-consistent outcomes for the three scenarios. */
function scenarioBlueprints(ctx, policies, resources) {
  const bucket = resources.find((resource) => resource.type === 's3-bucket');
  const instance = resources.find((resource) => resource.type === 'ec2-instance');

  return [
    {
      name: 'Alice reads the data bucket',
      principalArn: principalArn('User', 'alice', ctx),
      action: 's3:GetObject',
      resourceArn: bucket.arn,
      expectedResult: 'Allow',
      result: 'Allow',
      reason: 'explicit-allow',
      matchedPolicy: policies.get('S3ReadOnly'),
    },
    {
      name: 'Bob deletes an object',
      principalArn: principalArn('User', 'bob', ctx),
      action: 's3:DeleteObject',
      resourceArn: bucket.arn,
      expectedResult: 'Allow',
      result: 'Allow',
      reason: 'explicit-allow',
      matchedPolicy: policies.get('S3FullAccess'),
    },
    {
      name: 'Alice terminates the instance',
      principalArn: principalArn('User', 'alice', ctx),
      action: 'ec2:TerminateInstances',
      resourceArn: instance.arn,
      expectedResult: 'Deny',
      result: 'Deny',
      reason: 'implicit-deny',
      matchedPolicy: null,
    },
  ];
}

function traceFor(scenario, ctx) {
  if (scenario.matchedPolicy === null) return [];
  const statement = scenario.matchedPolicy.statements[0];
  return [
    {
      policyId: scenario.matchedPolicy._id.toHexString(),
      policyName: scenario.matchedPolicy.name,
      policyArn: scenario.matchedPolicy.arn,
      sid: statement.sid,
      effect: statement.effect,
      matchedAction: scenario.action,
      matchedResource: scenario.resourceArn,
      matchedConditions: [],
      source: 'principal',
      sourceName: scenario.principalArn.split('/').pop(),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Seed                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  console.log('IAMScope volume seed');
  await ensureSrvResolution();

  const identity = new MongoClient(uriFor('iamscope_identity'), {
    serverSelectionTimeoutMS: 20_000,
  });
  const data = new MongoClient(uriFor('iamscope_data'), { serverSelectionTimeoutMS: 20_000 });

  await identity.connect();
  await data.connect();
  await identity.db().admin().command({ ping: 1 });
  await data.db().admin().command({ ping: 1 });
  console.log('  connected: iamscope_identity, iamscope_data');

  const idb = identity.db();
  const ddb = data.db();

  const users = idb.collection('users');
  const orgs = idb.collection('orgs');
  const memberships = idb.collection('memberships');
  const policies = ddb.collection('policies');
  const policyVersions = ddb.collection('policy_versions');
  const principals = ddb.collection('principals');
  const resources = ddb.collection('resources');
  const scenarios = ddb.collection('scenarios');
  const evaluationRuns = ddb.collection('evaluation_runs');
  const auditEvents = ddb.collection('audit_events');

  // One hash for all seeded accounts: argon2 is deliberately slow, and these are
  // throwaway demo credentials that all share the same password anyway.
  const passwordHash = await argon2.hash(DEFAULT_PASSWORD);
  console.log('  password hash ready (cost defaults)');

  const summary = {
    orgs: 0,
    skippedOrgs: [],
    users: 0,
    memberships: 0,
    policies: 0,
    policyVersions: 0,
    resources: 0,
    principals: 0,
    scenarios: 0,
    evaluationRuns: 0,
    auditEvents: 0,
  };

  for (const [index, orgSpec] of ORGS.entries()) {
    const existing = await orgs.findOne({ slug: orgSpec.slug });
    if (existing !== null && !FORCE) {
      console.log(`  - ${orgSpec.name}: exists, skipped`);
      summary.skippedOrgs.push(orgSpec.name);
      continue;
    }

    if (existing !== null && FORCE) {
      const oldOrgId = existing._id;
      const oldUsers = await memberships.find({ orgId: oldOrgId }).project({ userId: 1 }).toArray();
      await Promise.all([
        orgs.deleteOne({ _id: oldOrgId }),
        memberships.deleteMany({ orgId: oldOrgId }),
        users.deleteMany({ _id: { $in: oldUsers.map((m) => m.userId) } }),
        policies.deleteMany({ orgId: oldOrgId }),
        policyVersions.deleteMany({ orgId: oldOrgId }),
        principals.deleteMany({ orgId: oldOrgId }),
        resources.deleteMany({ orgId: oldOrgId }),
        scenarios.deleteMany({ orgId: oldOrgId }),
        evaluationRuns.deleteMany({ orgId: oldOrgId }),
        auditEvents.deleteMany({ orgId: oldOrgId }),
      ]);
      console.log(`  - ${orgSpec.name}: removed (--force)`);
    }

    const orgId = new ObjectId();
    const createdAt = new Date(NOW.getTime() - (index + 1) * 86_400_000);

    /* --- users + memberships ------------------------------------- */
    const people = PEOPLE.map((person) => {
      const email = `${person.role === 'owner' ? 'owner' : 'member'}-${person.key}@${orgSpec.label}.com`;
      const id = new ObjectId();
      return {
        ...person,
        id,
        email,
        name: `${person.first} ${person.last}`,
        doc: {
          _id: id,
          email,
          name: `${person.first} ${person.last}`,
          avatarUrl: null,
          passwordHash,
          passwordUpdatedAt: createdAt,
          emailVerified: true,
          emailVerificationToken: null,
          mfaEnabled: false,
          mfaSecret: null,
          status: 'active',
          preferences: { density: 'compact', theme: 'dark', accent: 'blue' },
          createdAt,
          updatedAt: createdAt,
          lastLoginAt: new Date(createdAt.getTime() + 3_600_000),
          passwordResetTokenHash: null,
          passwordResetExpiresAt: null,
        },
      };
    });

    await users.insertMany(people.map((person) => person.doc));
    summary.users += people.length;

    const owner = people.find((person) => person.role === 'owner');

    await orgs.insertOne({
      _id: orgId,
      name: orgSpec.name,
      slug: orgSpec.slug,
      plan: index % 2 === 0 ? 'free' : 'team',
      createdBy: owner.id,
      settings: { defaultDensity: 'compact', defaultTheme: 'dark', accent: 'blue' },
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    });
    summary.orgs += 1;

    const membershipDocs = people.map((person) => ({
      _id: new ObjectId(),
      orgId,
      userId: person.id,
      role: person.role,
      invitedBy: person.role === 'owner' ? null : owner.id,
      joinedAt: createdAt,
      status: 'active',
    }));
    await memberships.insertMany(membershipDocs);
    summary.memberships += membershipDocs.length;

    const ctx = { orgId, ownerId: owner.id, slug: orgSpec.slug, index, createdAt };

    /* --- policies ------------------------------------------------ */
    const built = POLICY_BLUEPRINTS.map((blueprint) => buildPolicy(blueprint, ctx));
    await policies.insertMany(built.map((entry) => entry.doc));
    await policyVersions.insertMany(built.map((entry) => entry.version));
    summary.policies += built.length;
    summary.policyVersions += built.length;

    const policyByName = new Map(built.map((entry) => [entry.doc.name, entry.doc]));

    /* --- resources ----------------------------------------------- */
    const resourceDocs = RESOURCE_BLUEPRINTS.map((blueprint) => ({
      _id: new ObjectId(),
      orgId,
      arn: blueprint.arn(bucketOf(index)),
      type: blueprint.type,
      tags: { seeded: 'true' },
      accountId: ACCOUNT_ID,
      deleted: false,
      createdAt,
      updatedAt: createdAt,
    }));
    await resources.insertMany(resourceDocs);
    summary.resources += resourceDocs.length;

    /* --- principals ---------------------------------------------- */
    const principalSpecs = [
      { type: 'User', name: 'alice', policy: 'S3ReadOnly' },
      { type: 'User', name: 'bob', policy: 'S3FullAccess' },
      { type: 'Group', name: 'Admins', policy: 'EC2Admin' },
    ];

    const principalDocs = principalSpecs.map((spec) => ({
      _id: new ObjectId(),
      orgId,
      type: spec.type,
      name: spec.name,
      arn: principalArn(spec.type, spec.name, ctx),
      attachedPolicies: [policyByName.get(spec.policy)._id],
      groupMemberships: spec.type === 'User' ? [principalArn('Group', 'Admins', ctx)] : [],
      assumeRoleTargets: [],
      boundaryPolicyId: null,
      tags: { seeded: 'true' },
      deleted: false,
      createdBy: owner.id,
      updatedBy: owner.id,
      createdAt,
      updatedAt: createdAt,
    }));
    await principals.insertMany(principalDocs);
    summary.principals += principalDocs.length;

    /* --- scenarios ----------------------------------------------- */
    const blueprints = scenarioBlueprints(ctx, policyByName, resourceDocs);
    const scenarioDocs = blueprints.map((entry) => ({
      _id: new ObjectId(),
      orgId,
      name: entry.name,
      principalArn: entry.principalArn,
      action: entry.action,
      resourceArn: entry.resourceArn,
      expectedResult: entry.expectedResult,
      tags: ['seeded'],
      createdBy: owner.id,
      createdAt,
      updatedAt: createdAt,
      lastResult: entry.result,
      lastRunAt: new Date(createdAt.getTime() + 7_200_000),
    }));
    await scenarios.insertMany(scenarioDocs);
    summary.scenarios += scenarioDocs.length;

    /* --- audit events -------------------------------------------- */
    const auditDocs = [
      {
        action: 'policy.create',
        target: {
          type: 'policy',
          id: built[0].doc._id.toHexString(),
          name: built[0].doc.name,
        },
      },
      {
        action: 'policy.create',
        target: {
          type: 'policy',
          id: built[3].doc._id.toHexString(),
          name: built[3].doc.name,
        },
      },
      {
        action: 'principal.create',
        target: {
          type: 'principal',
          id: principalDocs[0]._id.toHexString(),
          name: principalDocs[0].name,
        },
      },
      {
        action: 'scenario.create',
        target: {
          type: 'scenario',
          id: scenarioDocs[0]._id.toHexString(),
          name: scenarioDocs[0].name,
        },
      },
    ].map((entry, offset) => ({
      _id: new ObjectId(),
      orgId,
      timestamp: new Date(createdAt.getTime() + offset * 60_000),
      actorUserId: owner.id,
      actorEmail: owner.email,
      actorType: 'user',
      action: entry.action,
      target: entry.target,
      before: null,
      after: { seeded: true },
      metadata: { seed: 'volume', organization: orgSpec.slug },
    }));
    await auditEvents.insertMany(auditDocs);
    summary.auditEvents += auditDocs.length;

    /* --- evaluation runs (first three orgs only) ------------------ */
    if (index < 3) {
      const results = blueprints.map((entry) => ({
        scenarioId: scenarioDocs[blueprints.indexOf(entry)]._id.toHexString(),
        scenarioName: entry.name,
        principalArn: entry.principalArn,
        action: entry.action,
        resourceArn: entry.resourceArn,
        expectedResult: entry.expectedResult,
        result: entry.result,
        passed: entry.expectedResult === entry.result,
        trace: traceFor(entry, ctx),
        reason: entry.reason,
      }));
      const summaryCounts = {
        total: results.length,
        passed: results.filter((result) => result.passed).length,
        failed: results.filter((result) => !result.passed).length,
      };

      const runDocs = [
        {
          label: 'Baseline after initial import',
          snapshotAt: new Date(createdAt.getTime() + 7_200_000),
          results,
        },
        {
          label: 'Re-check after policy review',
          snapshotAt: new Date(createdAt.getTime() + 86_400_000),
          results,
        },
      ].map((entry) => ({
        _id: new ObjectId(),
        orgId,
        label: entry.label,
        snapshotAt: entry.snapshotAt,
        triggeredBy: 'manual',
        triggeredByUserId: owner.id,
        causedByAuditEventId: null,
        results: entry.results,
        summary: summaryCounts,
        createdAt: entry.snapshotAt,
      }));

      await evaluationRuns.insertMany(runDocs);
      summary.evaluationRuns += runDocs.length;
    }

    console.log(
      `  + ${orgSpec.name} [${orgSpec.slug}] users=${people.length} policies=${built.length} ` +
        `resources=${resourceDocs.length} principals=${principalDocs.length} scenarios=${scenarioDocs.length}` +
        (index < 3 ? ' runs=2' : ''),
    );
  }

  console.log('\nSummary');
  console.log(`  organizations : ${summary.orgs}`);
  console.log(`  users         : ${summary.users}`);
  console.log(`  memberships   : ${summary.memberships}`);
  console.log(`  policies      : ${summary.policies}`);
  console.log(`  policy versions: ${summary.policyVersions}`);
  console.log(`  resources     : ${summary.resources}`);
  console.log(`  principals    : ${summary.principals}`);
  console.log(`  scenarios     : ${summary.scenarios}`);
  console.log(`  evaluation runs: ${summary.evaluationRuns}`);
  console.log(`  audit events  : ${summary.auditEvents}`);
  if (summary.skippedOrgs.length > 0) {
    console.log(`  skipped       : ${summary.skippedOrgs.join(', ')} (already present)`);
  }

  await identity.close();
  await data.close();
}

main().catch((error) => {
  console.error('\nSEED FAILED');
  console.error(error);
  process.exitCode = 1;
});

#!/usr/bin/env node
/**
 * Seeds the platform admin's own organization with the same demo volume the
 * multi-tenant seed gives every other org, so the lenses are populated on the
 * account the user actually signs in with.
 *
 * Resolves the org from the membership rather than trusting a hard-coded id, and
 * aborts if the account has no organization. Idempotent: if the org already has
 * policies it skips, because re-inserting would duplicate scenarios and runs
 * against a unique policy name index. Pass --force to replace its seeded content.
 *
 *   node scripts/seed-kenin.mjs
 *   node scripts/seed-kenin.mjs --force
 */
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import { MongoClient, ObjectId } from 'mongodb';

const HOST = 'cluster0.8zf7aek.mongodb.net';
const USER = 'aryankapoor0303_db_user';
const PASSWORD = 'Tbmi-741';
const uriFor = (db) =>
  `mongodb+srv://${USER}:${PASSWORD}@${HOST}/${db}?retryWrites=true&w=majority`;

const TARGET_EMAIL = 'keninjavelas@gmail.com';
const ACCOUNT_ID = '123456789012';
const FORCE = process.argv.includes('--force');
const NOW = new Date();

async function ensureSrvResolution() {
  try {
    await dnsPromises.resolveSrv(`_mongodb._tcp.${HOST}`);
  } catch (error) {
    console.log(`  ! SRV lookup failed (${error.code}); retrying via 1.1.1.1`);
    dns.setServers(['1.1.1.1', '8.8.8.8']);
  }
}

const bucket = 'kenin-org-data';
const logBucket = 'kenin-org-logs';

const POLICY_BLUEPRINTS = [
  {
    key: 'S3ReadOnly',
    statements: [
      {
        sid: 'ReadObjects',
        effect: 'Allow',
        actions: ['s3:GetObject', 's3:ListBucket'],
        resources: [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`],
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
        resources: [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`],
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
        resources: [`arn:aws:ec2:us-east-1:${ACCOUNT_ID}:instance/*`],
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

const principalArn = (type, name) => {
  if (type === 'Group') return `arn:aws:iam::${ACCOUNT_ID}:group/${name}`;
  if (type === 'Role') return `arn:aws:iam::${ACCOUNT_ID}:role/${name}`;
  return `arn:aws:iam::${ACCOUNT_ID}:user/${name}`;
};

async function main() {
  console.log('Kenin Org seed');
  await ensureSrvResolution();

  const identity = new MongoClient(uriFor('iamscope_identity'), {
    serverSelectionTimeoutMS: 20_000,
  });
  const data = new MongoClient(uriFor('iamscope_data'), { serverSelectionTimeoutMS: 20_000 });
  await identity.connect();
  await data.connect();

  const idb = identity.db();
  const ddb = data.db();

  /* --- resolve the account and its org ------------------------- */
  const user = await idb.collection('users').findOne({ email: TARGET_EMAIL });
  if (user === null) {
    console.error(`ABORT: no user with email ${TARGET_EMAIL}`);
    process.exitCode = 1;
    await identity.close();
    await data.close();
    return;
  }

  const membership = await idb.collection('memberships').findOne({ userId: user._id });
  if (membership === null) {
    console.error(`ABORT: ${TARGET_EMAIL} has no membership; nothing to seed`);
    process.exitCode = 1;
    await identity.close();
    await data.close();
    return;
  }

  const userId = user._id;
  const orgId = membership.orgId;
  const org = await idb.collection('orgs').findOne({ _id: orgId });

  console.log(
    JSON.stringify(
      { userId: userId.toHexString(), orgId: orgId.toHexString(), orgName: org?.name ?? null },
      null,
      2,
    ),
  );

  const policies = ddb.collection('policies');
  const existing = await policies.countDocuments({ orgId, deleted: { $ne: true } });
  if (existing > 0 && !FORCE) {
    console.log(`  org already has ${existing} policies - nothing to do (use --force to replace)`);
    await identity.close();
    await data.close();
    return;
  }

  if (existing > 0 && FORCE) {
    await Promise.all([
      policies.deleteMany({ orgId }),
      ddb.collection('policy_versions').deleteMany({ orgId }),
      ddb.collection('principals').deleteMany({ orgId }),
      ddb.collection('resources').deleteMany({ orgId }),
      ddb.collection('scenarios').deleteMany({ orgId }),
      ddb.collection('evaluation_runs').deleteMany({ orgId }),
      ddb.collection('audit_events').deleteMany({ orgId }),
    ]);
    console.log(`  removed ${existing} existing policies and dependent records (--force)`);
  }

  const createdAt = new Date(NOW.getTime() - 3_600_000);

  /* --- policies + versions ------------------------------------- */
  const built = POLICY_BLUEPRINTS.map((blueprint) => {
    const id = new ObjectId();
    return {
      doc: {
        _id: id,
        orgId,
        name: blueprint.key,
        arn: `arn:aws:iam::${ACCOUNT_ID}:policy/kenin-org/${blueprint.key}`,
        currentVersion: 1,
        statements: blueprint.statements,
        tags: { seeded: 'true' },
        deleted: false,
        createdBy: userId,
        updatedBy: userId,
        createdAt,
        updatedAt: createdAt,
      },
      version: {
        _id: new ObjectId(),
        orgId,
        policyId: id,
        version: 1,
        statements: blueprint.statements,
        changedBy: userId,
        changeReason: 'Initial version (admin org seed)',
        createdAt,
      },
    };
  });

  await policies.insertMany(built.map((entry) => entry.doc));
  await ddb.collection('policy_versions').insertMany(built.map((entry) => entry.version));
  const policyByName = new Map(built.map((entry) => [entry.doc.name, entry.doc]));

  /* --- resources ----------------------------------------------- */
  const resourceDocs = [
    { arn: `arn:aws:s3:::${bucket}`, type: 's3-bucket' },
    { arn: `arn:aws:s3:::${logBucket}`, type: 's3-bucket' },
    { arn: `arn:aws:ec2:us-east-1:${ACCOUNT_ID}:instance/i-0kenin01`, type: 'ec2-instance' },
    { arn: `arn:aws:iam::${ACCOUNT_ID}:role/AdminRole`, type: 'iam-role' },
  ].map((entry) => ({
    _id: new ObjectId(),
    orgId,
    arn: entry.arn,
    type: entry.type,
    tags: { seeded: 'true' },
    accountId: ACCOUNT_ID,
    deleted: false,
    createdAt,
    updatedAt: createdAt,
  }));
  await ddb.collection('resources').insertMany(resourceDocs);

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
    arn: principalArn(spec.type, spec.name),
    attachedPolicies: [policyByName.get(spec.policy)._id],
    groupMemberships: spec.type === 'User' ? [principalArn('Group', 'Admins')] : [],
    assumeRoleTargets: [],
    boundaryPolicyId: null,
    tags: { seeded: 'true' },
    deleted: false,
    createdBy: userId,
    updatedBy: userId,
    createdAt,
    updatedAt: createdAt,
  }));
  await ddb.collection('principals').insertMany(principalDocs);

  /* --- scenarios ----------------------------------------------- */
  const instanceArn = `arn:aws:ec2:us-east-1:${ACCOUNT_ID}:instance/i-0kenin01`;
  const bucketArn = `arn:aws:s3:::${bucket}`;

  const scenarioSpecs = [
    {
      name: 'Alice reads the data bucket',
      principalArn: principalArn('User', 'alice'),
      action: 's3:GetObject',
      resourceArn: bucketArn,
      expectedResult: 'Allow',
      result: 'Allow',
      reason: 'explicit-allow',
      policy: 'S3ReadOnly',
    },
    {
      name: 'Bob deletes an object',
      principalArn: principalArn('User', 'bob'),
      action: 's3:DeleteObject',
      resourceArn: bucketArn,
      expectedResult: 'Allow',
      result: 'Allow',
      reason: 'explicit-allow',
      policy: 'S3FullAccess',
    },
    {
      name: 'Alice terminates the instance',
      principalArn: principalArn('User', 'alice'),
      action: 'ec2:TerminateInstances',
      resourceArn: instanceArn,
      expectedResult: 'Deny',
      result: 'Deny',
      reason: 'implicit-deny',
      policy: null,
    },
  ];

  const scenarioDocs = scenarioSpecs.map((spec) => ({
    _id: new ObjectId(),
    orgId,
    name: spec.name,
    principalArn: spec.principalArn,
    action: spec.action,
    resourceArn: spec.resourceArn,
    expectedResult: spec.expectedResult,
    tags: ['seeded'],
    createdBy: userId,
    createdAt,
    updatedAt: createdAt,
    lastResult: spec.result,
    lastRunAt: new Date(createdAt.getTime() + 600_000),
  }));
  await ddb.collection('scenarios').insertMany(scenarioDocs);

  /* --- audit events -------------------------------------------- */
  const auditDocs = [
    { action: 'policy.create', target: built[0].doc },
    { action: 'policy.create', target: built[3].doc },
    { action: 'principal.create', target: principalDocs[0] },
    { action: 'scenario.create', target: scenarioDocs[0] },
  ].map((entry, offset) => ({
    _id: new ObjectId(),
    orgId,
    timestamp: new Date(createdAt.getTime() + offset * 60_000),
    actorUserId: userId,
    actorEmail: TARGET_EMAIL,
    actorType: 'user',
    action: entry.action,
    target: {
      type: entry.action.split('.')[0],
      id: entry.target._id.toHexString(),
      name: entry.target.name,
    },
    before: null,
    after: { seeded: true },
    metadata: { seed: 'admin-org' },
  }));
  await ddb.collection('audit_events').insertMany(auditDocs);

  /* --- evaluation runs ----------------------------------------- */
  const results = scenarioSpecs.map((spec, index) => ({
    scenarioId: scenarioDocs[index]._id.toHexString(),
    scenarioName: spec.name,
    principalArn: spec.principalArn,
    action: spec.action,
    resourceArn: spec.resourceArn,
    expectedResult: spec.expectedResult,
    result: spec.result,
    passed: spec.expectedResult === spec.result,
    reason: spec.reason,
    trace:
      spec.policy === null
        ? []
        : (() => {
            const policy = policyByName.get(spec.policy);
            const statement = policy.statements[0];
            return [
              {
                policyId: policy._id.toHexString(),
                policyName: policy.name,
                policyArn: policy.arn,
                sid: statement.sid,
                effect: statement.effect,
                matchedAction: spec.action,
                matchedResource: spec.resourceArn,
                matchedConditions: [],
                source: 'principal',
                sourceName: spec.principalArn.split('/').pop(),
              },
            ];
          })(),
  }));

  const counts = {
    total: results.length,
    passed: results.filter((entry) => entry.passed).length,
    failed: results.filter((entry) => !entry.passed).length,
  };

  const runDocs = [
    { label: 'Baseline after initial import', at: createdAt.getTime() + 600_000 },
    { label: 'Re-check after policy review', at: createdAt.getTime() + 86_400_000 },
  ].map((entry) => ({
    _id: new ObjectId(),
    orgId,
    label: entry.label,
    snapshotAt: new Date(entry.at),
    triggeredBy: 'manual',
    triggeredByUserId: userId,
    causedByAuditEventId: null,
    results,
    summary: counts,
    createdAt: new Date(entry.at),
  }));
  await ddb.collection('evaluation_runs').insertMany(runDocs);

  console.log(
    JSON.stringify(
      {
        policies: built.length,
        policyVersions: built.length,
        resources: resourceDocs.length,
        principals: principalDocs.length,
        scenarios: scenarioDocs.length,
        auditEvents: auditDocs.length,
        evaluationRuns: runDocs.length,
      },
      null,
      2,
    ),
  );

  await identity.close();
  await data.close();
}

main().catch((error) => {
  console.error('\nSEED FAILED');
  console.error(error);
  process.exitCode = 1;
});

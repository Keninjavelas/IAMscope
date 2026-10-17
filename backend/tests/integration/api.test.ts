/**
 * Focused integration coverage (Plan §21): auth, orgs, policies, evaluate - each with a happy
 * path, an RBAC failure, a validation failure and a tenant-isolation assertion.
 *
 * Skipped cleanly (exit code 0) when `mongodb-memory-server` cannot obtain a mongod binary.
 */
import type { Express } from 'express';
import { ObjectId } from 'mongodb';
import request, { type Response as SupertestResponse } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintEventToken } from '../../src/auth/eventTokens';
import { data } from '../../src/db/data';
import { identity } from '../../src/db/identity';
import { env } from '../../src/env';
import { createApp } from '../../src/index';
import { cancelPendingEvaluations } from '../../src/services/evaluationRunner';
import { ensureMembership } from '../../src/services/org';
import { connectTestDatabases, mongoAvailable, skipReason, stopTestMongo } from '../helpers/mongo';

const available = await mongoAvailable();

let ipCounter = 0;

/** Unique client IP per request so the per-IP rate limits never bleed between tests. */
function nextTestIp(): string {
  ipCounter += 1;
  return `10.1.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

/** `request.agent(app)` keeps the cookie jar; aliased so helpers can take it as a parameter. */
type TestAgent = ReturnType<typeof request.agent>;

function csrfFrom(response: SupertestResponse): string {
  const raw = response.headers['set-cookie'] as unknown;
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  for (const cookie of list) {
    const match = /iamscope_csrf=([^;]+)/.exec(cookie);
    if (match?.[1] !== undefined) return decodeURIComponent(match[1]);
  }
  return '';
}

describe.skipIf(!available)(`API integration (${available ? 'mongo ready' : skipReason()})`, () => {
  let app: Express;

  beforeAll(async () => {
    await connectTestDatabases();
    app = createApp();
  });

  afterAll(async () => {
    cancelPendingEvaluations();
    await stopTestMongo();
  });

  /* ---------------------------------------------------------------- */
  /* Auth                                                              */
  /* ---------------------------------------------------------------- */

  it('signs up, returns the session cookies and answers /auth/me', async () => {
    const agent = request.agent(app);

    const signup = await agent.post('/api/auth/signup').send({
      email: 'owner@acme.test',
      password: 'correct-horse-battery-9',
      name: 'Owner',
      orgName: 'Acme Test',
    });

    expect(signup.status).toBe(201);
    expect(signup.body.error).toBeUndefined();
    expect(signup.body.data.user.email).toBe('owner@acme.test');
    expect(signup.body.data.role).toBe('owner');
    expect(signup.body.data.activeOrg.name).toBe('Acme Test');
    expect(csrfFrom(signup)).not.toBe('');

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe('owner@acme.test');
    expect(me.body.data.permissions.canAdmin).toBe(true);
    expect(me.body.data.orgs).toHaveLength(1);
  });

  it('rejects a duplicate signup and invalid credentials', async () => {
    const first = await request(app).post('/api/auth/signup').send({
      email: 'dupe@acme.test',
      password: 'correct-horse-battery-9',
      name: 'Dupe',
      orgName: 'Dupe Org',
    });
    expect(first.status).toBe(201);

    const second = await request(app).post('/api/auth/signup').send({
      email: 'dupe@acme.test',
      password: 'correct-horse-battery-9',
      name: 'Dupe',
      orgName: 'Dupe Org',
    });
    expect(second.status).toBe(409);

    const badPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'dupe@acme.test', password: 'definitely-wrong-pass' });
    expect(badPassword.status).toBe(401);
    expect(badPassword.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a weak password through the shared schema', async () => {
    const weak = await request(app).post('/api/auth/signup').send({
      email: 'weak@acme.test',
      password: 'password1234',
      name: 'Weak',
      orgName: 'Weak Org',
    });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires authentication for protected routes', async () => {
    const anonymous = await request(app).get('/api/policies');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('enforces CSRF on mutations', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/signup').send({
      email: 'csrf@acme.test',
      password: 'correct-horse-battery-9',
      name: 'Csrf',
      orgName: 'Csrf Org',
    });

    const withoutToken = await agent.post('/api/policies').send({
      name: 'No-CSRF',
      statements: [
        { sid: 'A', effect: 'Allow', actions: ['s3:GetObject'], resources: ['*'], conditions: [] },
      ],
      changeReason: 'should fail',
    });
    expect(withoutToken.status).toBe(403);
    expect(withoutToken.body.error.code).toBe('CSRF_FAILED');
  });

  /* ---------------------------------------------------------------- */
  /* Orgs + RBAC                                                       */
  /* ---------------------------------------------------------------- */

  describe('orgs and RBAC', () => {
    // Agents must be created lazily: the suite body runs at collection time even when skipped,
    // and `request.agent(undefined)` throws.
    let owner: ReturnType<typeof request.agent>;
    let viewer: ReturnType<typeof request.agent>;
    let ownerCsrf = '';
    let viewerCsrf = '';
    let orgId = '';
    let viewerUserId = '';

    beforeAll(async () => {
      if (!available) return;

      owner = request.agent(app);
      viewer = request.agent(app);

      const ownerSignup = await owner
        .post('/api/auth/signup')
        // Each signup gets its own rate-limit bucket (3 per IP per hour, Plan §9.4) so the
        // suites do not starve each other.
        .set('X-Forwarded-For', nextTestIp())
        .send({
          email: 'org-owner@acme.test',
          password: 'correct-horse-battery-9',
          name: 'Org Owner',
          orgName: 'RBAC Org',
        });
      ownerCsrf = csrfFrom(ownerSignup);
      orgId = ownerSignup.body.data.activeOrg.id;

      const viewerSignup = await viewer
        .post('/api/auth/signup')
        // Each signup gets its own rate-limit bucket (3 per IP per hour, Plan §9.4) so the
        // suites do not starve each other.
        .set('X-Forwarded-For', nextTestIp())
        .send({
          email: 'org-viewer@acme.test',
          password: 'correct-horse-battery-9',
          name: 'Org Viewer',
          orgName: 'Viewer Org',
        });
      viewerCsrf = csrfFrom(viewerSignup);
      viewerUserId = viewerSignup.body.data.user.id;
    });

    it('lists the caller orgs', async () => {
      const list = await owner.get('/api/orgs');
      expect(list.status).toBe(200);
      expect(list.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('creates an org and adds the creator as owner', async () => {
      const created = await owner
        .post('/api/orgs')
        .set('X-CSRF-Token', ownerCsrf)
        .send({ name: 'Second Org' });

      expect(created.status).toBe(201);
      expect(created.body.data.role).toBe('owner');
      expect(created.body.data.slug).toBe('second-org');
    });

    it('lets an owner update the org but blocks a plain member', async () => {
      // The viewer agent is a member-level actor in *their own* org, not this one.
      const forbidden = await viewer
        .put(`/api/orgs/${orgId}`)
        .set('X-CSRF-Token', viewerCsrf)
        .send({ name: 'Hijacked' });

      expect(forbidden.status).toBe(403);
      expect(forbidden.body.error.code).toBe('FORBIDDEN');

      const allowed = await owner
        .put(`/api/orgs/${orgId}`)
        .set('X-CSRF-Token', ownerCsrf)
        .send({ name: 'RBAC Org Renamed' });

      expect(allowed.status).toBe(200);
      expect(allowed.body.data.name).toBe('RBAC Org Renamed');
    });

    it('refuses to invite without an email', async () => {
      const invalid = await owner
        .post(`/api/orgs/${orgId}/invitations`)
        .set('X-CSRF-Token', ownerCsrf)
        .send({ role: 'viewer' });

      expect(invalid.status).toBe(400);
      expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(invalid.body.error.details)).toBe(true);
    });

    it('rejects a member-id that is not in the org', async () => {
      const response = await owner
        .put(`/api/orgs/${orgId}/members/${viewerUserId}`)
        .set('X-CSRF-Token', ownerCsrf)
        .send({ role: 'admin' });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('refuses to remove the last owner', async () => {
      const me = await owner.get('/api/auth/me');
      const ownerId = me.body.data.user.id;

      const response = await owner
        .delete(`/api/orgs/${orgId}/members/${ownerId}`)
        .set('X-CSRF-Token', ownerCsrf);

      expect(response.status).toBe(409);
    });

    it('rejects orgId smuggled through the body on a domain route', async () => {
      const response = await owner
        .post('/api/policies')
        .set('X-CSRF-Token', ownerCsrf)
        .send({
          name: 'Smuggled',
          orgId: '000000000000000000000000',
          statements: [
            {
              sid: 'A',
              effect: 'Allow',
              actions: ['s3:GetObject'],
              resources: ['*'],
              conditions: [],
            },
          ],
          changeReason: 'attempted tenant override',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('BAD_REQUEST');
    });

    it('enforces member, admin, and owner delete boundaries', async () => {
      const policy = await owner
        .post('/api/policies')
        .set('X-CSRF-Token', ownerCsrf)
        .send({
          name: 'RBAC delete boundary',
          statements: [
            {
              sid: 'Read',
              effect: 'Allow',
              actions: ['s3:GetObject'],
              resources: ['*'],
              conditions: [],
            },
          ],
          changeReason: 'verify role delete boundaries',
        });
      expect(policy.status).toBe(201);

      await ensureMembership(new ObjectId(orgId), new ObjectId(viewerUserId), 'member');
      const memberSwitch = await viewer
        .post('/api/auth/switch-org')
        .set('X-CSRF-Token', viewerCsrf)
        .send({ orgId });
      expect(memberSwitch.status).toBe(200);
      const memberCsrf = csrfFrom(memberSwitch) || viewerCsrf;

      const memberDelete = await viewer
        .delete(`/api/policies/${policy.body.data.id}`)
        .set('X-CSRF-Token', memberCsrf);
      expect(memberDelete.status).toBe(403);
      expect(memberDelete.body.error.code).toBe('FORBIDDEN');

      const admin = request.agent(app);
      const adminSignup = await admin
        .post('/api/auth/signup')
        .set('X-Forwarded-For', nextTestIp())
        .send({
          email: 'org-admin@acme.test',
          password: 'correct-horse-battery-9',
          name: 'Org Admin',
          orgName: 'Admin Home Org',
        });
      expect(adminSignup.status).toBe(201);
      const adminCsrf = csrfFrom(adminSignup);
      await ensureMembership(
        new ObjectId(orgId),
        new ObjectId(adminSignup.body.data.user.id as string),
        'admin',
      );
      const adminSwitch = await admin
        .post('/api/auth/switch-org')
        .set('X-CSRF-Token', adminCsrf)
        .send({ orgId });
      expect(adminSwitch.status).toBe(200);

      const adminDelete = await admin
        .delete(`/api/orgs/${orgId}`)
        .set('X-CSRF-Token', csrfFrom(adminSwitch) || adminCsrf);
      expect(adminDelete.status).toBe(403);
      expect(adminDelete.body.error.code).toBe('FORBIDDEN');

      const throwaway = await owner
        .post('/api/orgs')
        .set('X-CSRF-Token', ownerCsrf)
        .send({ name: 'Owner Delete Test Org' });
      expect(throwaway.status).toBe(201);
      const ownerDelete = await owner
        .delete(`/api/orgs/${throwaway.body.data.id}`)
        .set('X-CSRF-Token', ownerCsrf);
      expect(ownerDelete.status).toBe(200);
      expect(ownerDelete.body.data.success).toBe(true);
    });
  });

  /* ---------------------------------------------------------------- */
  /* Policies + tenant isolation                                       */
  /* ---------------------------------------------------------------- */

  describe('policies, versions and tenant isolation', () => {
    let agentA: ReturnType<typeof request.agent>;
    let agentB: ReturnType<typeof request.agent>;
    let csrfA = '';
    let csrfB = '';
    let policyId = '';

    beforeAll(async () => {
      if (!available) return;

      agentA = request.agent(app);
      agentB = request.agent(app);

      const a = await agentA
        .post('/api/auth/signup')
        // Each signup gets its own rate-limit bucket (3 per IP per hour, Plan §9.4) so the
        // suites do not starve each other.
        .set('X-Forwarded-For', nextTestIp())
        .send({
          email: 'tenant-a@acme.test',
          password: 'correct-horse-battery-9',
          name: 'Tenant A',
          orgName: 'Tenant A Org',
        });
      csrfA = csrfFrom(a);

      const b = await agentB
        .post('/api/auth/signup')
        // Each signup gets its own rate-limit bucket (3 per IP per hour, Plan §9.4) so the
        // suites do not starve each other.
        .set('X-Forwarded-For', nextTestIp())
        .send({
          email: 'tenant-b@acme.test',
          password: 'correct-horse-battery-9',
          name: 'Tenant B',
          orgName: 'Tenant B Org',
        });
      csrfB = csrfFrom(b);
    });

    it('creates a policy with a version and an audit event', async () => {
      const created = await agentA
        .post('/api/policies')
        .set('X-CSRF-Token', csrfA)
        .send({
          name: 'Tenant-A-Policy',
          statements: [
            {
              sid: 'AllowGet',
              effect: 'Allow',
              actions: ['s3:GetObject'],
              resources: ['arn:aws:s3:::bucket/*'],
              conditions: [],
            },
          ],
          tags: { team: 'platform' },
          changeReason: 'initial version for the integration test',
        });

      expect(created.status).toBe(201);
      expect(created.body.data.currentVersion).toBe(1);
      expect(created.body.data.arn).toContain(':policy/Tenant-A-Policy');
      policyId = created.body.data.id;

      const versions = await agentA.get(`/api/policies/${policyId}/versions`);
      expect(versions.status).toBe(200);
      expect(versions.body.data).toHaveLength(1);
      expect(versions.body.data[0].version).toBe(1);

      const audit = await agentA.get('/api/audit').query({ targetId: policyId });
      expect(audit.status).toBe(200);
      expect(
        audit.body.data.items.some((event: { action: string }) => event.action === 'policy.create'),
      ).toBe(true);
    });

    it('blocks a duplicate policy name', async () => {
      const duplicate = await agentA
        .post('/api/policies')
        .set('X-CSRF-Token', csrfA)
        .send({
          name: 'Tenant-A-Policy',
          statements: [
            {
              sid: 'X',
              effect: 'Allow',
              actions: ['s3:GetObject'],
              resources: ['*'],
              conditions: [],
            },
          ],
          changeReason: 'duplicate attempt',
        });

      expect(duplicate.status).toBe(409);
    });

    it('rejects a policy with no statements', async () => {
      const invalid = await agentA
        .post('/api/policies')
        .set('X-CSRF-Token', csrfA)
        .send({ name: 'Empty', statements: [], changeReason: 'no statements' });

      expect(invalid.status).toBe(400);
      expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects duplicate Sids inside one policy', async () => {
      const invalid = await agentA
        .post('/api/policies')
        .set('X-CSRF-Token', csrfA)
        .send({
          name: 'Duplicate-Sids',
          statements: [
            {
              sid: 'Same',
              effect: 'Allow',
              actions: ['s3:GetObject'],
              resources: ['*'],
              conditions: [],
            },
            {
              sid: 'Same',
              effect: 'Deny',
              actions: ['s3:PutObject'],
              resources: ['*'],
              conditions: [],
            },
          ],
          changeReason: 'duplicate sids',
        });

      expect(invalid.status).toBe(400);
    });

    it('bumps the version on update and restores an older version', async () => {
      const updated = await agentA
        .put(`/api/policies/${policyId}`)
        .set('X-CSRF-Token', csrfA)
        .send({
          statements: [
            { sid: 'DenyAll', effect: 'Deny', actions: ['s3:*'], resources: ['*'], conditions: [] },
          ],
          changeReason: 'tighten the policy for the integration test',
        });

      expect(updated.status).toBe(200);
      expect(updated.body.data.currentVersion).toBe(2);

      const restored = await agentA
        .post(`/api/policies/${policyId}/restore`)
        .set('X-CSRF-Token', csrfA)
        .send({ version: 1, changeReason: 'roll back' });

      expect(restored.status).toBe(200);
      expect(restored.body.data.restoredFrom).toBe(1);
      expect(restored.body.data.currentVersion).toBe(3);

      const versions = await agentA.get(`/api/policies/${policyId}/versions`);
      expect(versions.body.data).toHaveLength(3);
    });

    it('hides tenant A data from tenant B (tenant isolation)', async () => {
      const read = await agentB.get(`/api/policies/${policyId}`);
      expect(read.status).toBe(404);
      expect(read.body.error.code).toBe('NOT_FOUND');

      const list = await agentB.get('/api/policies');
      expect(list.status).toBe(200);
      expect(list.body.data.items).toHaveLength(0);

      const update = await agentB
        .put(`/api/policies/${policyId}`)
        .set('X-CSRF-Token', csrfB)
        .send({
          statements: [
            { sid: 'Hijack', effect: 'Allow', actions: ['*'], resources: ['*'], conditions: [] },
          ],
          changeReason: 'cross tenant write attempt',
        });
      expect(update.status).toBe(404);

      const remove = await agentB.delete(`/api/policies/${policyId}`).set('X-CSRF-Token', csrfB);
      expect(remove.status).toBe(404);
    });

    it('soft deletes and restores a policy', async () => {
      const deleted = await agentA.delete(`/api/policies/${policyId}`).set('X-CSRF-Token', csrfA);
      expect(deleted.status).toBe(200);

      const visible = await agentA.get('/api/policies');
      expect(visible.body.data.items.some((policy: { id: string }) => policy.id === policyId)).toBe(
        false,
      );

      const withDeleted = await agentA.get('/api/policies').query({ includeDeleted: true });
      expect(
        withDeleted.body.data.items.some((policy: { id: string }) => policy.id === policyId),
      ).toBe(true);
    });
  });

  /* ---------------------------------------------------------------- */
  /* Evaluate                                                          */
  /* ---------------------------------------------------------------- */

  describe('evaluate and the impact lens', () => {
    let agent: ReturnType<typeof request.agent>;
    let csrf = '';
    let principalId = '';
    let policyId = '';

    const principalArn = 'arn:aws:iam::123456789012:user/integration-user';
    const bucketArn = 'arn:aws:s3:::integration-bucket';
    const objectArn = 'arn:aws:s3:::integration-bucket/reports/q1.csv';

    beforeAll(async () => {
      if (!available) return;

      agent = request.agent(app);

      const signup = await agent
        .post('/api/auth/signup')
        // Each signup gets its own rate-limit bucket (3 per IP per hour, Plan §9.4) so the
        // suites do not starve each other.
        .set('X-Forwarded-For', nextTestIp())
        .send({
          email: 'eval@acme.test',
          password: 'correct-horse-battery-9',
          name: 'Eval',
          orgName: 'Eval Org',
        });
      csrf = csrfFrom(signup);

      const principal = await agent
        .post('/api/principals')
        .set('X-CSRF-Token', csrf)
        .send({
          type: 'User',
          name: 'integration-user',
          arn: principalArn,
          tags: { team: 'platform' },
        });
      expect(principal.status).toBe(201);
      principalId = principal.body.data.id;

      const policy = await agent
        .post('/api/policies')
        .set('X-CSRF-Token', csrf)
        .send({
          name: 'Integration-S3',
          statements: [
            {
              sid: 'AllowReports',
              effect: 'Allow',
              actions: ['s3:GetObject'],
              resources: [objectArn],
              conditions: [],
            },
            {
              sid: 'DenySecrets',
              effect: 'Deny',
              actions: ['s3:GetObject'],
              resources: [`${bucketArn}/secrets/*`],
              conditions: [],
            },
          ],
          changeReason: 'baseline for the evaluate tests',
        });
      expect(policy.status).toBe(201);
      policyId = policy.body.data.id;

      const attach = await agent
        .post(`/api/principals/${principalId}/policies/${policy.body.data.id}`)
        .set('X-CSRF-Token', csrf);
      expect(attach.status).toBe(200);
    });

    it('allows an action granted by an attached policy and traces the statement', async () => {
      const response = await agent
        .post('/api/evaluate')
        .set('X-CSRF-Token', csrf)
        .send({ principalArn, action: 's3:GetObject', resourceArn: objectArn, persist: false });

      expect(response.status).toBe(200);
      expect(response.body.data.result).toBe('Allow');
      expect(response.body.data.reason).toBe('explicit-allow');
      expect(response.body.data.trace[0].sid).toBe('AllowReports');
      expect(response.body.data.run).toBeNull();
    });

    it('denies on an explicit Deny', async () => {
      const response = await agent
        .post('/api/evaluate')
        .set('X-CSRF-Token', csrf)
        .send({
          principalArn,
          action: 's3:GetObject',
          resourceArn: `${bucketArn}/secrets/rotation.json`,
          persist: false,
        });

      expect(response.status).toBe(200);
      expect(response.body.data.result).toBe('Deny');
      expect(response.body.data.reason).toBe('explicit-deny');
    });

    it('denies implicitly for an unmatched action and for an unknown principal', async () => {
      const unmatched = await agent
        .post('/api/evaluate')
        .set('X-CSRF-Token', csrf)
        .send({ principalArn, action: 's3:DeleteObject', resourceArn: objectArn, persist: false });
      expect(unmatched.body.data.reason).toBe('implicit-deny');

      const unknown = await agent.post('/api/evaluate').set('X-CSRF-Token', csrf).send({
        principalArn: 'arn:aws:iam::123456789012:user/ghost',
        action: 's3:GetObject',
        resourceArn: objectArn,
        persist: false,
      });
      expect(unknown.body.data.result).toBe('Deny');
      expect(unknown.body.data.reason).toBe('no-policy');
    });

    it('rejects a malformed principal ARN', async () => {
      const invalid = await agent.post('/api/evaluate').set('X-CSRF-Token', csrf).send({
        principalArn: 'not-an-arn',
        action: 's3:GetObject',
        resourceArn: objectArn,
        persist: false,
      });

      expect(invalid.status).toBe(400);
      expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('runs a persisted evaluation, lists runs and diffs the two most recent', async () => {
      const first = await agent
        .post('/api/evaluate')
        .set('X-CSRF-Token', csrf)
        .send({ principalArn, action: 's3:GetObject', resourceArn: objectArn, label: 'run one' });
      expect(first.status).toBe(200);
      expect(first.body.data.run.summary.total).toBeGreaterThanOrEqual(0);

      const second = await agent
        .post('/api/evaluate')
        .set('X-CSRF-Token', csrf)
        .send({ principalArn, action: 's3:GetObject', resourceArn: objectArn, label: 'run two' });
      expect(second.status).toBe(200);

      const list = await agent.get('/api/evaluations');
      expect(list.status).toBe(200);
      expect(list.body.data.total).toBeGreaterThanOrEqual(2);

      const diff = await agent.get('/api/evaluations/diff');
      expect(diff.status).toBe(200);
      expect(diff.body.data.after).not.toBeNull();
      expect(typeof diff.body.data.counts.total).toBe('number');
    });

    it('exposes an empty impact diff before any scenarios exist', async () => {
      const diff = await agent.get('/api/evaluations/diff');
      expect(diff.status).toBe(200);
      expect(diff.body.data.counts.total).toBe(0);
    });

    it('attributes a changed verdict to the exact policy edit audit event', async () => {
      const scenario = await agent.post('/api/scenarios').set('X-CSRF-Token', csrf).send({
        name: 'Attribution reports access',
        principalArn,
        action: 's3:GetObject',
        resourceArn: objectArn,
        expectedResult: 'Allow',
      });
      expect(scenario.status).toBe(201);

      const before = await agent
        .post('/api/evaluate')
        .set('X-CSRF-Token', csrf)
        .send({ principalArn, action: 's3:GetObject', resourceArn: objectArn });
      expect(before.status).toBe(200);
      expect(before.body.data.result).toBe('Allow');
      const beforeRunId = before.body.data.run.id as string;

      // Audit attribution uses an exclusive lower timestamp bound, so separate the
      // first run from the edit even on clocks with millisecond precision.
      await new Promise((resolve) => setTimeout(resolve, 10));
      const edit = await agent
        .put(`/api/policies/${policyId}`)
        .set('X-CSRF-Token', csrf)
        .send({
          statements: [
            {
              sid: 'DenyReports',
              effect: 'Deny',
              actions: ['s3:GetObject'],
              resources: [objectArn],
              conditions: [],
            },
          ],
          changeReason: 'verify exact audit attribution',
        });
      expect(edit.status).toBe(200);

      const after = await agent
        .post('/api/evaluate')
        .set('X-CSRF-Token', csrf)
        .send({ principalArn, action: 's3:GetObject', resourceArn: objectArn });
      expect(after.status).toBe(200);
      expect(after.body.data.result).toBe('Deny');

      const audit = await agent.get('/api/audit').query({
        targetType: 'policy',
        targetId: policyId,
        action: 'policy.update',
      });
      expect(audit.status).toBe(200);
      const editEvent = audit.body.data.items.find(
        (event: { action: string; target: { id: string } }) =>
          event.action === 'policy.update' && event.target.id === policyId,
      );
      expect(editEvent).toBeDefined();

      const attribution = await agent.get('/api/audit/attribution').query({
        scenarioId: scenario.body.data.id,
        before: beforeRunId,
        after: after.body.data.run.id,
      });
      expect(attribution.status).toBe(200);
      expect(attribution.body.data.resultBefore).toBe('Allow');
      expect(attribution.body.data.resultAfter).toBe('Deny');
      expect(attribution.body.data.causes[0].auditEventId).toBe(editEvent.id);
    });

    it('serves the health endpoint without credentials', async () => {
      const health = await request(app).get('/api/health');
      expect([200, 503]).toContain(health.status);
      expect(health.body.data.database.identity).toBe('up');
      expect(health.body.data.database.data).toBe('up');
      expect(health.body.data.watchers.watchedCollections.length).toBe(8);
    });

    it('returns NOT_FOUND for an unknown route', async () => {
      const missing = await request(app).get('/api/does-not-exist');
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('NOT_FOUND');
      expect(typeof missing.body.error.requestId).toBe('string');
    });
  });

  /* ---------------------------------------------------------------- */
  /* SSE event tokens (Fallback B, DECISIONS D21-D24)                  */
  /* ---------------------------------------------------------------- */

  describe('SSE event tokens', () => {
    /** Signs up a fresh org owner; returns its agent plus the CSRF token for unsafe methods. */
    async function signupAgent(email: string): Promise<{ agent: TestAgent; csrf: string }> {
      const agent = request.agent(app);
      const signup = await agent
        .post('/api/auth/signup')
        .set('X-Forwarded-For', nextTestIp())
        .send({ email, password: 'correct-horse-battery-9', name: 'Sse', orgName: 'Sse Org' });
      expect(signup.status).toBe(201);
      return { agent, csrf: csrfFrom(signup) };
    }

    /**
     * Session and org ids are read out of the token's own payload rather than by querying the
     * database: the payload is base64url JSON, so this needs no privileged lookup and cannot
     * accidentally pick up a session left behind by an earlier test.
     */
    function tokenPayload(token: string): { sessionId: string; orgId: string } {
      const encoded = token.split('.')[0] ?? '';
      return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
        sessionId: string;
        orgId: string;
      };
    }

    async function mint(agent: TestAgent, csrf: string): Promise<string> {
      const minted = await agent.post('/api/events/token').set('X-CSRF-Token', csrf);
      expect(minted.status).toBe(200);
      return minted.body.data.token as string;
    }

    /**
     * Opens a stream and resolves with its status, content type and first chunk.
     *
     * An SSE response never ends, so a plain supertest request hangs the suite. This buffers
     * no body and destroys the socket on the first `data` event; the timeout is a safety net
     * so a regression fails a single test rather than wedging the whole run.
     */
    function readFirstChunk(
      build: () => request.Test,
    ): Promise<{ status: number; contentType: string; first: string }> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('SSE stream produced no data within 5s'));
        }, 5_000);

        build()
          .buffer(false)
          .parse((res, _callback) => {
            res.once('data', (chunk: Buffer) => {
              clearTimeout(timer);
              // `parse(fn)` receives the raw `IncomingMessage`, not a superagent Response, so
              // the status lives on `statusCode`.
              const status = res.statusCode;
              const contentType = res.headers['content-type'] ?? '';
              res.destroy();
              resolve({ status, contentType, first: chunk.toString('utf8') });
            });
          })
          .end(() => {
            /* completion is driven by the first chunk, not by the response ending */
          });
      });
    }

    it('refuses a client with no session, and never reaches auth without CSRF', async () => {
      // A CSRF pair but no session: CSRF runs before the router, so this is the only way to
      // exercise the 401 branch. Skipping the cookie would be rejected 403 CSRF_FAILED first.
      const anonymous = request.agent(app);
      const boot = await anonymous.get('/api/auth/csrf');
      expect(boot.status).toBe(200);

      const noSession = await anonymous
        .post('/api/events/token')
        .set('X-CSRF-Token', csrfFrom(boot));
      expect(noSession.status).toBe(401);
      expect(noSession.body.error.code).toBe('UNAUTHENTICATED');

      const bare = await request(app)
        .post('/api/events/token')
        .set('X-Forwarded-For', nextTestIp());
      expect(bare.status).toBe(403);
      expect(bare.body.error.code).toBe('CSRF_FAILED');
    });

    it('returns an envelope with a two-part base64url token and an ISO expiry', async () => {
      const { agent, csrf } = await signupAgent('sse-mint@acme.test');
      const minted = await agent.post('/api/events/token').set('X-CSRF-Token', csrf);

      expect(minted.status).toBe(200);
      expect(minted.body.error).toBeUndefined();
      expect(minted.body.data.token).toBeTypeOf('string');
      expect(minted.body.data.token.split('.')).toHaveLength(2);
      expect(minted.body.data.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('rejects the mint for a session with no active org', async () => {
      const { agent, csrf } = await signupAgent('sse-noorg@acme.test');
      const token = await mint(agent, csrf);
      const { sessionId } = tokenPayload(token);

      await identity
        .sessions()
        .updateOne({ _id: new ObjectId(sessionId) }, { $set: { activeOrgId: null } });

      const denied = await agent.post('/api/events/token').set('X-CSRF-Token', csrf);
      // requireOrg throws forbidden() for a null orgId - 403, not 401.
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe('FORBIDDEN');
    });

    it('opens a stream with a valid token, and with the session cookie', async () => {
      const { agent, csrf } = await signupAgent('sse-stream@acme.test');
      const token = await mint(agent, csrf);

      const viaToken = await readFirstChunk(() =>
        request(app).get(`/api/events?token=${encodeURIComponent(token)}`),
      );
      expect(viaToken.status).toBe(200);
      expect(viaToken.contentType).toMatch(/text\/event-stream/);
      // The first frame on the wire is the SSE `retry:` directive, not `hello`, so assert
      // valid SSE framing rather than a specific event name.
      expect(viaToken.first).toMatch(/^(retry:|event: hello|: heartbeat|data:)/m);

      // The cookie path is unchanged and needs no token.
      const viaCookie = await readFirstChunk(() => agent.get('/api/events'));
      expect(viaCookie.status).toBe(200);
      expect(viaCookie.contentType).toMatch(/text\/event-stream/);
    });

    it('rejects a token that is not even well-formed', async () => {
      const rejected = await request(app).get('/api/events?token=garbage');
      expect(rejected.status).toBe(401);
      expect(rejected.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects a validly-signed token whose session id is not an ObjectId', async () => {
      // The only case that reaches `isObjectId`: 'garbage' has no '.', so split() rejects it
      // before the guard is ever consulted. A 500 here would be a free unauthenticated
      // error amplifier, so 401-vs-500 is the assertion that matters.
      const malformed = mintEventToken({
        userId: 'not-an-objectid',
        orgId: 'not-an-objectid',
        sessionId: 'not-an-objectid',
        expiresInSeconds: 60,
      }).token;

      const rejected = await request(app).get(`/api/events?token=${encodeURIComponent(malformed)}`);
      expect(rejected.status).toBe(401);
      expect(rejected.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects a token whose session was revoked between mint and connect', async () => {
      const { agent, csrf } = await signupAgent('sse-revoked@acme.test');
      const token = await mint(agent, csrf);
      const { sessionId } = tokenPayload(token);

      await identity
        .sessions()
        .updateOne({ _id: new ObjectId(sessionId) }, { $set: { revokedAt: new Date() } });

      // A token is not a session bypass: liveness comes from the session document.
      const rejected = await request(app).get(`/api/events?token=${encodeURIComponent(token)}`);
      expect(rejected.status).toBe(401);
      expect(rejected.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects a token whose session document no longer exists', async () => {
      const { agent, csrf } = await signupAgent('sse-gone@acme.test');
      const token = await mint(agent, csrf);
      const { sessionId } = tokenPayload(token);

      await identity.sessions().deleteOne({ _id: new ObjectId(sessionId) });

      const rejected = await request(app).get(`/api/events?token=${encodeURIComponent(token)}`);
      expect(rejected.status).toBe(401);
    });

    it('scopes both transports to the same org, and revocation closes both', async () => {
      const { agent, csrf } = await signupAgent('sse-parity@acme.test');
      const me = await agent.get('/api/auth/me');
      expect(me.status).toBe(200);

      const token = await mint(agent, csrf);
      // Parity: the token carries the same org the cookie session is scoped to.
      expect(tokenPayload(token).orgId).toBe(me.body.data.activeOrg.id);

      await identity
        .sessions()
        .updateOne(
          { _id: new ObjectId(tokenPayload(token).sessionId) },
          { $set: { revokedAt: new Date() } },
        );

      // Neither transport may be more permissive than the other.
      const cookieStream = await agent.get('/api/events');
      expect(cookieStream.status).toBe(401);
      const tokenStream = await request(app).get(`/api/events?token=${encodeURIComponent(token)}`);
      expect(tokenStream.status).toBe(401);
    });
  });

  /* ---------------------------------------------------------------- */
  /* Platform admin (allowlist gate, safety guards, audit)             */
  /* ---------------------------------------------------------------- */

  describe('platform admin', () => {
    const ADMIN_EMAIL = 'platform-admin@acme.test';

    let admin: TestAgent;
    let adminId: string;
    let adminOrgId: string;
    let adminCsrf: string;

    /** Signs up a fresh user (each signup is an owner of its own org). */
    async function makeUser(email: string): Promise<{
      agent: TestAgent;
      id: string;
      orgId: string;
      csrf: string;
    }> {
      const agent = request.agent(app);
      const created = await agent
        .post('/api/auth/signup')
        .set('X-Forwarded-For', nextTestIp())
        .send({
          email,
          password: 'correct-horse-battery-9',
          name: email.split('@')[0] ?? 'user',
          orgName: `${email} Org`,
        });
      expect(created.status).toBe(201);
      return {
        agent,
        id: created.body.data.user.id as string,
        orgId: created.body.data.activeOrg.id as string,
        csrf: csrfFrom(created),
      };
    }

    beforeAll(async () => {
      // The allowlist is parsed once at import time from the environment, which has no
      // value in CI. Mutating the parsed array is the seam that makes the gate testable
      // without relaunching the process.
      if (!env.PLATFORM_ADMIN_EMAILS.includes(ADMIN_EMAIL)) {
        env.PLATFORM_ADMIN_EMAILS.push(ADMIN_EMAIL);
      }

      const created = await makeUser(ADMIN_EMAIL);
      admin = created.agent;
      adminId = created.id;
      adminOrgId = created.orgId;
      adminCsrf = created.csrf;

      // The signup response must advertise the grant, or the sidebar entry can never show.
      const me = await admin.get('/api/auth/me');
      expect(me.body.data.user.isPlatformAdmin).toBe(true);
    });

    /* T1 ----------------------------------------------------------- */

    it('T1: refuses non-admins with 403, and fails closed when the allowlist is empty', async () => {
      const outsider = await makeUser('plain-user@acme.test');

      const denied = await outsider.agent.get('/api/admin/users');
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe('FORBIDDEN');

      // Fail-closed: removing every entry must forbid even an otherwise-valid session.
      const configured = [...env.PLATFORM_ADMIN_EMAILS];
      try {
        env.PLATFORM_ADMIN_EMAILS.length = 0;
        const closed = await admin.get('/api/admin/users');
        expect(closed.status).toBe(403);
        expect(closed.body.error.code).toBe('FORBIDDEN');
      } finally {
        env.PLATFORM_ADMIN_EMAILS.push(...configured);
      }

      // Restored allowlist still works.
      const reopened = await admin.get('/api/admin/users');
      expect(reopened.status).toBe(200);
    });

    /* T2 ----------------------------------------------------------- */

    it('T2: returns a paginated list across organizations for an admin', async () => {
      const response = await admin.get('/api/admin/users');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.data.items)).toBe(true);
      expect(typeof response.body.data.total).toBe('number');
      expect(response.body.data.total).toBeGreaterThanOrEqual(1);
      expect(response.body.data.page).toBe(1);
      expect(response.body.data.pageSize).toBe(50);

      // Cross-org: the admin's own org plus the users created by other tests.
      const emails = response.body.data.items.map((item: { email: string }) => item.email);
      expect(emails).toContain(ADMIN_EMAIL);
    });

    /* T3 ----------------------------------------------------------- */

    it('T3: refuses self-suspend and leaves the account active', async () => {
      const response = await admin
        .patch(`/api/admin/users/${adminId}/status`)
        .set('X-CSRF-Token', adminCsrf)
        .send({ status: 'suspended' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('BAD_REQUEST');

      const stored = await identity.users().findOne({ _id: new ObjectId(adminId) });
      expect(stored?.status).toBe('active');
    });

    /* T4 ----------------------------------------------------------- */

    it('T4: refuses self-delete and leaves the account undeleted', async () => {
      const response = await admin
        .delete(`/api/admin/users/${adminId}`)
        .set('X-CSRF-Token', adminCsrf);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('BAD_REQUEST');

      const stored = await identity.users().findOne({ _id: new ObjectId(adminId) });
      expect(stored?.status).toBe('active');
      expect(stored?.deletedAt ?? null).toBeNull();
    });

    /* T5 ----------------------------------------------------------- */

    it('T5: suspending a user revokes their sessions and invalidates the old cookie', async () => {
      const target = await makeUser('revoked-target@acme.test');

      const live = await identity
        .sessions()
        .countDocuments({ userId: new ObjectId(target.id), revokedAt: null });
      expect(live).toBeGreaterThanOrEqual(1);

      const suspended = await admin
        .patch(`/api/admin/users/${target.id}/status`)
        .set('X-CSRF-Token', adminCsrf)
        .send({ status: 'suspended' });
      expect(suspended.status).toBe(200);
      expect(suspended.body.data.status).toBe('suspended');

      const stillLive = await identity
        .sessions()
        .countDocuments({ userId: new ObjectId(target.id), revokedAt: null });
      expect(stillLive).toBe(0);

      // The revoked cookie must stop working immediately, not at next expiry.
      const afterRevoke = await target.agent.get('/api/policies');
      expect(afterRevoke.status).toBe(401);
    });

    /* T6 ----------------------------------------------------------- */

    it('T6: every admin mutation writes an audit event scoped to the actor org', async () => {
      const target = await makeUser('audited-target@acme.test');

      const suspend = await admin
        .patch(`/api/admin/users/${target.id}/status`)
        .set('X-CSRF-Token', adminCsrf)
        .send({ status: 'suspended' });
      expect(suspend.status).toBe(200);

      const unsuspend = await admin
        .patch(`/api/admin/users/${target.id}/status`)
        .set('X-CSRF-Token', adminCsrf)
        .send({ status: 'active' });
      expect(unsuspend.status).toBe(200);

      const removed = await admin
        .delete(`/api/admin/users/${target.id}`)
        .set('X-CSRF-Token', adminCsrf);
      expect(removed.status).toBe(200);

      const events = await data
        .auditEvents()
        .find({ 'target.id': target.id })
        .sort({ timestamp: 1 })
        .toArray();

      expect(events.map((event) => event.action)).toEqual([
        'user.status.change',
        'user.status.change',
        'user.delete',
      ]);

      for (const event of events) {
        expect(event.target.type).toBe('user');
        // Audit is tenant-scoped: the write belongs to the ACTOR's org, not the target's.
        expect(event.orgId.toHexString()).toBe(adminOrgId);
        expect(event.actorUserId?.toHexString()).toBe(adminId);
      }

      expect(events[0]?.before).toMatchObject({ status: 'active' });
      expect(events[0]?.after).toMatchObject({ status: 'suspended' });
      expect(events[1]?.before).toMatchObject({ status: 'suspended' });
      expect(events[1]?.after).toMatchObject({ status: 'active' });
      expect(events[2]?.after).toMatchObject({ status: 'deleted' });
    });

    /* T7 ----------------------------------------------------------- */

    it('T7: never returns credential or token fields', async () => {
      const response = await admin.get('/api/admin/users?pageSize=200');
      expect(response.status).toBe(200);
      expect(response.body.data.items.length).toBeGreaterThanOrEqual(1);

      const forbiddenKeys = [
        'passwordHash',
        'mfaSecret',
        'emailVerificationToken',
        'passwordResetTokenHash',
        'passwordResetExpiresAt',
        'oauthProviders',
      ];

      for (const item of response.body.data.items as Record<string, unknown>[]) {
        for (const key of forbiddenKeys) {
          expect(Object.prototype.hasOwnProperty.call(item, key), `leaked ${key}`).toBe(false);
        }
        // `id` rather than `_id`: deliberate deviation, matching every other endpoint.
        expect(typeof item.id).toBe('string');
        expect(typeof item.email).toBe('string');
        expect(typeof item.name).toBe('string');
        expect(typeof item.status).toBe('string');
        expect(typeof item.createdAt).toBe('string');
        expect(Array.isArray(item.orgs)).toBe(true);
      }
    });
  });
});

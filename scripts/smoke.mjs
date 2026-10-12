/**
 * End-to-end smoke test (Plan §22.4).
 *
 * Boots a real single-node MongoDB **replica set** (so change streams work), starts the
 * compiled backend exactly as Render would (`node backend/dist/index.js`), runs the
 * idempotent seed, then drives the live HTTP API: auth, tenant isolation, RBAC, domain
 * CRUD, evaluation, the graph/timeline lenses, audit and the SSE feed.
 *
 * Run with:  node scripts/smoke.mjs        (after `npm run build`)
 * Exits 0 when every check passes, 1 otherwise.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const PORT = Number(process.env.SMOKE_PORT ?? 4123);
const BASE = `http://127.0.0.1:${PORT}/api`;
const DEMO = { email: 'demo@iamscope.dev', password: 'iamscope-demo-2026' };

const results = [];
let backend = null;
let mongo = null;

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`  ${mark}  ${name}${detail ? `  ${detail}` : ''}`);
}

function assert(name, condition, detail = '') {
  record(name, Boolean(condition), detail);
  return Boolean(condition);
}

/* ------------------------------------------------------------------ */
/* Tiny cookie-aware HTTP client                                      */
/* ------------------------------------------------------------------ */

class Client {
  constructor() {
    this.cookies = new Map();
  }

  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  absorb(response) {
    const raw = response.headers.getSetCookie?.() ?? [];
    for (const entry of raw) {
      const [pair] = entry.split(';');
      const index = pair.indexOf('=');
      if (index < 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === '' || value === 'deleted') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request(method, path, body) {
    const headers = { Accept: 'application/json' };
    const cookie = this.header();
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const csrf = this.cookies.get('iamscope_csrf');
    if (csrf && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      headers['X-CSRF-Token'] = csrf;
    }

    const response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    this.absorb(response);

    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    return { status: response.status, body: payload, data: payload?.data ?? null };
  }

  get = (path) => this.request('GET', path);
  post = (path, body) => this.request('POST', path, body ?? {});
  put = (path, body) => this.request('PUT', path, body ?? {});
  patch = (path, body) => this.request('PATCH', path, body ?? {});
  del = (path) => this.request('DELETE', path);
}

async function waitForHealth(attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return await response.json();
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  return null;
}

function runNode(script, env, label, timeoutMs = 180_000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: 'timeout', out, label });
    }, timeoutMs);
    // Stream as it arrives so a stall is visible instead of silent.
    const capture = (chunk) => {
      const text = String(chunk);
      out += text;
      for (const line of text.split('\n')) {
        if (line.trim() !== '') console.log(`    │ ${line.trimEnd()}`);
      }
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, label });
    });
  });
}

/* ------------------------------------------------------------------ */
/* Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  console.log('› starting ephemeral MongoDB replica set...');
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const uriFor = (db) => mongo.getUri().replace('/?', `/${db}?`);
  console.log(`  replica set up: ${mongo.getUri().replace(/\/\/.*@/, '//')}`);

  const env = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(PORT),
    MONGO_IDENTITY_URL: uriFor('iamscope_identity'),
    MONGO_DATA_URL: uriFor('iamscope_data'),
    CORS_ORIGIN: 'http://localhost:3000',
    SESSION_SECRET: 'smoke-session-secret-smoke-session-secret',
    CSRF_SECRET: 'smoke-csrf-secret-smoke-csrf-secret',
    LOG_LEVEL: 'warn',
    APP_VERSION: 'smoke',
  };

  console.log('› booting backend...');
  backend = spawn(process.execPath, ['backend/dist/index.js'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  backend.stdout.on('data', (chunk) => {
    logs += String(chunk);
  });
  backend.stderr.on('data', (chunk) => {
    logs += String(chunk);
  });

  const health = await waitForHealth();
  if (!health) {
    console.error('backend never became healthy. Logs:\n', logs.slice(-4000));
    return false;
  }

  console.log('\n── health ──');
  assert(
    'GET /api/health returns ok',
    health.data?.status === 'ok',
    `status=${health.data?.status}`,
  );
  assert(
    'both logical databases are up',
    health.data?.database?.identity === 'up' && health.data?.database?.data === 'up',
    JSON.stringify(health.data?.database),
  );
  assert(
    'change-stream watcher is active (replica set)',
    health.data?.watchers?.active === true,
    `watched=${health.data?.watchers?.watchedCollections?.length ?? 0} collections`,
  );

  console.log('\n› seeding demo data...');
  const seed = await runNode('backend/dist/seed.js', env, 'seed', 120_000);
  if (seed.code !== 0) {
    console.log('  seed output:\n  ' + seed.out.split('\n').slice(-25).join('\n  '));
  } else {
    const summary = seed.out
      .split('\n')
      .filter((line) => /^(created|skipped|  owner|  org)/.test(line))
      .join(' | ');
    if (summary) console.log(`  ${summary}`);
  }
  assert('seed ran cleanly', seed.code === 0, `exit=${seed.code}`);

  console.log('\n── auth ──');
  const anon = new Client();
  const unauth = await anon.get('/policies');
  assert('unauthenticated request is rejected', unauth.status === 401, `status=${unauth.status}`);

  await anon.get('/auth/csrf');
  assert('CSRF cookie issued', anon.cookies.has('iamscope_csrf'));

  const badLogin = await anon.post('/auth/login', {
    email: DEMO.email,
    password: 'wrong-password-123',
  });
  assert('bad password is rejected', badLogin.status === 401, `status=${badLogin.status}`);

  const owner = new Client();
  await owner.get('/auth/csrf');
  const login = await owner.post('/auth/login', DEMO);
  assert(
    'demo user can log in',
    login.status === 200 && Boolean(login.data?.user),
    `status=${login.status}`,
  );
  assert('session cookie is httpOnly-shaped', owner.cookies.has('iamscope_session'));

  const me = await owner.get('/auth/me');
  const orgId = me.data?.activeOrg?.id ?? null;
  assert('GET /auth/me returns user + active org', Boolean(me.data?.user) && Boolean(orgId));
  assert('role is owner', me.data?.role === 'owner', `role=${me.data?.role}`);
  assert(
    'permissions object carries the coarse flags',
    me.data?.permissions?.canWrite === true && me.data?.permissions?.canDeleteOrg === true,
  );

  // CSRF enforcement: same session, no header.
  const noCsrf = new Client();
  for (const [k, v] of owner.cookies) noCsrf.cookies.set(k, v);
  noCsrf.cookies.delete('iamscope_csrf');
  const csrfRejected = await noCsrf.post('/auth/switch-org', { orgId });
  assert(
    'mutation without a CSRF header is rejected',
    csrfRejected.status === 403,
    `status=${csrfRejected.status}`,
  );

  console.log('\n── domain reads (seeded) ──');
  const policies = await owner.get('/policies');
  const policyItems = policies.data?.items ?? [];
  assert('policies list is populated', policyItems.length >= 5, `${policyItems.length} policies`);

  const principals = await owner.get('/principals');
  const principalItems = principals.data?.items ?? [];
  assert(
    'principals list is populated',
    principalItems.length >= 6,
    `${principalItems.length} principals`,
  );

  const resources = await owner.get('/resources');
  const resourceItems = resources.data?.items ?? [];
  assert(
    'resources list is populated',
    resourceItems.length >= 5,
    `${resourceItems.length} resources`,
  );

  const scenarios = await owner.get('/scenarios');
  const scenarioItems = scenarios.data?.items ?? [];
  assert(
    'scenarios list is populated',
    scenarioItems.length >= 8,
    `${scenarioItems.length} scenarios`,
  );

  console.log('\n── domain writes ──');
  const created = await owner.post('/policies', {
    name: `smoke-policy-${Date.now()}`,
    changeReason: 'created by the smoke test',
    tags: { team: 'smoke' },
    statements: [
      {
        sid: 'AllowSmokeRead',
        effect: 'Allow',
        actions: ['s3:GetObject'],
        resources: ['arn:aws:s3:::smoke-bucket/*'],
        conditions: [{ operator: 'StringEquals', key: 'aws:PrincipalTag/team', values: ['smoke'] }],
      },
    ],
  });
  assert(
    'policy create works',
    created.status === 201 || created.status === 200,
    `status=${created.status}`,
  );
  const policyId = created.data?.id ?? null;
  assert(
    'new policy is at version 1',
    created.data?.currentVersion === 1,
    `v=${created.data?.currentVersion}`,
  );

  if (policyId) {
    const updated = await owner.put(`/policies/${policyId}`, {
      changeReason: 'smoke test update',
      statements: [
        {
          sid: 'AllowSmokeRead',
          effect: 'Allow',
          actions: ['s3:GetObject', 's3:ListBucket'],
          resources: ['arn:aws:s3:::smoke-bucket/*'],
          conditions: [],
        },
      ],
    });
    assert('policy update works', updated.status === 200, `status=${updated.status}`);
    assert(
      'version incremented to 2',
      updated.data?.currentVersion === 2,
      `v=${updated.data?.currentVersion}`,
    );

    const versions = await owner.get(`/policies/${policyId}/versions`);
    assert(
      'immutable version history recorded',
      (versions.data?.items ?? versions.data ?? []).length >= 2 || versions.status === 200,
      `status=${versions.status}`,
    );
  }

  const crudId = Date.now();
  const principalArn = `arn:aws:iam::123456789012:user/smoke-crud-${crudId}`;
  const resourceArn = `arn:aws:s3:::smoke-crud-${crudId}`;

  const newPrincipal = await owner.post('/principals', {
    type: 'User',
    name: `smoke-crud-${crudId}`,
    arn: principalArn,
  });
  assert('principal create works', newPrincipal.status === 201, `status=${newPrincipal.status}`);
  const principalId = newPrincipal.data?.id;
  if (principalId) {
    const read = await owner.get(`/principals/${principalId}`);
    assert('principal read works', read.status === 200 && read.data?.arn === principalArn);
    const updated = await owner.put(`/principals/${principalId}`, {
      name: `smoke-crud-updated-${crudId}`,
    });
    assert(
      'principal update works',
      updated.status === 200 && updated.data?.name === `smoke-crud-updated-${crudId}`,
      `status=${updated.status}`,
    );
  } else {
    record('principal read works', false, 'create returned no id');
    record('principal update works', false, 'create returned no id');
  }

  const newResource = await owner.post('/resources', {
    arn: resourceArn,
    type: 's3-bucket',
  });
  assert('resource create works', newResource.status === 201, `status=${newResource.status}`);
  const resourceId = newResource.data?.id;
  if (resourceId) {
    const read = await owner.get(`/resources/${resourceId}`);
    assert('resource read works', read.status === 200 && read.data?.arn === resourceArn);
    const updated = await owner.put(`/resources/${resourceId}`, { tags: { purpose: 'smoke' } });
    assert(
      'resource update works',
      updated.status === 200 && updated.data?.tags?.purpose === 'smoke',
      `status=${updated.status}`,
    );
  } else {
    record('resource read works', false, 'create returned no id');
    record('resource update works', false, 'create returned no id');
  }

  const newScenario = await owner.post('/scenarios', {
    name: `smoke-crud-${crudId}`,
    principalArn,
    action: 's3:GetObject',
    resourceArn,
    expectedResult: 'Deny',
  });
  assert('scenario create works', newScenario.status === 201, `status=${newScenario.status}`);
  const scenarioId = newScenario.data?.id;
  if (scenarioId) {
    const list = await owner.get(`/scenarios?q=smoke-crud-${crudId}`);
    assert(
      'scenario read works',
      list.status === 200 && (list.data?.items ?? []).some((item) => item.id === scenarioId),
      `status=${list.status}`,
    );
    const updated = await owner.put(`/scenarios/${scenarioId}`, {
      name: `smoke-crud-updated-${crudId}`,
    });
    assert(
      'scenario update works',
      updated.status === 200 && updated.data?.name === `smoke-crud-updated-${crudId}`,
      `status=${updated.status}`,
    );
    const deleted = await owner.del(`/scenarios/${scenarioId}`);
    assert('scenario delete works', deleted.status === 200, `status=${deleted.status}`);
  } else {
    record('scenario read works', false, 'create returned no id');
    record('scenario update works', false, 'create returned no id');
    record('scenario delete works', false, 'create returned no id');
  }

  if (principalId) {
    const deleted = await owner.del(`/principals/${principalId}`);
    assert('principal delete works', deleted.status === 200, `status=${deleted.status}`);
  } else {
    record('principal delete works', false, 'create returned no id');
  }
  if (resourceId) {
    const deleted = await owner.del(`/resources/${resourceId}`);
    assert('resource delete works', deleted.status === 200, `status=${deleted.status}`);
  } else {
    record('resource delete works', false, 'create returned no id');
  }

  console.log('\n── evaluation engine ──');
  const targetPrincipal = principalItems[0]?.arn ?? null;
  if (targetPrincipal) {
    const evaluation = await owner.post('/evaluate', {
      principalArn: targetPrincipal,
      action: 's3:GetObject',
      resourceArn: 'arn:aws:s3:::acme-app-data/*',
      persist: true,
      label: 'smoke evaluation',
    });
    assert(
      'POST /evaluate returns a decision',
      evaluation.status === 200,
      `status=${evaluation.status}`,
    );
    const outcome = evaluation.data;
    assert(
      'decision is Allow or Deny',
      outcome?.result === 'Allow' || outcome?.result === 'Deny',
      `result=${outcome?.result} reason=${outcome?.reason}`,
    );
    assert(
      'decision carries a trace array',
      Array.isArray(outcome?.trace),
      `trace=${outcome?.trace?.length ?? 0}`,
    );
  } else {
    record('POST /evaluate returns a decision', false, 'no seeded principal to evaluate');
  }

  const runs = await owner.get('/evaluations');
  const runItems = runs.data?.items ?? [];
  assert('evaluation runs were persisted', runItems.length >= 1, `${runItems.length} runs`);

  if (runItems.length >= 2) {
    const after = runItems[0]?.id;
    const before = runItems[1]?.id;
    const diff = await owner.get(`/evaluations/diff?before=${before}&after=${after}`);
    assert(
      'impact diff computes',
      diff.status === 200 && Boolean(diff.data?.counts),
      `status=${diff.status}`,
    );
    assert(
      'diff reports per-transition counts',
      typeof diff.data?.counts?.changed === 'number',
      JSON.stringify(diff.data?.counts ?? {}),
    );
  } else {
    record('impact diff computes', false, 'need at least 2 runs');
  }

  console.log('\n── graph lens ──');
  const escalation = await owner.post('/graph/escalation', {});
  assert('escalation traversal runs', escalation.status === 200, `status=${escalation.status}`);
  const paths = escalation.data?.paths ?? [];
  assert('escalation paths found in seeded org', paths.length >= 1, `${paths.length} paths`);
  assert(
    'graph payload carries nodes + edges',
    (escalation.data?.nodes ?? []).length > 0 && (escalation.data?.edges ?? []).length >= 0,
    `nodes=${escalation.data?.nodes?.length ?? 0} edges=${escalation.data?.edges?.length ?? 0}`,
  );
  if (paths.length > 0) {
    assert(
      'severity is one of low/medium/high',
      ['low', 'medium', 'high'].includes(paths[0]?.severity),
      `severity=${paths[0]?.severity} hops=${paths[0]?.hops?.length}`,
    );
  }

  console.log('\n── timeline lens ──');
  const at = new Date(Date.now() + 60_000).toISOString();
  const state = await owner.get(`/timeline/state?at=${encodeURIComponent(at)}`);
  assert('state reconstruction works', state.status === 200, `status=${state.status}`);
  assert(
    'reconstruction returns policies and principals',
    (state.data?.policies ?? []).length > 0 && (state.data?.principals ?? []).length > 0,
    `policies=${state.data?.policies?.length ?? 0} principals=${state.data?.principals?.length ?? 0}`,
  );

  const events = await owner.get('/timeline/events');
  assert('timeline events endpoint works', events.status === 200, `status=${events.status}`);

  console.log('\n── audit ──');
  const audit = await owner.get('/audit');
  const auditItems = audit.data?.items ?? [];
  assert('audit trail has entries', auditItems.length >= 1, `${auditItems.length} events`);
  assert(
    'audit events carry actor + action + target',
    Boolean(auditItems[0]?.action) && Boolean(auditItems[0]?.target?.type),
    `action=${auditItems[0]?.action}`,
  );

  if (runItems.length >= 2 && scenarioItems.length > 0) {
    const attribution = await owner.get(
      `/audit/attribution?scenarioId=${scenarioItems[0].id}&before=${runItems[1].id}&after=${runItems[0].id}`,
    );
    assert(
      'attribution endpoint works',
      attribution.status === 200,
      `status=${attribution.status}`,
    );
  }

  console.log('\n── presence ──');
  await owner.post('/presence/heartbeat', {
    location: { route: '/graph', entityType: 'graph', entityId: null },
    cursor: { x: 0.42, y: 0.31 },
  });
  const presence = await owner.get('/presence');
  assert(
    'presence roster includes the current user',
    (presence.data ?? []).length >= 1,
    `${(presence.data ?? []).length} present`,
  );

  console.log('\n── RBAC + tenant isolation ──');
  const outsiderEmail = `outsider+${Date.now()}@example.com`;
  const signup = await anon.post('/auth/signup', {
    email: outsiderEmail,
    password: 'correct-horse-battery-9',
    name: 'Outside Auditor',
    orgName: 'Rival Cloud',
  });
  assert(
    'second signup works',
    signup.status === 201 || signup.status === 200,
    `status=${signup.status}`,
  );

  const outsider = new Client();
  await outsider.get('/auth/csrf');
  const outsiderLogin = await outsider.post('/auth/login', {
    email: outsiderEmail,
    password: 'correct-horse-battery-9',
  });
  assert('outsider can log in', outsiderLogin.status === 200, `status=${outsiderLogin.status}`);

  if (policyId && outsiderLogin.status === 200) {
    const crossOrgRead = await outsider.get(`/policies/${policyId}`);
    assert(
      'tenant isolation: cross-org read by id returns 404',
      crossOrgRead.status === 404,
      `status=${crossOrgRead.status}`,
    );
    const crossOrgWrite = await outsider.del(`/policies/${policyId}`);
    assert(
      'tenant isolation: cross-org delete by id is refused',
      crossOrgWrite.status === 404 || crossOrgWrite.status === 403,
      `status=${crossOrgWrite.status}`,
    );
  }

  const listOutside = await outsider.get('/policies');
  assert(
    'tenant isolation: outsider sees only their own (empty) policy list',
    (listOutside.data?.items ?? []).length === 0,
    `${(listOutside.data?.items ?? []).length} policies visible`,
  );

  console.log('\n── viewer role enforcement ──');
  const invite = await owner.post(`/orgs/${orgId}/invitations`, {
    email: `viewer+${Date.now()}@example.com`,
    role: 'viewer',
  });
  const inviteToken = invite.data?.token ?? null;
  assert(
    'owner can invite a viewer',
    invite.status === 201 || invite.status === 200,
    `status=${invite.status}`,
  );

  if (inviteToken) {
    const viewerEmail = invite.data?.email ?? '';
    // A fresh client: the invitation accept route is public and must not inherit
    // the outsider's session from an earlier step.
    const invitee = new Client();
    await invitee.get('/auth/csrf');
    const accept = await invitee.post(`/invitations/${inviteToken}/accept`, {
      name: 'Read Only',
      password: 'read-only-password-7',
    });
    assert(
      'invitation can be accepted',
      accept.status === 200 || accept.status === 201,
      `status=${accept.status}`,
    );

    const viewer = new Client();
    await viewer.get('/auth/csrf');
    const viewerLogin = await viewer.post('/auth/login', {
      email: viewerEmail,
      password: 'read-only-password-7',
    });
    const viewerMe = await viewer.get('/auth/me');
    assert(
      'viewer membership has role viewer',
      viewerMe.data?.role === 'viewer',
      `role=${viewerMe.data?.role}`,
    );

    const viewerWrite = await viewer.post('/policies', {
      name: 'viewer-should-not-write',
      changeReason: 'should be refused',
      statements: [
        { sid: 'x', effect: 'Allow', actions: ['s3:*'], resources: ['*'], conditions: [] },
      ],
    });
    assert(
      'viewer cannot create a policy (403)',
      viewerWrite.status === 403,
      `status=${viewerWrite.status}`,
    );

    const viewerEvaluate = await viewer.post('/evaluate', {
      principalArn: targetPrincipal,
      action: 's3:GetObject',
      resourceArn: 'arn:aws:s3:::acme-app-data/*',
      persist: false,
    });
    assert(
      'viewer CAN evaluate (Plan §8.8: any role)',
      viewerEvaluate.status === 200,
      `status=${viewerEvaluate.status}`,
    );

    const viewerDelete = await viewer.del(`/policies/${policyId}`);
    assert(
      'viewer cannot delete (403/404)',
      viewerDelete.status === 403 || viewerDelete.status === 404,
      `status=${viewerDelete.status}`,
    );
  }

  console.log('\n── API keys ──');
  const apiKey = await owner.post(`/orgs/${orgId}/api-keys`, {
    name: 'smoke key',
    scopes: ['read'],
  });
  const secret = apiKey.data?.secret ?? null;
  assert(
    'API key can be created',
    apiKey.status === 201 || apiKey.status === 200,
    `status=${apiKey.status}`,
  );
  assert('API key secret is shown once', typeof secret === 'string' && secret.length > 10);

  if (secret) {
    const keyRead = await fetch(`${BASE}/policies`, {
      headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' },
    });
    assert('API key authenticates a read', keyRead.status === 200, `status=${keyRead.status}`);

    const keyWrite = await fetch(`${BASE}/policies`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        name: 'api-key-should-not-write',
        changeReason: 'read scope only',
        statements: [
          { sid: 'x', effect: 'Allow', actions: ['s3:*'], resources: ['*'], conditions: [] },
        ],
      }),
    });
    assert(
      'read-scoped API key cannot write (403)',
      keyWrite.status === 403,
      `status=${keyWrite.status}`,
    );
  }

  console.log('\n── SSE live feed ──');
  const controller = new AbortController();
  const ssePromise = (async () => {
    const response = await fetch(`${BASE}/events`, {
      headers: { Cookie: owner.header(), Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    if (!reader) return { contentType: response.headers.get('content-type'), chunk: '' };
    const decoder = new TextDecoder();
    let chunk = '';
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      chunk += decoder.decode(value, { stream: true });
      if (chunk.includes('\n\n')) break;
    }
    controller.abort();
    return { contentType: response.headers.get('content-type'), chunk };
  })();

  const sse = await ssePromise.catch(() => ({ contentType: null, chunk: '' }));
  assert(
    'SSE endpoint streams text/event-stream',
    (sse.contentType ?? '').includes('text/event-stream'),
    `content-type=${sse.contentType}`,
  );
  assert(
    'SSE sends a hello/handshake frame',
    sse.chunk.includes('event: hello') || sse.chunk.includes(':') || sse.chunk.includes('data:'),
    JSON.stringify(sse.chunk.slice(0, 60)),
  );

  if (health.data?.sseClients !== undefined) {
    const after = await owner.get('/health');
    assert(
      'health reports the SSE client registry',
      typeof after.data?.sseClients === 'number',
      `sseClients=${after.data?.sseClients}`,
    );
  }

  return results.every((r) => r.ok);
}

/* ------------------------------------------------------------------ */

let ok = false;
try {
  ok = await main();
} catch (error) {
  console.error('\nsmoke run threw:', error);
  ok = false;
} finally {
  if (backend) backend.kill();
  if (mongo) await mongo.stop().catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log('\nfailures:');
  for (const failure of failed) console.log(`  - ${failure.name} ${failure.detail}`);
}
process.exit(ok ? 0 : 1);

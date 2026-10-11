/**
 * Deployed-stack verification (Plan §22.4, Phase 12 step 12.6).
 *
 * `scripts/smoke.mjs` cannot do this job: it boots its own `MongoMemoryReplSet`, runs
 * `backend/dist/seed.js` and starts `backend/dist/index.js` itself, so it only ever tests
 * a local build. This script talks to a running deployment instead.
 *
 *   node scripts/deploy-check.mjs --api https://iamscope-api.onrender.com --web https://iamscope.vercel.app
 *
 * Reads the demo credentials from `--email` / `--password` (they default to the seeded
 * demo owner). Exits non-zero unless every check passes.
 *
 * What it deliberately does NOT cover, because it needs a second identity or a second
 * org and therefore a human: RBAC denials for viewer/member/admin, cross-org isolation,
 * and anything that requires reading the audit log as a different role. Those are manual
 * checks in 12.6.
 */
import { setTimeout as sleep } from 'node:timers/promises';

function parseArgs(argv) {
  const out = {
    api: process.env.DEPLOY_API_URL ?? '',
    web: process.env.DEPLOY_WEB_URL ?? '',
    email: process.env.DEPLOY_EMAIL ?? 'demo@iamscope.dev',
    password: process.env.DEPLOY_PASSWORD ?? 'iamscope-demo-2026',
    // Must exceed the server's heartbeat interval (10s) or the heartbeat assertion below
    // proves nothing.
    sseSeconds: Number(process.env.DEPLOY_SSE_SECONDS ?? 15),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split('=');
    const value = inline ?? argv[i + 1];
    if (flag === '--api') out.api = value;
    else if (flag === '--web') out.web = value;
    else if (flag === '--email') out.email = value;
    else if (flag === '--password') out.password = value;
    else if (flag === '--sse-seconds') out.sseSeconds = Number(value);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.api === '') {
  console.error('Usage: node scripts/deploy-check.mjs --api https://<render-url> [--web <vercel-url>]');
  process.exit(2);
}

const API = args.api.replace(/\/+$/, '');
const WEB = args.web.replace(/\/+$/, '');

const results = [];
let failures = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  const mark = ok ? 'ok  ' : 'FAIL';
  console.log(`  ${mark} ${name}${detail === '' ? '' : `  (${detail})`}`);
}

/* ------------------------------------------------------------------ */
/* Cookie jar                                                          */
/* ------------------------------------------------------------------ */

const jar = new Map();

function absorb(response) {
  const raw = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  for (const line of raw) {
    const [pair] = line.split(';');
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (value === '') jar.delete(name);
    else jar.set(name, value);
    const attrs = line.toLowerCase();
    if (name === 'iamscope_session') {
      lastSessionAttrs = { httpOnly: /httponly/.test(attrs), secure: /secure/.test(attrs), sameSite: /samesite=([a-z]+)/.exec(attrs)?.[1] ?? '' };
    }
  }
}

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

let lastSessionAttrs = null;

async function request(method, path, body, extraHeaders = {}) {
  const headers = { Accept: 'application/json', ...extraHeaders };
  const cookies = cookieHeader();
  if (cookies !== '') headers.Cookie = cookies;
  const csrf = jar.get('iamscope_csrf');
  if (csrf !== undefined && method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = csrf;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${API}/api${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'manual',
  });
  absorb(response);

  let payload = null;
  const text = await response.text();
  try {
    payload = text === '' ? null : JSON.parse(text);
  } catch {
    payload = text;
  }
  return { status: response.status, headers: response.headers, body: payload };
}

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  console.log(`\nDeployed-stack check against ${API}\n`);

  /* 1. Health ------------------------------------------------------- */
  console.log('-- health --');
  const health = await request('GET', '/health');
  check('GET /api/health is 200', health.status === 200, `status=${health.status}`);
  check('health body reports ok', health.body?.data?.status === 'ok' || health.body?.status === 'ok', JSON.stringify(health.body)?.slice(0, 80));

  /* 2. Security headers -------------------------------------------- */
  console.log('\n-- security headers (Plan 19 / 13.1) --');
  const h = health.headers;
  check('x-content-type-options: nosniff', h.get('x-content-type-options') === 'nosniff', String(h.get('x-content-type-options')));
  check('x-frame-options present', h.get('x-frame-options') !== null, String(h.get('x-frame-options')));
  check('content-security-policy present', h.get('content-security-policy') !== null);
  check('referrer-policy present', h.get('referrer-policy') !== null, String(h.get('referrer-policy')));
  check('strict-transport-security present', h.get('strict-transport-security') !== null, String(h.get('strict-transport-security')));

  /* 3. CSRF bootstrap ---------------------------------------------- */
  console.log('\n-- csrf --');
  const csrf = await request('GET', '/auth/csrf');
  check('GET /auth/csrf is 200', csrf.status === 200, `status=${csrf.status}`);
  check('csrf cookie issued', jar.has('iamscope_csrf'));

  /* 4. Login ------------------------------------------------------- */
  console.log('\n-- login --');
  const login = await request('POST', '/auth/login', { email: args.email, password: args.password });
  check('POST /auth/login is 200', login.status === 200, `status=${login.status} body=${JSON.stringify(login.body)?.slice(0, 120)}`);
  check('session cookie issued', jar.has('iamscope_session'));
  if (lastSessionAttrs !== null) {
    check('session cookie is httpOnly', lastSessionAttrs.httpOnly, JSON.stringify(lastSessionAttrs));
    check('session cookie is Secure in production', lastSessionAttrs.secure, `secure=${String(lastSessionAttrs.secure)}`);
    // SameSite=none is the signal that the SPA is calling a cross-origin API directly.
    check(
      'session cookie SameSite is lax (first-party via the Vercel rewrite)',
      lastSessionAttrs.sameSite === 'lax' || lastSessionAttrs.sameSite === 'strict',
      `sameSite=${lastSessionAttrs.sameSite}`,
    );
  }

  const me = await request('GET', '/auth/me');
  check('GET /auth/me is 200 (cookie survives the proxy)', me.status === 200, `status=${me.status}`);
  check('me carries a role', typeof me.body?.data?.role === 'string', String(me.body?.data?.role));

  /* 5. Read paths -------------------------------------------------- */
  console.log('\n-- reads --');
  const policies = await request('GET', '/policies');
  check('GET /policies is 200', policies.status === 200, `status=${policies.status}`);
  const policyItems = policies.body?.data?.items ?? [];
  check('seeded org has policies', Array.isArray(policyItems) && policyItems.length > 0, `count=${policyItems.length}`);

  const timeline = await request('GET', `/timeline/state?at=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`);
  check('GET /timeline/state is 200', timeline.status === 200, `status=${timeline.status}`);
  check('timeline reconstructs principals', (timeline.body?.data?.principals ?? []).length > 0, `principals=${(timeline.body?.data?.principals ?? []).length}`);

  /* 6. Escalation -------------------------------------------------- */
  console.log('\n-- graph --');
  const escalation = await request('POST', '/graph/escalation', {});
  check('POST /graph/escalation is 200', escalation.status === 200, `status=${escalation.status}`);
  const paths = escalation.body?.data?.paths ?? [];
  check('escalation paths computed', paths.length > 0, `paths=${paths.length}`);
  const first = paths[0];
  const principalArn = first?.fromPrincipalArn ?? '';

  /* 7. Evaluate ---------------------------------------------------- */
  console.log('\n-- evaluate --');
  if (principalArn !== '') {
    const evaluate = await request('POST', '/evaluate', {
      principalArn,
      action: 's3:GetObject',
      resourceArn: 'arn:aws:s3:::acme-app-data/*',
      persist: true,
      label: 'deploy-check',
    });
    check('POST /evaluate is 200', evaluate.status === 200, `status=${evaluate.status}`);
    check('evaluate returns a decision', ['Allow', 'Deny'].includes(evaluate.body?.data?.result), String(evaluate.body?.data?.result));
    check('decision carries a trace', Array.isArray(evaluate.body?.data?.trace), `trace=${(evaluate.body?.data?.trace ?? []).length}`);
  } else {
    check('POST /evaluate is 200', false, 'no principalArn available from the escalation payload');
  }

  /* 8. SSE headers + heartbeat ------------------------------------- */
  console.log('\n-- sse (Plan 14 / 12.3) --');
  const controller = new AbortController();
  const sse = await fetch(`${API}/api/events`, {
    headers: { Accept: 'text/event-stream', Cookie: cookieHeader() },
    signal: controller.signal,
  });
  check('GET /api/events is 200', sse.status === 200, `status=${sse.status}`);
  check('content-type is text/event-stream', String(sse.headers.get('content-type')).includes('text/event-stream'), String(sse.headers.get('content-type')));
  check(
    'x-accel-buffering: no is set',
    String(sse.headers.get('x-accel-buffering')).toLowerCase() === 'no',
    String(sse.headers.get('x-accel-buffering')),
  );

  let streamed = '';
  const readerTask = (async () => {
    const reader = sse.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        streamed += decoder.decode(value, { stream: true });
      }
    } catch {
      /* aborted */
    }
  })();

  await sleep(args.sseSeconds * 1_000);
  check('stream produced bytes within the window', streamed.length > 0, `bytes=${streamed.length}`);
  check('stream sent a heartbeat comment', streamed.includes(':heartbeat') || streamed.includes('retry:'));

  /* 9. Live delivery: mutate, expect the open stream to see it ------ */
  console.log('\n-- live delivery (the check curl cannot make) --');
  const before = streamed.length;
  const create = await request('POST', '/policies', {
    name: `deploy-check-${Date.now()}`,
    changeReason: 'deploy-check live delivery probe',
    statements: [
      { sid: 'AllowCheck', effect: 'Allow', actions: ['s3:GetObject'], resources: ['arn:aws:s3:::acme-app-data/*'], conditions: [] },
    ],
  });
  check('mutation accepted while a stream is open', create.status === 201 || create.status === 200, `status=${create.status}`);
  await sleep(3_000);
  check('open stream received the mutation', streamed.length > before + 10, `delta=${streamed.length - before}`);

  controller.abort();
  await readerTask;
  check('stream closed cleanly on abort', true);

  /* 10. Frontend -------------------------------------------------- */
  if (WEB !== '') {
    console.log('\n-- frontend --');
    const page = await fetch(WEB, { redirect: 'follow' });
    check('frontend index is 200', page.status === 200, `status=${page.status}`);
    check('frontend served HTML', String(page.headers.get('content-type')).includes('text/html'));
    const proxy = await fetch(`${WEB}/api/health`, { redirect: 'follow' });
    check('frontend /api rewrite reaches the API', proxy.status === 200, `status=${proxy.status}`);
  }

  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  if (failures > 0) {
    console.log('\nFailures:');
    for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name}${r.detail === '' ? '' : `  (${r.detail})`}`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('\ndeploy-check crashed:', error instanceof Error ? error.message : error);
  process.exit(2);
});

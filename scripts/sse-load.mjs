/**
 * Phase 13.2 SSE load test.
 *
 * Spawns N concurrent SSE clients against the deployed stack, records per-client event
 * counts, heartbeats, and latencies, mutates a policy after a configured delay,
 * asserts that every connected client receives the broadcast event within 2s,
 * and confirms clients unregister cleanly upon connection close.
 *
 * Usage:
 *   node scripts/sse-load.mjs --api https://iamscope-api.onrender.com --clients 50 --duration 300 --mutate-at 60
 *   Add --ca path/to/trusted-root.pem when the local TLS inspector uses a CA
 *   trusted by the OS but not by Node. TLS verification remains enabled.
 */
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { Agent, fetch } from 'undici';

function parseArgs(argv) {
  const out = {
    api: process.env.DEPLOY_API_URL ?? 'https://iamscope-api.onrender.com',
    email: process.env.DEPLOY_EMAIL ?? 'demo@iamscope.dev',
    password: process.env.DEPLOY_PASSWORD ?? 'iamscope-demo-2026',
    clients: Number(process.env.SSE_LOAD_CLIENTS ?? 50),
    duration: Number(process.env.SSE_LOAD_DURATION ?? 300),
    mutateAt: Number(process.env.SSE_LOAD_MUTATE_AT ?? 60),
    ca: process.env.SSE_CA_FILE ?? null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split('=');
    const value = inline ?? argv[i + 1];
    if (flag === '--api') out.api = value;
    else if (flag === '--email') out.email = value;
    else if (flag === '--password') out.password = value;
    else if (flag === '--clients') out.clients = Number(value);
    else if (flag === '--duration') out.duration = Number(value);
    else if (flag === '--mutate-at') out.mutateAt = Number(value);
    else if (flag === '--ca') out.ca = value;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const API = args.api.replace(/\/+$/, '');
const dispatcher = args.ca ? new Agent({ connect: { ca: readFileSync(args.ca) } }) : null;
const fetchWithAgent = (url, options = {}) =>
  fetch(url, dispatcher ? { ...options, dispatcher } : options);

console.log('----------------------------------------------------');
console.log(' IAMScope SSE Load Harness (Phase 13.2)');
console.log(` Target API   : ${API}`);
console.log(` Clients      : ${args.clients}`);
console.log(` Duration     : ${args.duration}s`);
console.log(` Mutation at  : ${args.mutateAt}s`);
console.log('----------------------------------------------------\n');

async function main() {
  console.log('1. Authenticating test session...');
  const loginRes = await fetchWithAgent(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: args.email, password: args.password }),
  });

  if (loginRes.status !== 200) {
    throw new Error(`Login failed with status ${loginRes.status}: ${await loginRes.text()}`);
  }

  const cookies = loginRes.headers.getSetCookie?.() ?? [loginRes.headers.get('set-cookie') ?? ''];
  const sessionCookie = cookies.find((c) => c.startsWith('iamscope_session='));
  const csrfCookie = cookies.find((c) => c.startsWith('iamscope_csrf='));

  if (!sessionCookie) throw new Error('Missing iamscope_session cookie in login response');
  let csrfToken = csrfCookie?.split(';')[0]?.split('=')[1];

  if (!csrfToken) {
    const csrfRes = await fetchWithAgent(`${API}/api/auth/csrf`, {
      headers: { Cookie: sessionCookie.split(';')[0] },
    });
    const csrfBody = await csrfRes.json();
    csrfToken = csrfBody.data.token;
  }

  const cookieHeader = [sessionCookie.split(';')[0], `iamscope_csrf=${csrfToken}`].join('; ');
  console.log('   Authenticated successfully as demo owner.\n');

  console.log(`2. Spawning ${args.clients} concurrent SSE client connections...`);
  let mutationDocumentId = null;
  let mutationStartedAt = null;
  let mutationAcceptedAt = null;

  const clientStates = Array.from({ length: args.clients }, (_, idx) => ({
    id: idx + 1,
    connected: false,
    bytes: 0,
    buffer: '',
    frames: 0,
    heartbeats: 0,
    events: [],
    mutationReceivedAt: null,
    error: null,
    abortController: new AbortController(),
  }));

  const streamPromises = clientStates.map(async (client) => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const res = await fetchWithAgent(`${API}/api/events`, {
          headers: {
            Accept: 'text/event-stream',
            Cookie: cookieHeader,
          },
          signal: client.abortController.signal,
        });

        if (res.status !== 200) {
          client.error = `HTTP ${res.status}`;
          if (attempt < 3) await sleep(1_000 * attempt);
          continue;
        }

        client.error = null;
        client.connected = true;
        client.buffer = '';
        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          client.bytes += chunk.length;
          client.buffer += chunk;
          let boundary;
          while ((boundary = client.buffer.indexOf('\n\n')) !== -1) {
            const frame = client.buffer.slice(0, boundary);
            client.buffer = client.buffer.slice(boundary + 2);
            if (frame.startsWith(': heartbeat')) client.heartbeats += 1;
            if (frame.includes('event:') && frame.includes('data:')) {
              client.frames += 1;
              const documentId = frame.match(/"documentId":"([^"]+)"/)?.[1] ?? null;
              if (documentId) {
                const event = { documentId, receivedAt: Date.now() };
                client.events.push(event);
                if (client.events.length > 100) client.events.shift();
                if (documentId === mutationDocumentId && client.mutationReceivedAt === null) {
                  client.mutationReceivedAt = event.receivedAt;
                }
              }
            }
          }
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        client.error = err.message;
      } finally {
        client.connected = false;
      }
      if (attempt < 3) await sleep(1_000 * attempt);
    }
  });

  // Allow slow edge connections and transient connection retries before the timed window.
  for (let second = 0; second < 20; second += 1) {
    if (clientStates.every((client) => client.connected)) break;
    await sleep(1_000);
  }
  const activeInitial = clientStates.filter((c) => c.connected).length;
  console.log(`   Connected ${activeInitial}/${args.clients} clients successfully.\n`);
  if (activeInitial !== args.clients) {
    for (const client of clientStates) client.abortController.abort();
    await Promise.allSettled(streamPromises);
    throw new Error(
      `Only ${activeInitial}/${args.clients} streams opened: ${clientStates
        .filter((c) => c.error)
        .map((c) => `#${c.id} ${c.error}`)
        .join(', ')}`,
    );
  }

  let mutationSent = false;
  const startTime = Date.now();
  const endTime = startTime + args.duration * 1_000;
  const mutateTime = startTime + args.mutateAt * 1_000;

  console.log('3. Running load cycle with live progress reports...');

  while (Date.now() < endTime) {
    const elapsed = Math.floor((Date.now() - startTime) / 1_000);

    // Trigger mutation after mutateAt seconds
    if (!mutationSent && Date.now() >= mutateTime) {
      mutationSent = true;
      mutationStartedAt = Date.now();
      const policyName = `sse-load-probe-${Date.now()}`;
      console.log(
        `\n   >>> [${elapsed}s] Triggering policy mutation "${policyName}" to test fan-out...`,
      );

      const mutRes = await fetchWithAgent(`${API}/api/policies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieHeader,
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          name: policyName,
          changeReason: 'Phase 13.2 SSE 50-client fan-out load test',
          statements: [
            {
              sid: 'LoadProbe',
              effect: 'Allow',
              actions: ['s3:GetObject'],
              resources: ['arn:aws:s3:::acme-app-data/*'],
              conditions: [],
            },
          ],
        }),
      });

      if (mutRes.status !== 201 && mutRes.status !== 200) {
        console.error(`   Mutation failed: HTTP ${mutRes.status} ${await mutRes.text()}`);
      } else {
        const body = await mutRes.json();
        mutationDocumentId = body.data?.id;
        mutationAcceptedAt = Date.now();
        for (const client of clientStates) {
          client.mutationReceivedAt =
            client.events.find((event) => event.documentId === mutationDocumentId)?.receivedAt ??
            null;
        }
        console.log(
          `   >>> Mutation accepted (id: ${mutationDocumentId}, request ${mutationAcceptedAt - mutationStartedAt}ms). Monitoring ${args.clients}-client delivery window (<2s)...`,
        );
      }
    }

    const connectedCount = clientStates.filter((c) => c.connected).length;
    const deliveredCount = clientStates.filter((c) => c.mutationReceivedAt !== null).length;
    const totalBytes = clientStates.reduce((acc, c) => acc + c.bytes, 0);

    console.log(
      `   [${elapsed.toString().padStart(3, ' ')}s / ${args.duration}s] Active clients: ${connectedCount}/${args.clients} | Total bytes: ${(totalBytes / 1024).toFixed(1)} KB | Mutation deliveries: ${deliveredCount}/${args.clients}`,
    );

    await sleep(15_000);
  }

  console.log('\n4. Tearing down client connections cleanly...');
  for (const client of clientStates) {
    client.abortController.abort();
  }
  await Promise.allSettled(streamPromises);

  // A reverse proxy may take a few seconds to propagate socket close to Render.
  let serverClients = 'unknown';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const healthRes = await fetchWithAgent(`${API}/api/health`);
    const healthData = await healthRes.json();
    serverClients = healthData.data?.sseClients ?? 'unknown';
    if (serverClients === 0) break;
    await sleep(3_000);
  }

  console.log(`   Post-test server registered sseClients: ${serverClients} (expected: 0)\n`);

  console.log('====================================================');
  console.log(` SSE LOAD TEST SUMMARY (${args.clients} CLIENTS)`);
  console.log('====================================================');

  const latencies = clientStates
    .map((c) => (c.mutationReceivedAt === null ? null : c.mutationReceivedAt - mutationStartedAt))
    .filter((l) => typeof l === 'number');
  const afterAccepted = clientStates
    .map((c) =>
      c.mutationReceivedAt === null ? null : Math.max(0, c.mutationReceivedAt - mutationAcceptedAt),
    )
    .filter((l) => typeof l === 'number');

  const minLat = latencies.length > 0 ? Math.min(...latencies) : null;
  const maxLat = latencies.length > 0 ? Math.max(...latencies) : null;
  const avgLat =
    latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : null;

  console.log(
    ` Target clients connected     : ${clientStates.filter((c) => c.bytes > 0).length}/${args.clients}`,
  );
  console.log(` Mutation delivered to clients : ${latencies.length}/${args.clients}`);
  console.log(` Per-client frames / heartbeats / delivered / latency from start:`);
  for (const client of clientStates) {
    const latency =
      client.mutationReceivedAt === null
        ? 'missing'
        : `${client.mutationReceivedAt - mutationStartedAt}ms`;
    console.log(
      `   #${String(client.id).padStart(2, '0')}: ${client.frames} / ${client.heartbeats} / ${client.mutationReceivedAt !== null} / ${latency}${client.error ? ` / error=${client.error}` : ''}`,
    );
  }
  if (latencies.length > 0) {
    console.log(
      ` Delivery latency from request start (min/avg/max): ${minLat}ms / ${avgLat}ms / ${maxLat}ms`,
    );
    console.log(` Delivery latency after HTTP acceptance (max): ${Math.max(...afterAccepted)}ms`);
    console.log(
      ` All delivered within 2s (<2000ms): ${maxLat !== null && maxLat <= 2000 ? 'YES (PASS)' : 'NO (FAIL)'}`,
    );
  }
  console.log(` Clean unregister check (DB/API): sseClients=${serverClients}`);
  console.log('====================================================\n');

  if (
    latencies.length === args.clients &&
    maxLat !== null &&
    maxLat <= 2000 &&
    serverClients === 0
  ) {
    console.log(
      `Result: PASS (All ${args.clients} clients sustained stream, received fan-out within 2s, and unregistered cleanly).`,
    );
    process.exit(0);
  } else {
    console.log('Result: PARTIAL/FAIL');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal load test error:', err);
  process.exit(2);
});

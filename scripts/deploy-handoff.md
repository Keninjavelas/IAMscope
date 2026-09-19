# Phase 12 deployment handoff

Everything that can be done without dashboard access is done. This file is the executable
remainder: the steps that need an Atlas / Render / Vercel account, in the order that keeps
failures localised to one layer.

Run the steps in order. Do not skip step 5 — it is the go/no-go.

---

## 1. Pre-conditions (verify before starting)

All of these are true as of the last verification run. Re-check the gates, since the
handoff is only valid against a green build:

```powershell
npm run typecheck; npm run lint; npm run format:check; npm test; npm run build
```

| Check                  | Expected                                                                |
| ---------------------- | ----------------------------------------------------------------------- |
| All gates above        | exit 0                                                                  |
| `npm test`             | 147 backend + 46 frontend                                               |
| `npm run smoke`        | 57/57 checks, `seed ran cleanly exit=0`                                 |
| `render.yaml` location | repo root (not `backend/`)                                              |
| `render.yaml` region   | `oregon`                                                                |
| `render.yaml`          | sets `COOKIE_SAMESITE=lax`, `SESSION_IDLE_MINUTES=720`                  |
| `render.yaml`          | does **not** set `APP_VERSION` (derived from `package.json`)            |
| `frontend/vercel.json` | rewrite target is the placeholder `https://REPLACE-WITH-RENDER-URL/...` |
| `.dockerignore`        | present at root, `backend/`, `frontend/`                                |

`APP_VERSION` is deliberately unset in `render.yaml`. `backend/src/env.ts` imports
`../../package.json` and uses its `version`, so `/api/health` and every log line follow the
package manifest automatically. Bump the version in `package.json` when tagging a release.

---

## 2. Atlas (dashboard)

1. Create an **M0** cluster in **`us-west-2`**. This must match the Render region
   (`render.yaml` pins `oregon`); the API makes several round trips per request, so a
   cross-region hop is felt directly.
2. Create two database users, scoped to one database each — no cluster admin:
   - `iamscope_identity_rw` → `readWrite` on `iamscope_identity`
   - `iamscope_data_rw` → `readWrite` on `iamscope_data`
3. Network access: `0.0.0.0/0`. Render's free tier has no static egress IPs, so there is no
   narrower option. Record this as D18 with the per-user scoping as the mitigation.
4. Test **both** strings from a local `mongosh` before touching Render:

   ```powershell
   mongosh "mongodb+srv://<identity-user>:<pass>@<host>/iamscope_identity" --eval "db.runCommand({ping:1})"
   mongosh "mongodb+srv://<data-user>:<pass>@<host>/iamscope_data" --eval "db.runCommand({ping:1})"
   ```

   The cluster must be a replica set — Atlas always is — because the backend uses change
   streams. A standalone `mongod` will not work.

---

## 3. Render (dashboard)

1. New **Web Service** from the repo. Name it **exactly** `iamscope-api`.
   - The Vercel rewrite target depends on this hostname. If Render appends a suffix
     (`iamscope-api-xxxx.onrender.com` because the name is taken), step 4 must use the real
     hostname instead of the name-derived one.
2. Service root: **repo root**, not `backend/`. `render.yaml` uses `rootDir: .` and builds
   the shared packages before the backend.
3. Build command and start command: whatever `render.yaml` specifies
   (`node backend/dist/index.js`). If you create the service manually instead of via
   Blueprint, copy them from `render.yaml` verbatim.
4. Health check path: `/api/health`.
5. Environment variables — `render.yaml` declares **10**; `backend/src/env.ts` reads **11**,
   the eleventh being `APP_VERSION`, which is derived from `package.json` (D15) and must
   **not** be set:
   `NODE_ENV=production`, `PORT`, `MONGO_IDENTITY_URL`, `MONGO_DATA_URL`, `CORS_ORIGIN`,
   `SESSION_SECRET`, `CSRF_SECRET`, `LOG_LEVEL=info`, `COOKIE_SAMESITE=lax`,
   `SESSION_IDLE_MINUTES=720`. Do not add `APP_VERSION`.
   Generate the two secrets with Node — PowerShell 5.1 has no `openssl`:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
   ```

   Each must be 16+ characters or the backend refuses to boot in production.
   `CORS_ORIGIN` can be a placeholder for now; it is corrected in step 4.

6. Deploy, then copy the URL and **confirm it has no suffix**:

   ```powershell
   curl.exe -s https://<render-url>/api/health
   ```

   Expect `{"data":{"status":"ok",...}}`. Note `version` — it should match `package.json`.

---

## 4. Replace the rewrite placeholder, then deploy Vercel

Do the `vercel.json` edit **before** the first Vercel deploy. Vite bakes `VITE_API_URL` at
build time, and the rewrite is what makes every call same-origin.

1. Edit `frontend/vercel.json`: replace `https://REPLACE-WITH-RENDER-URL` with the real
   Render hostname from step 3. Commit.
2. New Vercel project from the repo, root `frontend/`, framework **Vite**, output `dist`.
3. `VITE_API_URL`: **delete the variable if it exists.** Empty is correct — the rewrite
   handles routing. An absolute value here makes every call cross-origin and, with
   `COOKIE_SAMESITE=lax`, the browser stops sending the session cookie: login appears to
   succeed and every later request 401s.
4. Deploy, then copy the production URL.
5. Set Render's `CORS_ORIGIN` to that exact production URL and redeploy Render. Preview
   deployments get different hostnames and will not be in the allowlist — only production
   matters.

---

## 5. Seed, then run the gate (go/no-go)

The seed must run before `deploy:check`, which logs in as the demo owner.

```powershell
# Render shell
node backend/dist/seed.js
```

It exits non-zero with the real error on failure rather than hanging.

### 5a. Render alone — localises an SSE failure to Render

`deploy:check` authenticates by logging in **directly against the API**, so it does not need
a deployed frontend and does not need you to hand-copy a session cookie. That means the
Render-only gate is possible before Vercel exists:

```powershell
npm run deploy:check --api https://<render-url>
```

This is the check the plan could not previously express. If the SSE assertions fail here,
the problem is Render's proxy alone. If they pass here and fail in 5b, the problem is
Vercel's edge — a different fix.

### 5b. Through both proxies

```powershell
npm run deploy:check --api https://<render-url> --web https://<vercel-url>
```

`deploy-check` also asserts the session cookie's `httpOnly` / `Secure` / `SameSite`
attributes, the CSRF bootstrap, the read paths, evaluate, escalation, timeline, and
`x-accel-buffering: no`. It prints a pass count and exits non-zero on any failure.

---

## 6. SSE escalation ladder

Test **from a browser**, not curl — some proxies behave differently on a real
`EventSource`. Two tabs, same org, mutate in one, watch the other.

1. **Shipped:** 10s heartbeat (`SSE_HEARTBEAT_SECONDS` in `backend/src/services/sse.ts`),
   down from 20s. The interval is advertised to clients in the `hello` frame, so no frontend
   change is needed. Harmless even if 20s would have worked.
2. **If Vercel buffers anyway → Fallback B:** a short-lived HMAC token. Implemented and
   verified at the transport layer; only the Vercel flag flip remains.
   `POST /api/events/token` (same-origin, cookie-authenticated) mints a **5-minute** (300s)
   signed `{userId, orgId, sessionId, exp}` with `SESSION_SECRET` (D21) and stores nothing.
   `sessionId` is in the payload because the token is **not** a session bypass:
   `GET /api/events?token=` resolves that session through `decideSessionState()` — honouring
   `SESSION_IDLE_MINUTES` and `revokedAt` — and slides `lastSeenAt` via `activateSession()`,
   the same call the cookie path uses (D22). The stream opens with
   `Access-Control-Allow-Credentials: false`, and with `Access-Control-Allow-Origin` set to
   the request origin only when that origin is in `env.CORS_ORIGINS`. The frontend mints a
   token and opens an `EventSource` straight at Render.
   The mint route is cookie-authenticated and deliberately **not** in `PRE_SESSION_PATHS`
   (`backend/src/auth/csrf.ts`), so it requires an `X-CSRF-Token` header matching the
   `iamscope_csrf` cookie; omitting it is rejected `403 CSRF_FAILED` before `requireAuth`
   runs (D23). **Note:**
   do not shorten the heartbeat past 10s as a first resort — across 50 clients that costs
   real bandwidth and does not help proxies that buffer on content-type rather than on write
   frequency.
3. **Last resort → Fallback C:** 2s polling. Cross-tab updates and tenant-isolation
   behaviour still pass; only the "live" feel degrades.

---

## 7. Keep-warm

Render's free tier idles out. Point cron-job.org at `/api/health` every 10 minutes and
confirm a 200 with `{"data":{"status":"ok",...}}`. Record the measured cold-start latency
after the first warm-up as D17.

---

## 8. Decisions to record once this has actually run

These are deployment facts, not speculations — do not fill them in early:

- **D18** — Atlas network access `0.0.0.0/0`, with per-user credentials scoped to one
  database each and no cluster admin as the mitigation.
- **D19** — SSE or polling through Vercel, **and the verification** (browser DevTools
  observation, `x-accel-buffering: no` present, no lag beyond 2s). If it fell back, what
  failed and at which layer (5a vs 5b).
- **D20** — Keep-warm interval and the measured cold-start latency.

(D15–D17 are already recorded in `DECISIONS.md`: `APP_VERSION` derivation, the rewrite
placeholder, and the 10s heartbeat. They were resolvable without an account.)

Also worth recording: whether the Render hostname needed a suffix, and the final
`CORS_ORIGIN` value.

---

## Still open after Phase 12

Phase 13 (hardening) has not started: security header verification against the deployed
backend, the 50-client SSE load test, `pa11y` on the deployed routes, Lighthouse on `/`,
`/policies`, `/graph`, and the three error-path checks (kill Render, revoke Atlas access,
submit an invalid policy).

# IAMScope

A local-first, multi-tenant IAM policy workbench. Three lenses — **Impact**, **Graph**, and **Timeline** — sit on top of one MongoDB data model, so a policy edit is simultaneously a blast-radius question, a privilege-escalation question, and a point-in-time question.

The authoritative specification is [`Plan.txt`](Plan.txt). It defines the product, the data model, the API surface, the acceptance criteria, and the phase plan. This README covers how to run, test, and deploy what is built.

---

## Repository layout

npm workspaces monorepo. Node **>= 20**.

```
packages/types      Shared wire + domain types (single source of truth for API contracts)
packages/schemas    Zod request/response schemas, shared by backend validation and frontend forms
packages/tokens     Design tokens (colour, spacing, motion, density)
backend             Express 4 + MongoDB API (CommonJS, compiled with tsc)
frontend            React 18 + Vite SPA (Tailwind, TanStack Query, Zustand)
scripts             smoke.mjs (end-to-end acceptance harness), clean.mjs
```

The shared packages are **built before anything else** — `backend` and `frontend` import their emitted `dist/`, so `npm run build:packages` is a prerequisite for typechecking, testing, building, and linting.

---

## Prerequisites

- Node 20+
- Docker (for the local replica-set MongoDB; a standalone `mongod` will **not** work — see below)

The backend relies on **change streams**, so MongoDB must run as a **replica set**. `docker-compose.yml` configures `rs0` and initiates it in its healthcheck.

---

## Local setup

```bash
npm ci
npm run build:packages

# MongoDB replica set on :27017
docker compose up -d mongo

# backend env
cp backend/.env.example backend/.env
```

Then seed and run:

```bash
npm run seed                 # 6 policies, 8 principals, 8 resources, 10 scenarios,
                             # 3 evaluation runs, escalation paths, an audit trail
npm run dev                  # mongo + api (:4000) + web (:3000) via concurrently
```

`npm run dev` fans out to `dev:mongo`, `dev:backend`, `dev:frontend`. To run the API and web against an already-running Mongo: `npm run dev:backend` and `npm run dev:frontend`.

### Seed credentials

The seed is idempotent and safe to re-run. It prints the accounts it created. The password below
is the development default; set `IAM_DEMO_PASSWORD` to a unique random value before seeding a
deployed database. The configured password is never printed by the seed.
Set it before the first seed: rerunning the idempotent seed does not change existing user passwords.

| Role  | Email                  | Password             |
| ----- | ---------------------- | -------------------- |
| Owner | `demo@iamscope.dev`    | `iamscope-demo-2026` |
| Admin | `analyst@iamscope.dev` | `iamscope-demo-2026` |

Org: **Acme Cloud** (`acme-cloud`). In non-production the seed also prints an email-verification token inline, because email delivery is not wired up.

---

## Environment variables

### Backend

Validated once at startup by `backend/src/env.ts` (Zod). Referenced from `backend/.env.example`.

| Variable               | Default                                       | Notes                                                                                             |
| ---------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `NODE_ENV`             | `development`                                 | `development` \| `test` \| `production`                                                           |
| `PORT`                 | `4000`                                        |                                                                                                   |
| `MONGO_IDENTITY_URL`   | `mongodb://localhost:27017/iamscope_identity` | Users, orgs, memberships, sessions, invitations, API keys                                         |
| `MONGO_DATA_URL`       | `mongodb://localhost:27017/iamscope_data`     | Policies, principals, resources, scenarios, runs, audit                                           |
| `CORS_ORIGIN`          | `http://localhost:3000`                       | Comma-separated list of allowed browser origins                                                   |
| `SESSION_SECRET`       | dev value                                     | **Min 16 chars.** Must be set in production                                                       |
| `CSRF_SECRET`          | dev value                                     | **Min 16 chars.** Must be set in production                                                       |
| `LOG_LEVEL`            | `info`                                        | `fatal`…`trace`, or `silent`                                                                      |
| `APP_VERSION`          | `package.json` version                        | Surfaced on `/api/health`. Optional override; leave unset so it cannot drift from `package.json`. |
| `COOKIE_SAMESITE`      | `lax`                                         | `lax` \| `strict` \| `none`                                                                       |
| `SESSION_IDLE_MINUTES` | `0`                                           | `0` disables idle expiry                                                                          |

Two databases, deliberately: **identity** and **data** are separate pools against separate databases, so a tenant-data migration never touches session records.

### Frontend

| Variable       | Default   | Notes                                                                                                                                                 |
| -------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_URL` | _(empty)_ | Empty means "call `/api` on the current origin". Dev uses the Vite proxy; production uses the Vercel rewrite. A bare host is normalised to an origin. |

---

## Commands

| Command                           | What it does                                                  |
| --------------------------------- | ------------------------------------------------------------- |
| `npm run build:packages`          | Compile `packages/*` to `dist/` — prerequisite for everything |
| `npm run build`                   | packages → backend → frontend                                 |
| `npm run typecheck`               | `tsc --noEmit` across packages, backend, frontend             |
| `npm run lint`                    | `eslint . --max-warnings=0`                                   |
| `npm test`                        | packages, then backend suites, then frontend suites           |
| `npm run test:backend`            | Backend unit + integration suites (vitest)                    |
| `npm run seed`                    | Seed the demo org                                             |
| `npm run smoke`                   | End-to-end acceptance run (see below)                         |
| `npm run format` / `format:check` | Prettier                                                      |
| `npm run clean`                   | Remove build output                                           |

### The smoke harness

`scripts/smoke.mjs` is the closest thing to a compliance test for the product. It:

1. boots a throwaway `MongoMemoryReplSet` (real replica set, so change streams work),
2. runs `backend/dist/seed.js` and asserts a clean exit,
3. starts the compiled backend exactly as production would,
4. exercises signup, login, CSRF, orgs, invitations, RBAC, policy/principal/resource/scenario CRUD, evaluation, the Impact diff, Graph escalation traversal, Timeline reconstruction, presence, API keys, and audit — asserting the concrete response shape of each.

It runs against the **compiled** output, so `npm run build` must precede it. Exit code is non-zero unless every check passes.

---

## Deploy

| Piece    | Target           | Config                                                                                                                      |
| -------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Database | MongoDB Atlas M0 | Two databases: `iamscope_identity`, `iamscope_data`. The cluster must be a replica set (Atlas always is) for change streams |
| Backend  | Render           | [`render.yaml`](render.yaml), [`backend/Dockerfile`](backend/Dockerfile)                                                    |
| Frontend | Vercel           | [`frontend/vercel.json`](frontend/vercel.json), [`frontend/Dockerfile`](frontend/Dockerfile)                                |

`frontend/vercel.json` rewrites `/api/*` to the Render origin, so the browser talks to a single origin and the session cookie stays first-party. It also sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and long-lived immutable caching for `/assets/*`.

The production frontend is `https://ia-mscope.vercel.app`. Its `/api/*` rewrite targets `https://iamscope-api.onrender.com/api/*` — see [`frontend/vercel.json`](frontend/vercel.json).

Production requirements:

- Set `SESSION_SECRET` and `CSRF_SECRET` to distinct random values of 16+ characters. The backend refuses to boot in production with the development defaults.
- Set `CORS_ORIGIN` to `https://ia-mscope.vercel.app`.
- **Leave `VITE_API_URL` empty in production.** The rewrite is what makes every call same-origin; pointing it at the Render origin directly would make the session cookie cross-site, and with `COOKIE_SAMESITE=lax` the browser would stop sending it — login would appear to succeed and then every request would 401.
- **Leave `COOKIE_SAMESITE` at `lax`.** `none` would be required only for a cross-origin API, and it makes the session a third-party cookie that Safari's ITP blocks outright.
- **Put the Atlas cluster in the same region as the Render service** (`render.yaml` pins `oregon`, so use Atlas `us-west-2`). This API makes several database round trips per request, so a cross-region hop is felt directly.
- A free-tier Render instance idles out; cron-job.org pings `https://iamscope-api.onrender.com/api/health` to keep it warm.

Verify the deployed stack, rather than a local build, with:

```powershell
npm run deploy:check --api https://iamscope-api.onrender.com --web https://ia-mscope.vercel.app
```

`npm run smoke` cannot do this — it boots its own replica set and backend, so it only ever tests a local build.

### CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs two jobs:

- **quality** — spins up `mongo:7` as a service, then `typecheck` → `lint` → `test` → `build`.
- **a11y** — builds the frontend, serves it, and runs `pa11y-ci` with [`.pa11yci.json`](.pa11yci.json).

---

## Architecture notes

**Two databases, two pools.** `identity` holds users, orgs, memberships, sessions, invitations, and API keys. `data` holds policies, principals, resources, scenarios, evaluation runs, escalation paths, audit events, and presence. Cross-database reads are never implicit — the services layer joins explicitly.

**Tenant isolation is not application-level filtering.** `orgId` is always derived from the session or the API key, never from the body or query string; `rejectPayloadOrgId()` rejects attempts to smuggle it in. Every domain collection is indexed on `orgId` first.

**Versioning is append-only.** A policy edit writes a new `policy_versions` row; it never mutates history. That is what makes the Timeline lens a reconstruction rather than a diff.

**Escalation paths are cached, not derived per request.** They are recomputed when a policy or principal changes and invalidated per originating principal. Cache reads are what make the Graph lens interactive.

**Analytics events are lifecycle events.** A policy mutation fans out to evaluation re-runs and Timeline cache invalidation, so the three lenses never disagree about the current state.

See [`DECISIONS.md`](DECISIONS.md) for the judgement calls behind these.

# Decisions

Judgement calls made where the specification (`Plan.txt`) was silent or where two parts of the system disagreed. Each entry states the decision, the reasoning, and the alternative that was rejected — so a later reader can tell whether the reasoning still holds.

---

## D1. `data` carries the resource itself, not a named-key wrapper

**Decision.** For any endpoint that returns a single resource, the envelope's `data` **is** that resource:

```jsonc
// GET /api/policies/:id
{ "data": { "id": "…", "name": "…", "currentVersion": 3, … } }
```

Not:

```jsonc
{ "data": { "policy": { "id": "…", … } } }
```

Lists that the frontend declares paginated keep `Paginated<T>` (`{ items, total, page, pageSize }`). Lists the frontend wants whole (`/policies/:id/versions`, `/graph/paths`, `/graph/refresh`, `/orgs`, `/presence`, `/auth/sessions`, `/orgs/:id/api-keys`, `/orgs/:id/invitations`) return a bare array.

**Why.** The backend and the frontend had drifted apart: the backend wrapped responses in named keys while the frontend consumed them directly (`api.get<Policy>('/policies/:id')` → `policy.currentVersion`) in roughly seventy call sites, and `scripts/smoke.mjs` — the Plan §22.4 acceptance harness — asserted the unwrapped shape. `api.get<T>` returns `envelope.data`, so the wrapper was invisible to TypeScript and produced `undefined` at runtime on every detail page, the evaluate page, the API-key page, the Timeline, and the Graph.

Unwrapping the backend is one layer of change (~30 handlers). The alternative — rewriting seventy frontend call sites to read `.policy`, `.state`, `.presence`, `.apiKey`, `.org`, `.outcome`… — would have been larger, would have left the smoke harness failing, and would have contradicted the already-correct `Paginated<T>` list endpoints.

**Rejected alternative.** Keeping the wrappers and adding a frontend unwrapping layer. Rejected because it hides the contract in plumbing rather than stating it, and because it would still have failed the acceptance harness.

**Consequence.** `POST /evaluate` returns the `EvaluationOutcome` at top level with the persisted run alongside it (`{ …outcome, run }`), so `data.result` / `data.trace` work directly. `POST /policies/:id/restore` returns the `Policy` plus `restoredFrom`.

---

## D2. `POST /evaluate` returns 200, not 201

**Decision.** `POST /api/evaluate` responds `200`, even when `persist` writes an `evaluation_runs` row.

**Why.** It is an evaluation — a computation over current state — not the creation of an addressable resource. The run it may persist is a side effect, reported in `data.run`. 201 with a `Location` header would misdescribe the endpoint and would be wrong for the `persist: false` path, which creates nothing; the two paths should not differ in status.

**Rejected alternative.** 201 when persisted, 200 when not. Rejected because it makes the status code depend on a body flag the caller already knows, for no benefit.

---

## D3. Superseded policy versions are upserted with `$setOnInsert`, never `replaceOne`

**Decision.** `computeEscalationPaths()` writes escalation paths with `updateOne` + `$set` of the mutable fields + `$setOnInsert: { _id }`, upserting on `(orgId, fromPrincipalArn, toPrincipalArn)`.

**Why.** The previous `replaceOne` + `upsert: true` supplied a freshly generated `_id` in the replacement document. When the pair already existed, MongoDB rejected the write: _"After applying the update, the (immutable) field `_id` was found to have been altered"_ (`MongoBulkWriteError`). That single fault broke three things at once: the seed aborted partway, `POST /api/graph/escalation` returned 500 whenever the cache had been invalidated, and any policy mutation left the Graph lens unable to recompute.

`$setOnInsert` only applies on the insert branch, so an existing path keeps its `_id` while a new one is created with the id already handed back to the caller in the returned path list. No extra round trip is needed to learn the ids of newly inserted rows.

**Rejected alternative.** Dropping `_id` from the replacement and re-reading the collection to discover the generated ids. Rejected as an unnecessary extra query, and it would not have fixed the underlying immutability violation cleanly.

---

## D4. `GET /api/auth/csrf` exists and issues the double-submit cookie

**Decision.** A public `GET /api/auth/csrf` issues (or re-issues) the non-httpOnly `iamscope_csrf` cookie and returns the token.

**Why.** Double-submit CSRF requires the client to hold a token before its first mutating request. `frontend/src/api/client.ts` calls `ensureCsrfToken()` → `GET /api/auth/csrf` before the first mutation, and the acceptance harness asserts the cookie is issued — but the route was never registered. Login and signup happened to work because session creation issues a CSRF cookie as a side effect, which is why the gap was easy to miss.

The token grants no authority on its own; it only has to match the `X-CSRF-Token` header, so issuing it to an unauthenticated caller is safe. `GET` is a safe method, so the CSRF middleware already exempts it.

---

## D5. The seed closes both connection pools in a `finally` block

**Decision.** `backend/src/seed.ts` releases `identity` and `data` in a `finally`, so it exits whether or not seeding succeeded.

**Why.** The pools are only closed on the success path previously. If seeding threw, both Mongo clients kept the event loop alive and the process hung indefinitely — the acceptance harness could only report `seed ran cleanly exit=timeout`, which masked the real fault (D3) and made the failure look like a harness problem. A failing seed must exit non-zero and say why.

---

## D6. `permissions` is a single object, not an array

**Decision.** `AuthMeResponse.permissions` is one `Permission` object for the caller's role. The integration suite asserted `permissions[0].canAdmin`.

**Why.** The shared contract (`packages/types/src/identity.ts`) and `permissionsForRole()` both define an object. The test was the only place treating it as a list, and it was the sole failing test in the suite. The assertion was corrected rather than the type.

---

## D7. ESLint uses an explicit `project` list, not the TS project service

**Decision.** `eslint.config.mjs` sets `parserOptions.project` to a fixed list of seven tsconfigs, including a lint-only `tsconfig.tools.json` for build tooling and `backend/tsconfig.test.json` for the suites.

**Why.** The backend must keep `backend/tsconfig.json` emit-clean, so it excludes `tests/**` and `**/*.test.ts` — the suites live outside `rootDir`. That left twelve files that no project covered, and ESLint could not parse them at all.

Three approaches were tried and rejected on evidence:

- **`projectService: true`** — only discovers files named `tsconfig.json`, so the suites and tooling configs stayed invisible.
- **`projectService.defaultProject`** — does not apply to files that are _excluded by_ an ancestor project's tsconfig, which is exactly the suite case. It left all twelve failing.
- **`allowDefaultProject`** — rejects `**` globs outright (the nested `backend/tests/**` pattern broke _every_ file in the repo with 227 parse errors), and even with single-level globs the matched files are linted **without type information**. Every import became `any`, producing 445 false-positive `no-unsafe-*` errors. The option's own error message warns it is only appropriate for a handful of files.

The explicit list gives all seven projects real type information. `backend/tsconfig.test.json` gained `vitest.config.ts` in its `include` for the same reason.

**Cost.** All listed projects are loaded on every lint run, which is slower than the project service. Accepted: correctness of the lint result matters more here than lint wall-clock time.

---

## D8. `no-unsafe-*` is off for test files only

**Decision.** The existing test-file rule block also disables `no-unsafe-assignment`, `no-unsafe-argument`, `no-unsafe-call`, `no-unsafe-member-access`, and `no-unsafe-return`.

**Why.** Supertest declares `Response.body` as `any`. Asserting a response shape is the entire purpose of these suites, so every `expect(res.body.data.x)` is by definition an unsafe member access — 69 of them in `api.test.ts` alone. Keeping the rules on would mean wrapping every assertion in a cast, adding ceremony without adding safety: the value under test is inherently untyped. The project already relaxes `no-non-null-assertion` and `no-console` for tests, so this extends an established convention rather than introducing a new one.

**Scope.** Applies to `**/*.test.ts`, `**/*.test.tsx`, `**/seed.ts`, `**/vitest.config.ts`. Application code is unaffected.

---

## D9. Two rules are disabled inside the jsdom setup file

**Decision.** `frontend/src/test/setup.ts` carries a file-level disable for `no-unnecessary-condition` and `no-empty-function`, with the reasoning inline.

**Why.** Both rules are wrong there by construction. TypeScript's DOM lib declares `matchMedia`, `ResizeObserver`, `IntersectionObserver`, `scrollIntoView`, and the pointer-capture methods unconditionally, so the `if (!window.matchMedia)` guards read as always-falsy — but they exist precisely because the _runtime_ may not have them, and which jsdom version is installed is not something the type system knows. Likewise, `observe` / `unobserve` / `disconnect` being no-ops is the entire point of a stub.

A file-level disable (rather than per-line) keeps the rationale in one place where it can be read alongside the code it applies to.

---

## D10. `JSX.Element` resolves through an explicit `react` import

**Decision.** Files that annotate a return type as `JSX.Element` import the namespace: `import type { JSX } from 'react'`. The annotations themselves are unchanged.

**Why.** `@types/react` 18.3 marks the **global** `JSX` namespace `@deprecated` in favour of `React.JSX`, and `@typescript-eslint/no-deprecated` reports all 121 usages. Importing `JSX` from `react` binds the identifier to `React.JSX`, which is not deprecated.

**Rejected alternative.** Rewriting every annotation to `ReactElement`. That is a larger diff, changes the declared type, and has to be re-derived at each site; a single import line per file fixes the deprecation at its root. Per-line `eslint-disable` comments were rejected as noise across 86 files.

Applied with a one-off codemod (`scripts/_codemod-jsx.mjs`, since removed).

---

## D11. The API client throws on a missing `data` body instead of casting it away

**Decision.** `apiRequest` validates that a successful response actually carries `data` and throws `ApiError('EMPTY_RESPONSE')` otherwise. `ApiResponse<T>.data` stays `T | null` in the shared contract.

**Why.** `ApiResponse<T>.data` is `T | null`, and the client used to return `envelope.data as T`. That single cast was the client lying about its own contract, and it is the root cause of **25 of the 63** `no-unnecessary-condition` errors: every `result?.field` downstream looked redundant to the type checker (because `T` is non-nullable) while remaining a real runtime hazard.

Fixing it at the boundary rather than at 70 call sites is the point. Every route answers through `sendData`, and there are **no 204/205 responses** anywhere in the backend (verified by grep), so a 2xx without a body is a malformed response, not an empty one. The 15 `api.delete<null>(...)` call sites are safe: those endpoints return `{ success: true, ... }` objects, so their `data` is non-null at runtime and the guard does not fire.

**Rejected alternative.** Widening the signature to `T | undefined`. That pushes nullability into every call site and makes the UI defensive about a case the API contract says cannot happen.

**Rejected alternative.** Adding `EMPTY_RESPONSE` to the shared `ApiErrorCode` union. It forced `backend/src/lib/errors.ts`'s `Record<ApiErrorCode, number>` status map to carry a code the server can never emit. `ApiError.code` is already `ApiErrorCode | (string & {})`, which is the intended escape hatch for client-only codes.

---

## D12. Dead `?? {}` fallbacks were removed rather than replaced

**Decision.** `validateQuery` and `validateParams` pass `req.query` / `req.params` straight to the schema parser. The `?? {}` fallbacks are gone.

**Why.** Express 4 types both as non-nullable (`ParsedQs` / `ParamsDictionary`), so the fallbacks were unreachable. Zod normalisation already happens at route entry through the `validateQuery` / `validateBody` / `validateParams` middleware — for example `policiesRouter.get('/', validateQuery(listPoliciesQuerySchema), ...)` — so there was never a case where the handler saw an unparsed value. Removing the fallback tightened the boundary without moving any work.

The same reasoning removed the unreachable `body !== null` / `query !== null` halves of the `orgId` smuggling guards in `rejectPayloadOrgId`: the values are `Record<string, unknown> | undefined`, so only the `undefined` half is reachable.

---

## D13. Type-assertion instead of a lying signature for `JSON.stringify`

**Decision.** In `stringifyLeaf` (`JsonDiff.tsx`) and `serialiseJson` (`format.ts`), the result of `JSON.stringify` is asserted as `string | undefined` before being narrowed.

**Why.** TypeScript's DOM lib declares `JSON.stringify(value: any): string`, but it genuinely returns `undefined` for functions and symbols. The original defensive fallbacks (`?? String(value)`, `?? ''`) were _correct behaviour_ the type system called dead code — the §1.6 case from the closure plan.

`?? String(value)` was also subtly wrong: it would render an entire function body into a diff view. The assertion restores the real signature, which makes the `undefined` branch reachable and honest, and lets the fallback say what it means (`[function]` / `[symbol]`) instead of stringifying the value.

---

## D14. `navigator.clipboard` is used without an optional chain

**Decision.** `navigator.clipboard.writeText(...)` is called directly in `ApiKeysPage` and `InvitationsPage`; the `?.` is gone.

**Why.** The DOM types declare `navigator.clipboard` as non-optional, and it is present on every **secure context**. This app runs only on `https://` in production and `localhost` in development — both secure contexts — and it depends on secure-context features regardless (session cookies, SSE). The `?.` was defensive against a condition that cannot arise in any configuration the app supports.

Recorded here because it is the one place in this closure where a live guard was removed rather than a dead one, so a future reader can revisit it if the app ever needs to run on an insecure origin.

---

## Lint closure

`npm run lint` now passes with `--max-warnings=0`. The 116 remaining errors were closed site by site; no rule was disabled or downgraded to get there. Breakdown of how they were cleared:

| Count | Rule                             | How                                                                                                                                                   |
| ----- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 51    | `no-unnecessary-condition`       | D11 (client contract) + D12 (dead `??`/null checks) + removing genuinely unreachable guards that TypeScript's aliased-condition narrowing proves dead |
| 7     | `prefer-optional-chain`          | `x === null \|\| x.y` → `x?.y`                                                                                                                        |
| 4     | `no-unsafe-return`               | Annotated `unknown` callback params / narrowed `Array.isArray` results instead of returning `any`                                                     |
| 2     | `no-unnecessary-type-parameters` | Dropped type params used once (`validateBody`, `removeFromPages`); deleted `replaceInPages`, which had no callers                                     |
| 2     | `no-deprecated`                  | D10 (JSX namespace) + `tseslint.config()` → plain array export; `navigator.platform` → `navigator.userAgent`                                          |
| 2     | `no-base-to-string`              | D13                                                                                                                                                   |
| 2     | `react-hooks/exhaustive-deps`    | Memoised `runItems` in `ImpactPage`, whose `?? []` literal was a fresh array on every render                                                          |
| 1     | `prefer-nullish-coalescing`      | `x === null ? 'none' : x` → `x ?? 'none'`                                                                                                             |
| 1     | `no-empty-function`              | jsdom stub returns `() => undefined`                                                                                                                  |
| 1     | `only-throw-error`               | Constrained `unwrap<T, E extends Error>`                                                                                                              |
| 1     | `return-await`                   | Added the missing `await` in `transactions.ts` (see below)                                                                                            |
| 1     | `no-unsafe-assignment`           | `as unknown` at the zod boundary                                                                                                                      |

Two of these were **latent bugs, not lint noise**:

- `backend/src/db/transactions.ts` returned `work(undefined)` from a `catch` without `await`. The `finally` therefore ended the Mongo session while the fallback work was still in flight. `return-await` caught a real lifetime bug in the transaction fallback path.
- `ResourcePicker`'s account field used `resource.accountId ?? parts.accountId ?? '—'` where `parts.accountId` is a non-nullable `string`, so the em-dash fallback could never fire for an empty account segment. It is now an explicit empty-string check.

## Gates

All five closure gates pass:

| Gate                                | Result                    |
| ----------------------------------- | ------------------------- |
| `npm run typecheck`                 | pass                      |
| `npm run lint` (`--max-warnings=0`) | pass                      |
| `npm run format:check`              | pass                      |
| `npm test`                          | 117 backend + 46 frontend |
| `npm run build`                     | pass                      |
| `npm run smoke`                     | 57/57, seed exit 0        |

---

## D15. `APP_VERSION` is derived from `package.json`, not set per environment

**Decision.** `backend/src/env.ts` imports the root `package.json` and uses its `version` as the zod default for `APP_VERSION`. The variable is not set in `render.yaml`, and `.env.example` documents it as an optional override that should normally be left unset.

**Why.** `APP_VERSION` feeds `/api/health` and every log line. Setting it in a deploy config as well as in `package.json` created two sources of truth that could disagree — they already had, with `v1.0.0` in the deploy config against `1.0.0` in the manifest. Deriving it removes the drift entirely: bump the manifest, and both the endpoint and the logs follow.

**Verified, not assumed.** `resolveJsonModule` and `esModuleInterop` are already on in `tsconfig.base.json`, so the user's precondition for this option held. The remaining risk was `backend/tsconfig.json`'s `rootDir: "src"`, since the root `package.json` sits outside it and TypeScript normally reports TS6059 for a program file outside `rootDir`. Empirically it does not: `typecheck:backend` and `build:backend` both exit 0 and no JSON is emitted into `dist/`. The emitted `require("../../package.json")` resolves from `backend/dist/env.js` to the repo root, which is present at runtime because Render builds from `rootDir: .`. Both paths checked before adopting this.

**Trade accepted.** The compiled backend now depends on the root `package.json` existing at runtime. That holds for the Render service (repo-root build) and for `docker-compose`, but it would break a deployment that ships only `backend/dist`.

---

## D16. The Vercel rewrite ships as a loud placeholder, and Vercel deploy is gated on the Render hostname

**Decision.** `frontend/vercel.json` sets its rewrite destination to `https://REPLACE-WITH-RENDER-URL/api/$1`. The real hostname is substituted immediately before the first Vercel deploy, which is gated on having created the Render service and confirmed its hostname is unsuffixed.

**Why.** The file previously hardcoded `https://iamscope-api.onrender.com`, which is a guess. If Render appends a suffix because the name is taken, that rewrite 404s — and a 404 from the rewrite looks like a broken API rather than a misconfigured hostname. A destination containing `REPLACE-WITH-RENDER-URL` cannot resolve and cannot be mistaken for a working value.

**Ordering matters.** Vite bakes configuration at build time, so the rewrite must be correct before the first Vercel build. `deploy-check` also asserts that the frontend's `/api` rewrite reaches the API, so a forgotten substitution fails a check rather than passing silently.

---

## D17. SSE heartbeat is 10s, ahead of the two-proxy reality

**Decision.** `SSE_HEARTBEAT_SECONDS` is 10, down from 20.

**Why.** In production the event stream crosses **two** proxies — Vercel's edge and Render's — not the one the original plan accounted for. Some proxies only flush a buffered `text/event-stream` response when further bytes arrive, so a more frequent heartbeat buys headroom against exactly the failure mode that is hardest to diagnose.

**Cost is negligible and the change is transparent.** The frame is ~50 bytes per client, and the interval is advertised to clients in the `hello` frame (`heartbeatSeconds`), so no frontend change was needed. Nothing asserted the literal 20.

**Explicitly not the next step.** Shortening the heartbeat further is not the fallback if this does not hold — past 10s it costs real bandwidth across 50 clients and does not help a proxy that buffers on content type rather than on write frequency. The next step is a short-lived HMAC token on a direct-to-Render stream, and polling only after that. See `scripts/deploy-handoff.md` §6.

---

---

## D21. Event tokens reuse `SESSION_SECRET` for their HMAC

**Decision.** `mintEventToken` signs with `env.SESSION_SECRET`, the same secret behind session cookies and CSRF. Rotating it invalidates outstanding event tokens and every live session simultaneously.

**Why.** They are the same trust domain — an event token is only ever a transport for an existing session's identity, and it expires in 5 minutes. A separate secret would buy nothing but independent rotation, which is not a requirement here, and it would add a second secret to leak. Coupling them means exactly one secret governs authentication.

**Status.** Wired and live as of the `POST /api/events/token` route, but not yet consumed: no frontend build sets `VITE_SSE_MODE=token`, so the route is reachable and inert.

---

## D22. A token is not a session bypass — it resolves through the same validation as the cookie

**Decision.** `sessionFromEventToken` verifies the HMAC, then resolves the session via `validateSessionById`, which shares `activateSession` with the cookie path.

**Why.** Two properties had to be guaranteed, and the second was nearly missed:

1. **The check.** Revocation, expiry and idleness must be applied identically. A hand-rolled `revokedAt: null, expiresAt: { $gt: now }` filter — the obvious implementation — would have silently ignored `SESSION_IDLE_MINUTES`, making token mode an auth bypass that cookie mode masks.
2. **The side effect.** The cookie path does not merely _decide_ liveness; it also **slides `lastSeenAt` forward** (at most once a minute). A token path that only decided would produce sessions that expire after 12h of _tab-open_ time instead of 12h of _inactivity_, and the failure would be invisible in every test that keeps the tab active — surfacing in production, weeks later.

`activateSession` is therefore the single place where "check + touch" lives, and no transport may re-implement either half. `auth.test.ts` pins both, including the strict-`>` boundary (exactly at the limit is still `active`) and the persistence of the slide.

---

## D23. `POST /api/events/token` is unrate-limited in v1

**Decision.** The mint route is authenticated and stateless, and is not behind a rate limiter.

**Why.** Minting requires a live session cookie, writes nothing, and its only cost is an HMAC over a small payload. The abuse surface is a logged-in user burning their own CPU. If that ever matters, the existing rate-limit middleware applies to this route like any other — deferred to Phase 13 rather than guessed at now.

**Not rate-limited does not mean unauthenticated.** It is a cookie-authenticated `POST`, and `/events/token` is deliberately **not** in `PRE_SESSION_PATHS` (`auth/csrf.ts`), so it requires an `X-CSRF-Token` header matching the `iamscope_csrf` cookie. A client omitting it is rejected `403 CSRF_FAILED` **before `requireAuth` runs**. This is recorded because the failure mode misleads — it looks like an auth bug in a route that works. `GET /api/events?token=` is a safe method, so `shouldSkipCsrf` skips the check and the stream needs no header.

---

## D24. Token-mode SSE puts the token in the query string — accepted

**Decision.** In token mode the credential travels as `?token=…` on the `EventSource` URL. Both Render's access logs and Vercel's edge logs capture query strings by default. Accepted for v1 at a 5-minute TTL rather than moved into a request body.

**Why.** An `EventSource` cannot set headers or send a body, so the query string is the only place a browser-native SSE connection can carry a credential. Closing the exposure would mean abandoning `EventSource` for `fetch` + `ReadableStream` and hand-parsing the SSE frames — a real change, and one to make because a security review asked for it, not pre-emptively.

**What the exposure actually is.** Anyone with log-aggregation access can replay the token within its 5-minute window to open a **read-only, org-scoped** stream. That is worth stating precisely, because it is broader than "a stream exists": the victim sees which documents are changing in a specific organisation, and when. It is a disclosure of activity metadata for one org, not write access, and it expires.

**Bounded by.** 5-minute TTL; the token is useless once the connection is open (the stream does not re-authenticate); `POST /api/events/token` still requires a live session cookie, so the window opens only for an already-authenticated user; and log access already implies elevated trust. Rotation of `SESSION_SECRET` invalidates outstanding tokens (D21).

**Revisit if** a review flags credentials-in-URLs repo-wide, or if log retention grows. The fix is the `fetch` + `ReadableStream` variant, with the token in a `POST` body, which removes the URL from the equation entirely.

---

Phase 12 (deployment execution) and Phase 13 (hardening) remain outstanding; `scripts/deploy-handoff.md` is the runbook for the former.

The three decisions above (D15–D17) were resolvable without an account. Three more are **not**, because they are deployment facts rather than design choices: the Atlas network-access scoping, whether SSE survived both proxies or fell back to polling, and the measured keep-warm latency. They are booked as **D18–D20** in the handoff document (§8) and must stay empty until those phases actually run.

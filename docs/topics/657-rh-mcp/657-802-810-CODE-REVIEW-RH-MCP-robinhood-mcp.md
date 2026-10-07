**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Production RH API  
**Thread Slug:** production-rh-api  
**Issue:** #802  
**Thread Parent:** #795  
**Topic Parent:** #657  
**Task:** #810  
**Domain:** RH-MCP  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

# Code Review — BE-CONFIG: production rhApi routing + deploy + prod smoke

## Mechanism change (user-approved)

The task's original mechanism — a `firebase.json` Hosting rewrite of
`/api/rh/**` → `rhApi` — is inert for savanttrader.com because the domain is
served by Firebase App Hosting (`rel-str--rel-str.us-central1.hosted.app`,
Cloud Run + envoy), which does not consume `firebase.json` hosting rewrites
and exposes no rewrite surface in `apphosting.yaml`. Same-origin `/api/rh/**`
on the prod domain is unreachable without enabling SSR.

Approved mechanism: **CORS + absolute function URL**.

- `rhApi` mounts the shared `ST_ALLOWED_ORIGINS` cors middleware with a 24h
  preflight cache (`maxAge: 86400`) — deployed + probed.
- FE `environment.rhApiBaseUrl`: `/api/rh` dev (proxy unchanged), the
  cloudfunctions.net `/rhApi/api/rh` URL in prod.
- `RobinhoodMcpObservationService` attaches `Authorization: Bearer
  <idToken>` on every call (FE-1 absorbed from #812 — required for the
  authed smoke AC; #812 shrinks to reauth-UX only).
- `firebase.json` rewrite reverted.

## Axes

### Standards

- **major → fixed** — CORS allowlist diverged from `ST_ALLOWED_ORIGINS`
  (`st-cloud-function/cors.ts`) and `OPTIONS_STRATEGY_ALLOWED_ORIGINS`:
  missing `rel-str.web.app`/`rel-str--rel-str.web.app` (rel-str.web.app
  verified still serving, HTTP 200) and localhost debug origins. Fixed by
  importing `ST_ALLOWED_ORIGINS` — third copy eliminated, not duplicated.
- **minor → fixed** — dead `timeout` import removed.
- **nit → fixed** — `rhApiBaseUrl` indentation aligned to sibling fields.
- **nit (noted)** — mixed constructor/`inject()` DI styles; harmless.
- Verified correct: `getIdToken` signature matches `run.service.ts`
  precedent; prod URL path composes to `/api/rh/*` matching the deployed
  route table; local dev proxy path intact; `Auth` provided app-wide;
  spec conventions match AGENTS.md async-flush guidance; no secrets added.

### Spec

All ACs accounted for under the approved pivot:

| AC | Status |
|---|---|
| savanttrader.com/api/rh/tools no longer 404s | **Superseded** — unreachable by design; traffic goes cross-origin to the function URL. Issue comment documents the rewording. |
| unauth → 401 | Met + live-verified (401 carries ACAO). |
| owner authed → 200 tool list | Met (verified in #807 live run; unchanged). |
| portfolio page loads real data in prod | **Pending prod rollout** — FE change ships via the GitHub/App Hosting pipeline on the user's push. |

Test-plan coverage landed: 13 cloud-api route/auth tests + 6 new FE specs.
Deferred and tracked elsewhere: batch endpoint (#813), reauth UX (#812),
minInstances (#808).

### Thermo-nuclear

- **major → fixed** — same CORS divergence (M1 above).
- **major → fixed** — onRequest `cors` shorthand cannot set `maxAge`; every
  non-simple request (all carry `Authorization`) would pay an OPTIONS
  roundtrip + function invocation. Now mounts `cors({origin, maxAge:86400})`
  inside the handler — preflights are browser-cacheable for 24h. Live probe
  confirms `Access-Control-Max-Age: 86400`.
- **minor → fixed** — `await authHeaders()` hoisted out of the options
  object into a statement (readability; semantics were correct).
- **minor → fixed** — `inject(Auth, { optional: true })` so non-auth test
  hosts don't explode at construction.
- **minor → fixed** — spec gaps: added `getIdToken` rejection (no request
  dispatched) and GET-with-token cases; 6 specs total.
- **minor → noted** — reauth `message` field added to the FE return type;
  surfacing the actionable runbook message (and fixing the pre-call
  snackbar text in prod) is #812's remaining scope.
- **minor → noted** — hardcoded prod function URL follows `run.service.ts`
  precedent; a function rename would 404 the FE. Accepted.
- Verified clean: cors middleware answers preflights before auth/dispatch;
  disallowed origins get no ACAO but still execute server-side (CORS is not
  the security boundary — owner-token authz is); no `withCredentials`.

## Test results

- `functions` rh-agent-mcp-cloud-api suite: **13/13 pass**; functions build clean.
- New FE spec: **6/6 pass**.
- Full jest suite: **2846 pass, 1 suite fails to compile** —
  `core-routes.spec.ts` references `PAGE_INFO` not yet exported; the spec is
  the user's in-flight test-first WIP for #852 (unrelated files, untouched by
  this task). Not a #810 regression.

## Remediation rounds (converged — "no new findings" achieved)

**Round 2** (Standards re-review of the fixes):

- **high → fixed** — `cors` types as `express.RequestHandler`; the
  `IncomingMessage`/`ServerResponse` args failed `npm run typecheck`
  (esbuild doesn't typecheck, so the gate script would have caught it late).
  Cast via `Parameters<typeof rhApiCors>` — honest: functions-framework IS
  express under the hood.
- **medium → fixed** — cors never calls `next()` on preflights, so the
  Promise-wrapped middleware call never resolved — a pending async frame per
  OPTIONS request. Replaced with the synchronous call + `writableEnded`
  early-return (cors is fully synchronous with static options).
- **low → fixed** — the CORS composition was untested. Extracted
  `applyRhApiCors` as a seam; new `describe('rhApi CORS layer')` mounts the
  exact production composition on a real http.Server and pins preflight
  204/ACAO/max-age/no-dispatch, real-request fallthrough, and
  disallowed-origin behavior.

**Round 3** (final sanity check):

- **minor → fixed** — `cachedHandler ??=` ran before the CORS layer, so bare
  preflights depended on KMS/env provisioning and wasted a cold-start build.
  Reordered: `applyRhApiCors` → `writableEnded` early return → lazy build.

Post-round-3 state: `typecheck` clean, `16/16` cloud-api tests, functions
build clean.

## Verdict

**PASS** — all findings across three rounds remediated and reverified; the
remaining noted items are deferred to tracked tasks (#812/#813/#808).

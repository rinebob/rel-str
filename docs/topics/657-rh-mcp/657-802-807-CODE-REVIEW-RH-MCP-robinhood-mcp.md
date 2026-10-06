**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Production RH API  
**Thread Slug:** production-rh-api  
**Issue:** #802  
**Thread Parent:** #795  
**Topic Parent:** #657  
**Task:** #807  
**Domain:** RH-MCP  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-06  
**Last Updated:** 2026-10-06  

# Code Review — #807: rhApi onRequest — shared dispatch, owner auth, reauth route

Review surface: `api-shared/rh-api-routes.ts` (new), `cloud-api/rh-api.ts`
(new), `local-api/robinhood-observation-api.ts` (refactored onto shared
dispatch), `tools/robinhood-tool-executor.ts` (+connect timeout),
`auth/robinhood-mcp-connection.ts` + `auth/repository-oauth-provider.ts`
(conflict recovery remediation), `functions/src/index.ts` (export), test +
verify wiring. Three review axes run in parallel (Standards, Spec,
Thermo-nuclear); remediation round followed, then live re-verify.

## Standards

Clean overall — no critical or major findings. Auth runs before dispatch,
audit is structural-only (`{tool, category, outcome}`), the `req.body`
pre-parse handling matches the Functions Framework contract, and the local
API is a thin guard+delegate layer over shared dispatch. Minors:

- **`null` JSON body → 500** — `JSON.parse('null')` yielded `parsed = null`,
  then `parsed.toolName` threw → 500. Fixed: object guard → 400.
- **Connect timeout orphans the in-flight connect** — `Promise.race` can't
  cancel; a late-resolving session was never closed. Fixed: the abandoned
  promise now closes the late connection (see Thermo-nuclear).
- **Concurrent warm-instance refresh can CAS-conflict** — same finding as
  thermo-nuclear critical; fixed (below).
- **`/api/rh/**` hosting rewrite not wired** — confirmed in scope for #810;
  the cloudfunctions.net URL is the interim surface.

Nits fixed: `Bearer` scheme match is now case-insensitive (RFC 7235); the
test imports `RhApiAuditEntry` instead of duplicating the type; the stale
"Run the local OAuth bootstrap first" message now names the full cloud
recovery (`bootstrap + upload-rh-credential`).

Nits dispositioned (not fixed): `ownerUid ?? ''` fails closed quietly
(loud throw would just fail differently — ownerUid can never be '' for a
real uid); `readBody`/`match!`/`void mcpServer.connect` cosmetic; the
functions-local `run-all.ts` omits rh-mcp scripts — pre-existing gap this
change follows consistently (root `scripts/verify/run-all.ts` is the
maintained registry); `sendJson` inside the dispatch catch can throw if the
local socket already timed out — dev-only surface, pre-existing exposure.

## Spec

All five acceptance criteria met:

- No/bad token → 401, non-owner → 403, owner → allowed — MET (unit + live).
- Tools list and execution through shared dispatch + cloud repository — MET
  (76 tools live; `get_accounts` succeeded against real KMS credentials).
- Reauth returns structured `REAUTHORIZATION_REQUIRED` — MET.
- Mutation tools pass the same auth path as reads — MET (unit + allowlist).
- Route/method tests pass in-process with fakes — MET.

Deviation dispositioned: IMPL specified `minInstances: 1, concurrency: 8` on
`onRequest`. `concurrency: 8` restored in remediation (bounds the
concurrent-refresh amplification per instance); `minInstances: 1` deferred
to #808, which explicitly owns warm-instance config alongside the session
cache — recorded here as a deviation-by-design, not a drop.

## Thermo-nuclear

One critical, remediated:

- **Critical (fixed):** concurrent tool calls on a warm instance raced the
  rotating refresh token — both loaded the same revision, both refreshed,
  one CAS-store lost. If Robinhood invalidated the discarded rotation, the
  persisted credential could become unusable (violates PRD US-4). Fix:
  `CredentialRevisionConflictError` from `refreshStoredCredential` now
  triggers `provider.reloadBundle()` — if the winner's bundle is fresh it is
  adopted for the session instead of minting a competing rotation; a new
  `fetchFn` seam on `connectLocalRobinhoodMcpSession` makes the path
  testable. Covered by `connect-path refresh adopts the concurrent winner's
  credential on CAS conflict`.

- **Major (fixed):** connect-timeout orphan — `withTimeout` rejected but the
  underlying `connectLocalRobinhoodMcpSession` promise kept running; a late
  success leaked an open MCP session/socket. The abandoned promise now
  closes the connection when it resolves.
- **Major (fixed):** `readBody` destroyed the request socket before the 413
  could be sent — reject now lets the caller write the response.
- **Major (fixed):** `null`/primitive JSON body → 500 → now 400.
- **Minor (fixed):** local API socket timeout (60s) was shorter than the
  worst-case request (30s connect + 45s call) → bumped to 90s.
- **Minor (fixed):** auth rejections were invisible in logs — 401/403 now
  emit `rh_api_auth_reject {reason[, uid]}` (no token material).
- **Minor (fixed):** cold-start config failure could surface as a bare
  crash — unchanged init path now logs via lazy-handler `onAudit` wiring;
  missing `RH_CREDENTIAL_KEY_NAME` still throws loudly on first request.

Dispositioned (not fixed — out of scope or bounded): `verifyIdToken` and
`session.close()` are unbounded (minor; bounding would add cancellation
plumbing for no realistic hang surface); no CORS/OPTIONS handling — the
production surface is the same-origin Hosting rewrite (#810); KMS
permission errors surface as an executor failure envelope rather than HTTP
500 — consistent with the existing `{success:false, category}` contract;
route table rebuilt per request — harmless at this scale; `console.error`
for unhandled route errors — matches the local server's convention.

## Round 2 — re-review of the remediation diff

Both axes re-ran on the remediated surface. Thermo-nuclear verified each
fix under failure conditions:

- Conflict recovery: correct — `reloadBundle()` repopulates the provider
  cache, `provider.tokens()` serves the winner's `access_token`, a
  still-stale winner throws closed (no loop, no expired-token proceed).
- Orphan-close: correct — proven exactly-once across all orderings (orphan
  `.then` runs before the race resolution microtask; `finally` no-ops when
  the timeout won). No leak, no double-close, no unhandled rejection.
- readBody destroy removal: correct — no double-settle, bounded memory,
  no server-level listener accumulation.
- Object guard: correct — null/primitives → 400; arrays pass but collapse
  to `{}` args safely downstream.
- `fetchFn` seam: verified in installed SDK 1.29.0 (`fetchFn ?? fetch`) —
  production path bit-identical when unset.

New round-2 findings, all remediated:

- `reloadBundle()` failure escaped unwrapped → categorized `UNKNOWN`/`MCP`
  instead of `AUTH` — now wrapped in `RobinhoodMcpConnectionError` with the
  classified state.
- `reloadBundle()` left `loaded: true` guarding the stale pre-conflict
  bundle if `load()` rejected — now clears the cache before rethrow.
- `onAuditReject` had no coverage — new test asserts the
  `missing_token`/`invalid_token`/`non_owner` reasons and that token
  material never enters the record; the entry type is exported
  (`RhApiAuthRejectEntry`).
- Message asymmetry in the `openAuthorizationUrl` defensive throw —
  aligned with the rest of the file.

Residual, dispositioned (not fixable within this design):

- **Medium — refresh-then-CAS ordering window:** the CAS conflict is
  detected *after* the loser's token-endpoint POST completes, so if
  Robinhood invalidates all-but-latest rotations on concurrent refreshes,
  the adopted winner's `refresh_token` may already be dead — surfacing as
  `REAUTHORIZATION_REQUIRED` on the *next* refresh instead of this request.
  Fully closing it needs a pre-refresh claim on the credential doc
  (`refreshingRevision` marker CAS'd before the token call) — a possible
  follow-up; whether the window is real depends on Robinhood's
  concurrent-refresh semantics (unverifiable offline — most providers
  honor duplicate refreshes within a grace window or reject the loser
  cleanly). Recorded for the #811 runbook as a known residual; severity is
  bounded to a manual re-auth rather than credential loss.
- **Pre-existing, outside #807 surface:** `RobinhoodMcpSessionManager.
  connect()` (options-strategy-engine) has a TOCTOU double-connect — two
  concurrent `callTool`s can each open a session, overwriting the first
  without close. Flagged for awareness; not introduced here.

## Test results

- Cloud API suite — 13/13 green (incl. `null`-body 400, auth-reject audit)
- Refresh failures — 6/6 green (incl. connect-path CAS-conflict test)
- Full affected surface (cloud-api + observation-api + executor +
  token-refresh + refresh-failures + kms-repository) — 48/48 green
- `tsc --noEmit` — clean
- Live verify `rh-mcp-cloud-api-807.ts` — PASS on the final deployed build
  (re-deployed after round-2 fixes; 5/5 unauth 401 gate; authed
  GET /tools → 76 tools; POST get_accounts → success; reauth →
  REAUTHORIZATION_REQUIRED)

## Verdict

**PASS** — round-1 critical/major findings remediated; round-2 re-review
converged with only minors, all fixed or dispositioned; all acceptance
criteria met; deployed build matches reviewed code.

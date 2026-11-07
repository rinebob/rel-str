**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio-dashboard  
**Thread:** Load Architecture & Order Surfacing  
**Thread Slug:** dashboard-load-order-surfacing  
**Issue:** #1409  
**Thread Parent:** #1403  
**Topic Parent:** #219  
**Task:** #1409  
**Domain:** PORTFOLIO  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-05  
**Last Updated:** 2026-11-05  

# Code Review — #1409: get_accounts session cache + bootstrap warm

## Verdict

**PASS** — two rounds. Three-axis analysis (Standards / Spec /
Thermo-Nuclear) run inline: the diff is ~100 lines across 6 files.
Pass 2 found one in-diff lifecycle gap (sign-out staleness) —
remediated in-gate, re-verified. Nits below.

## Scope

- `src/app/core/robinhood-mcp/robinhood-mcp-client.service.ts` —
  `getAccounts()` session cache: `accountsPromise` field, `??=` shared
  in-flight promise, rejection clears the slot for retry.
- `src/app/core/core.component.ts` — `effect` on
  `AuthStore.isAuthenticated()` warms the cache once signed in and
  invalidates it on sign-out (the session boundary).
- `src/app/features/savant-trader/services/trading-config.service.ts` —
  `getAccounts()` delegated to the client (was: direct `executeTool`
  with ~30 lines of duplicated shape-parsing). In scope per the task's
  "no re-fetch within the session" intent — found in the second
  implementation sweep.
- Specs: client cache describe (3 specs), core component warm spec.

## Axis results

| Axis | Verdict | Notes |
|---|---|---|
| Standards | PASS | `??=` + private field + doc comment matches file conventions; delegation removes duplicated parse; error semantics improve (`toolError` now surfaces, `RobinhoodMcpError` replaces bare `Error`) |
| Spec | PASS | All four ACs met + spec-pinned: single-flight, cache-hit, no re-issue on refresh/reconcile (shared promise), client specs. Bonus: trading-config no longer re-issues — every `get_accounts` call site rides the cache except the intentional debug console (`observation-dashboard`) |
| Thermo-Nuclear | PASS | Concurrency correct (shared in-flight), reject-clears can't poison the session, warm gated on `isAuthenticated` (no pre-auth call), effect re-fires are free (cached) |

## Pass 2 — one in-diff finding, remediated

**Sign-out doesn't clear the session cache (lifecycle gap — fixed).**
`AuthStore.signOut()` navigates to `/login` with no page reload, so the
SPA session — and `accountsPromise` — outlives a user switch. Pre-cache,
the dashboard's per-mount refetch silently corrected the account list
after a different user signed in; post-cache, user B would have been
served user A's accounts indefinitely. Sign-out is the session boundary
the cache claims, so the warm effect now invalidates on
`isAuthenticated() → false`: new `RobinhoodMcpClient.invalidateAccounts()`
drops the slot (an in-flight fetch is detached, never repopulates it).
Specs: client invalidation-refetch, component sign-out → invalidate →
re-auth re-warm.

## Nits (documented, not fixed)

- `void this.rh.getAccounts().catch(() => {})` — `void` on an
  already-catching promise is mildly redundant; harmless, reads as
  intentional fire-and-forget.
- Session cache never expires — by design (`AccountInfo` is stable
  identity data); a mid-session account-list change would need a reload.
- `observation-dashboard` still calls `executeTool('get_accounts')`
  directly — deliberate: it's the RH tool-inspection debug page.

## Automated evidence

- Touched sweep: `src/app/core` + `portfolio-dashboard` + trading-config
  — 48+2 suites, 947 tests green.
- Full suite: 299/301 suites green — the 2 failures are foreign
  in-flight work (`contract-list-session`/`contract-list-picker` —
  `togglePickDate` spec'd ahead of impl under #1420). Zero failures in
  the task's files.
- `tsc -p tsconfig.app.json --noEmit` clean except the same foreign
  savant-trader errors.

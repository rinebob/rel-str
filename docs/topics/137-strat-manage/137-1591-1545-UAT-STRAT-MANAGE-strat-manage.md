**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** page-overhaul  
**Issue:** #1591  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Task:** #1545  
**Domain:** STRAT-MANAGE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# UAT — #1545 BE: Manual open pass callable

## Getting to the feature

Not applicable as a UI surface yet — the `manageOpenPassManual`
callable is the backend the manage table's "open now" affordance will
invoke (FE wiring lands in the #1546+ tasks). Entry point when
deployed: Firebase callable `manageOpenPassManual`, request
`{instanceId}`, response `{instanceId, symbol, positionId, skipped,
skipReason, legsResolved, recordedAt}` — e.g.
`{instanceId: 'QQQ-PCS-28-30-15-ALL'}` → `{positionId:
'QQQ-PCS-28-30-15-ALL-2026-02-06', skipped: false}` on a successful
open. QA acceptance is at the contract/verification level.

## Scenarios

### S1 — Verify script passes standalone

1. Run `npx tsx scripts/verify/strat-manage-open-callable-1545.ts`
2. **Expect:** every check prints `OK`, ends `All checks passed`,
   exit 0. Covers: auth guard, arg validation, `not-found` /
   `not_active` / `non_paper` gates, session-bound `callTool` routing,
   close-on-success and close-on-throw, `already_opened_today`
   pass-through AND race mapping, `internal` on session/pass failure.
   **Result: PASS — 15/15 checks.**

### S2 — Specs pass

1. Run `npx tsx --test tests/functions/options-strategy-engine/manage-open-callable.test.ts`
2. **Expect:** 13/13 green — unauthenticated rejects before any dep
   runs (zero instance reads, zero session opens), all arg-validation
   paths, gate ordering (`not_active` before `non_paper`), pass
   invocation with session callTool + tickets, skip pass-through,
   race → `already_opened_today`, both failure paths → `internal`
   with the session still closed.
   **Result: PASS — 13/13 tests.**

### S3 — Types + functions build

1. `cd functions && npx tsc --noEmit`
2. `cd functions && npm run build`
3. **Expect:** clean on the task surface (residual `tsc` errors are
   the foreign #1563 verify harness).
   **Result: PASS.**

### S4 — Callable wiring

1. `functions/src/index.ts` exports `manageOpenPassManual` from the
   options-strategy-engine shim.
2. `onCall` options: `cors: OPTIONS_STRATEGY_ALLOWED_ORIGINS`,
   512 MiB, 120 s, us-central1, `secrets: ['RH_CREDENTIAL_BUNDLE']` —
   the live chain resolution needs the RH session; the allowlist
   matches the manual triggers this absorbs.
   **Result: PASS.**

### S5 — Idempotency (AC: opens only when ACTIVE and due)

1. `runState ≠ 'ACTIVE'` → `{skipped:true, skipReason:'not_active'}`
   without touching RH or the ledger.
2. `mode ≠ 'paper'` → `skipReason:'non_paper'` (v1 boundary).
3. "Due" is the pass's own gate set — daily cadence dedup
   (`already_opened_today`), signal freshness (`no_fresh_signal`),
   `maxOpenPositions`, and the deterministic `{instanceId}-{marketDate}`
   position id: a second invocation same day can never double-mint.
   A lost race reports `already_opened_today`, not `internal`.
   **Result: PASS — asserted in S1/S2.**

## Result

**Complete** — all scenarios pass. #1545 is ready to ship.

## Notes

- The callable deliberately returns skip results (not errors) for
  `not_active`/`non_paper` so the FE start flow can drive state
  transitions through one surface; only `not-found`, auth, and real
  failures are `HttpsError`s.
- `daily-analysis/latest` is not stamped on callable-level skips —
  no pass ran; the pass writes `manageOpenPassResult` itself when it
  executes.

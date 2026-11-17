**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** page-overhaul  
**Issue:** #1536  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Task:** #1545  
**Domain:** STRAT-MANAGE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# Code Review — #1545 BE: Manual open pass callable

## Scope reviewed

New: `paper-trading/engine/passes/manage-open-callable.ts`
(`runManageOpenPassManual` deps-injected core + `manageOpenPassManual`
onCall), `options-strategy-engine/passes/manage-open-callable.ts` shim,
`manage-open-callable.test.ts` (13 specs),
`strat-manage-open-callable-1545.{ts,md}` verify harness (15 checks).
Modified: `index.ts` (export), `run-all.ts`/`README.md` registry rows,
IMPL §6 as-built. Foreign in-flight edits elsewhere were excluded.

## Axes

### Standards — PASS (2 minors fixed in-cycle)

- **FIXED** `cors: true` without `invoker` mixed two conventions —
  adopted `OPTIONS_STRATEGY_ALLOWED_ORIGINS` (the allowlist used by the
  manual triggers this absorbs, `optionsMarkPassManual`/
  `optionsSettlementPassManual`; the `cors:true` + `invoker:'public'`
  pair belongs to the newer analysis surface).
- **FIXED** doc header mislabeled `invalid-argument` as `not-found`.
- Convention-verified: `runAnalysisStart`-style deps-injected core with
  the `onCall` export as a thin wrapper; auth-first ordering identical
  to `start.ts`; `createLogger` + `@topic`/`@task` header per siblings;
  shim matches the one-line re-export pattern; `session.callTool`
  arrow-binding preserves `this` (same as the timer); tickets Pick is
  type-compatible with the pass's `StOrderTicketEmitter`.

### Spec — PASS (1 minor fixed in-cycle)

- All AC confirmed: auth guard before any effect; `instanceId`
  trim+required; "due" correctly delegated to the pass's own gates
  (`evaluateOpenGates` cadence dedup, `no_fresh_signal`, deterministic
  `{instanceId}-{marketDate}` position id) rather than duplicated —
  the layering is right; session opened once post-gates, closed in
  `finally`; `not_active`/`non_paper` no-ops return skip results for
  the FE rather than errors; response contract
  (`positionId`/`skipReason`/`legsResolved`) covers the table's needs.
- **FIXED** a lost same-instance race (double-click / manual + noon
  timer both passing the dedup read) surfaced `internal` — the outer
  catch now maps `already[-_ ]exists` to an `already_opened_today`
  no-op, keeping "no-op otherwise" true under a real race.
- **NOTE (accepted)** `getInstance` Firestore failures propagate
  unlogged (same gap as `runAnalysisStart`'s `getListDoc` — Firebase
  converts to `internal` for the client regardless).
- **NOTE (accepted)** skip results don't write
  `daily-analysis/latest` — correct, no pass ran.

### Thermo — folded into the single review (small surface)

- Race behavior verified: the AC's safety property (no double-mint)
  was always held by the deterministic id + transactional create —
  only the response degraded, now fixed above.
- `session.close()` can throw raw and mask a success — identical to
  the sibling pattern; acceptable.
- 120 s timeout is comfortable for a single instance (session
  bootstrap + ≤4 instrument pages/leg + ledger write + the pass's own
  30 s contract-list bound; the noon timer does ALL instances in 300 s).

## Verdict

**PASS.** 13/13 specs + 15/15 verify checks, `tsc --noEmit` clean on
the task surface (residual errors are the foreign #1563 verify
harness). Three minors fixed in-cycle; remaining findings are
convention-consistent accepts.

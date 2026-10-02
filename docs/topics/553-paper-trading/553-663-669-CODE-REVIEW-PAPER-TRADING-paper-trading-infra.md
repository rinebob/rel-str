**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Exits  
**Blueprint:** #663 (BE)  
**Task:** #669  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** Draft  
**Created:** 2026-09-30  
**Last Updated:** 2026-09-30  

# Code Review — #669 BE trade-exits prod verify script + guide + run-all

## Scope

| File | Change |
|---|---|
| `functions/scripts/verify/paper-trading-trade-exits-669.ts` | NEW — composed exit-seam prod verify (audit + resolution round-trips + seed guards + cancel/close guards) |
| `functions/scripts/verify/paper-trading-trade-exits-669.md` | NEW — per-task guide |
| `functions/scripts/verify/run-all.ts` | Registered the full paper-trading verify chain (was: only 3 pre-#553 scripts) |
| `functions/scripts/verify/README.md` | Index rows + ordering for the paper-trading scripts |
| `scripts/verify/README.md` | #669 row |

## Test results

- `paper-trading-trade-exits-669.ts` on prod: **25/25 checks** green
  (12 prod trades audited; scratch docs cleaned).
- Full `run-all.ts`: **11/11 scripts PASS** including the RH-MCP paths.

## Round 1 — 3-axis

**Spec: PASS** — close-path guard coverage satisfies the task's
"(or guard checks)" clause; the live-quote close round trip stays with
-667 (documented). Prod-data audit is a superset of the task's ask —
audits all prod trades, not just post-#668 ones. run-all + both READMEs
registered correctly.

**Standards: 2 HIGH + 1 MEDIUM + 1 LOW — all fixed.**
- `phases` fixture missing required `targetDelta/dteMin/dteMax` — would
  fail `tsc --noEmit` (tsx masks it). Added.
- Unused `getAccount` import — `noUnusedLocals`. Removed.
- Cleanup missed the `verify-669-guard-*` ids — a leaked rejected doc
  would be flagged but orphaned forever. Added all 6 to cleanup.
- Guide moved to `scripts/verify/` to match the 561–667 convention.

**Thermo-nuclear: 1 MEDIUM + 3 LOW — fixed.**
- **F1 (the real one):** scratch instances were fully valid `ACTIVE`
  instances — a leaked one would feed the nightly selection pass
  (orphaned `daily-analysis/latest`), the open pass (real
  ledger-managed zombie trade + stats pollution), and the settlement
  pass (`stats-inst-verify-669-*` orphans). Fixed: `STOPPED` +
  `openTimePT: '99:99'` — `createPosition`/`getInstance` unaffected,
  the enumeration paths drop it.
- **F2/F3:** cleanup silently swallowed delete failures then printed
  "removed". Added a post-cleanup `verifyDeleted` pass — survivors fail
  the run with a list.
- **F3/nit:** `verify-669-pending` survivor would throw in
  `expressionFillPassTimer` every weekday noon — covered by verifyDeleted.
- **Audit gap:** top-level `trade.governingVariant` vs the governing
  run's key consistency check added.

## Fixes applied

STOPPED/99:99 fixture + full guard-id cleanup + post-cleanup existence
check + governing-field/run consistency check + phases fixture fields +
guide location + concurrent-run note in the guide.

## Round 2 — post-fix re-review

- **Standards + Spec:** root `scripts/verify/run-all.ts` was missing the
  669 entry (every other functions-side script was registered via
  `cwd: 'functions'`); `verifyDeleted` had a raw-quote blind spot.
  Fixed both.
- **Thermo:** verifyDeleted gaps — extended to all 10 trade ids + 3
  instances + account + stats docs (both `stats-inst-*` and legacy
  `stats-{id}` namespaces) + raw-quote re-query; read errors count as
  suspect, not deleted; `batch.commit` error no longer swallowed.
  Audit gained the `field-set-but-no-governing-run` check.

## Round 3 — convergence

NO NEW FINDINGS. Cleanup/verifyDeleted id lists verified identical,
stats id formats confirmed against `statsScopeInstance`/`buildStatsId`,
the `'none'` carve-out proven to be the only legit no-run shape
(`positionToTrade` is the sole non-guarded writer).

## Test results

- Final prod run: **26/26 PASS**, `cleanup: docs removed (verified)`.
- `tsc --noEmit` on functions: 2 pre-existing errors in
  `rh-agent-mcp/broker/broker-order-adapter.ts` (unrelated workstream);
  zero errors in this change set.

## Verdict: PASS

3 rounds to convergence — all findings applied and re-verified on prod.

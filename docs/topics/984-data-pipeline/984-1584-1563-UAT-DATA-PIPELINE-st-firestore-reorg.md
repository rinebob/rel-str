**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Pass Family Consolidation  
**Thread Slug:** pass-family-consolidation  
**Issue:** #1584  
**Thread Parent:** #987  
**Topic Parent:** #984  
**Task:** #1563  
**Domain:** DATA-PIPELINE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# UAT — #1563 BE-IMPL: ledger stats increment seam

## Scope

Task #1563 — "BE-IMPL: ledger stats increment seam (opens + closes +
settle)". Acceptance criteria covered:

- Every canonical paper-trade lifecycle transition that changes stats
  (`applyEntryFill`, `applyPendingFill`, terminal `applyExitFill`,
  `markPositionSettled`) moves `stats-all` + `stats-src-{source}` (+
  `stats-inst-{id}` when `strategyInstanceId` present) counters
  intraday — no waiting for the nightly pass.
- Deltas are field-for-field equal to `computeStatsFromPositions`
  semantics (short-only premium, assigned hand-back, expired
  worthless).
- Increments are post-commit and self-swallowing — a stats failure can
  never fail a fill or settlement.
- `incrementStatsOnOpen` + its open-pass call site deleted — no double
  count.
- `createPendingTrade` / `cancelPendingTrade` stay silent; `PENDING`
  excluded from the recompute before scope fan-out.
- Nightly recomputation remains the authoritative self-heal.

## Prerequisites

- Repo checkout on branch `prod`; `functions/` deps installed.
- Application Default Credentials with Firestore access:
  `gcloud auth application-default login`. No RH OAuth needed.
- The verify script seeds two MANUAL-source trades, runs the real
  nightly pass to clean up, and deletes whatever it minted — it is
  safe to run on prod, but run it alone (not in parallel with other
  verify runs).

## Getting to the feature

There is no UI surface — the feature is a Firestore write seam behind
the ledger. The observable surface is the `st-paper-trading` stats
documents (`stats-all`, `stats-src-*`, `stats-inst-*`).

Reproduction command:

```
cd functions
npx tsx scripts/verify/paper-trading-stats-increments-1563.ts
```

## Automated evidence

- `tests/functions/paper-trading/stats-increments.test.ts` — 17 specs:
  scope fan-out, merge-set shape, no reads, failure swallowing,
  short/long premium, settle branches, assigned hand-back, inc(0)
  minting, and a `computeStatsFromPositions` parity describe over 6
  transition shapes.
- `tests/functions/paper-trading/ledger.test.ts` — post-commit firing
  on entry / pending-fill / terminal exit, assigned-to-close
  decrement, pending create/cancel silence, throwing hook can't fail a
  fill.
- `tests/functions/paper-trading/paper-stats-pass.test.ts` — `PENDING`
  docs contribute no scope counts (recompute exclusion pin).
- Suite runs: `npm run test:paper-trading` → 309/309;
  `npx jest --coverage=false` → 5832/5832 (315 suites); `tsc --noEmit`
  clean on all task files.

## Scenarios

### S1 — Intraday freshness via the real ledger seam

**Confirm:** real transitions move stats counters without the nightly
pass. **Starting state:** prod Firestore, ADC set.

Steps: run the verify script (command above).

Expected (all observed 2026-11-17, run 3 — 21/21):

- `entry A: stats-all openTradeCount +1` and
  `totalPremiumCollected +100` — a SHORT put entry at mark 1.00 moves
  `stats-all` immediately.
- `entry A: stats-src-MANUAL minted by the increment` +
  `minted doc carries all 8 counters` — the inc(0) mint creates the
  scope doc with complete numeric shape when absent.
- `exit A: stats-all openTradeCount −1`, `closedTradeCount +1`,
  `totalRealizedPnl +40` — terminal exit through the real
  `applyExitFill`.
- `settle B: stats-all openTradeCount −1`, `closedTradeCount +1`,
  `expiredWorthlessCount +1`, `totalRealizedPnl +50` — real
  `markPositionSettled` (EXPIRED_WORTHLESS) banks the premium.
- `cleanup: stats-all self-healed to baseline` — after seed deletion
  the recompute restores exact baseline counts (authoritative heal).

**Result:** PASS — 21/21 checks green, `npx tsx
scripts/verify/paper-trading-stats-increments-1563.ts`.

### S2 — Regression: full test suites

`npm run test:paper-trading` (309 specs) + `npx jest --coverage=false`
(5832 specs) — both green. **Result:** PASS.

### S3 — Scope discipline

`git status` shows only task files modified (stats-increments, ledger,
repositories, adapter, passes, tests, verify script + registry).
Foreign-session changes (options-replay-templates, settlement-pass,
contract-list-writer, portfolio docs) untouched. **Result:** PASS.

## Manual UI/UX refinement pass

Not applicable — no user-facing surface. Stats readers already
tolerate increment-minted docs (`equityCurve ?? []`), verified by the
#1562 verify script's canonical-shape check remaining green.

## Findings

- **QA harness bug (fixed in-script):** `getStats` returns `null`, not
  `undefined` — the first draft skipped mint-detection and cleanup for
  `stats-src-MANUAL`, leaving a stale doc in prod. Detected, deleted,
  script corrected (`== null`), re-run clean. Not a product defect.
- **Known seam (documented):** an increment-minted scope doc for a
  source that later has zero trades persists (recompute doesn't delete
  scopes). Only reachable via doc deletion — prod never deletes trade
  docs, so no live impact.
- **Pre-existing noise (not this task):** the settle path logs a
  swallowed `ScreenshotLifecycle` warning ("Bucket name not
  specified") in script context — lifecycle capture is env-dependent,
  unrelated to stats.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Entry fill fires open+1/premium+= | S1 (entry A/B checks) |
| Pending fill fires on PENDING→OPEN | ledger.test.ts firing specs |
| Exit fires only on terminal CLOSED | S1 (exit checks) + ledger specs |
| Settle: EXPIRED open−1/closed+1/expired+1/realized+= | S1 (settle checks) |
| Settle: ASSIGNED assignedCount+1 only | stats-increments parity specs |
| Deltas = computeStatsFromPositions semantics | parity describe (6 shapes) |
| Post-commit, self-swallowing | ledger.test.ts hook-throw specs |
| No double-count (legacy increment deleted) | code review + grep |
| PENDING excluded from recompute | pass pin spec |
| Nightly recompute stays authoritative | S1 (cleanup heal checks) |

## Regression / smoke

- [x] `test:paper-trading` green (309)
- [x] Full jest green (5832)
- [x] #1562 verify script still green (scope-family + shape tolerance)
- [x] Prod stats docs restored to baseline after run

## Verdict

**PASS** — all acceptance criteria met; intraday freshness confirmed
on prod for entry, exit, and settle seams; self-heal confirmed;
no blocking findings.

## Results log

- 2026-11-17 — QA run 1: harness bug (null vs undefined mint
  detection) left stale `stats-src-MANUAL`; doc deleted manually,
  script fixed. Run 2: 18/1 (residual stale baseline). Run 3 clean:
  21/21 PASS — verdict PASS.

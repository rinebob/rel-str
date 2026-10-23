**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Signals Auto Paper Trade  
**Thread Slug:** signals-auto-paper-trade  
**Issue:** #922  
**Thread Parent:** #904  
**Topic Parent:** #553  
**Task:** #921  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-22  
**Last Updated:** 2026-10-22  

# UAT — #921 FE: auto-paper group-by dims on trading/paper

## Scope

Retroactive UAT — task #921 shipped `8_LIVE` on 2026-10-11 with this QA
issue left open/NOT STARTED. The gate is executed here against the
shipped build.

Feature surface: the **Group by** select on `trading/paper` gains six
dimensions sourced from the auto-paper stamps (#916/#918) — Signal Type,
Direction, Sector, Industry, Cap Tier, Signal Status — backed by the
store's `tradesBy*` computed maps. Trades without a stamp (manual,
strategy-sourced) bucket under `—`. Each dim repivots the trades table
into per-key sections carrying scoped stats
(`N trades · N open · $ realized`).

## Prerequisites

- `npm start` dev server on :4200, logged in, paper trades present
  (auto-paper signal trades carry stamps; manual/strategy trades are
  the `—` cohort).

## Scenarios

### S1 — Group-by option list (AC1)

**Steps:** `trading/paper` → open the **Group by** select in the trades
header.
**Expected:** 12 options — the 6 originals (All trades, Strategy
instance, Signal cohort, Exit variant, Expression, Symbol) plus the six
new dims (Signal Type, Direction, Sector, Industry, Cap Tier,
Signal Status).
**Result:** ✅ PASS — user-verified in the browser (2026-10-22).

### S2 — Pivot behavior (AC2)

**Steps:** select **Direction**, then **Sector**; then return to
**All trades**.
**Expected:** table repivots into per-key sections
(`Direction: LONG/SHORT`, `Sector: <name>`) each with its own
`N trades · N open · $ realized` stats line; trades land in the correct
bucket; All trades restores the single flat table.
**Result:** ✅ PASS — user-verified (2026-10-22).

### S3 — `—` unstamped bucket + console (AC3)

**Steps:** select **Signal Type** and **Signal Status**; cycle all six
new dims with devtools console open.
**Expected:** auto-paper/signal trades land in real stamp buckets;
manual and strategy trades group under `—` (not dropped); zero console
errors across all switches.
**Result:** ✅ PASS — user-verified (2026-10-22).

### S4 — Spec coverage (supporting evidence)

**Steps:** `npx jest --coverage=false paper-trading.component.spec`
**Expected:** component spec green — includes per-dim repivot cases,
the `—` unstamped-bucket pin, and the direction group-by.
**Result:** ✅ PASS — 24/24 tests (2026-10-22).

## Traceability

| Acceptance criterion (#922) | Scenario |
|---|---|
| trading/paper shows the six new group-by options against real stats docs | S1 |
| Clicking a group pivots the stats/table to the matching scope | S2 |
| Manual trades land in '—' groups; no console errors on unstamped trades | S3 |

## Findings

- None. Refinement pass: **Not applicable** — the feature shipped and
  has been in use since 2026-10-11; no UI defects observed in the pass.

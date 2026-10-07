**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST Anchored VWAP  
**Thread Slug:** st-anchored-vwap  
**Issue:** #882  
**Thread Parent:** #835  
**Topic Parent:** #261  
**Task:** #869  
**Domain:** INDICATOR-LIB  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

# UAT — FE: ZigZag anchor-event walk (#869)

## Scope

Task #869 adds `computeZigZagAnchorEvents(bars, config)` to the ZigZag engine and refactors the pivot walk so `computeZigZagPivots` and the new function share one internal walk. It has **no user-facing surface of its own**: the only way a user could notice it is if the refactor changed ZigZag's existing behaviour. This UAT therefore confirms (a) the new function's contract, (b) that `computeZigZagPivots` output is unchanged, and (c) that the existing ZigZag consumers still work.

Covers Task #869 acceptance criteria, the FE Implementation Plan (module 1) and the FE Test Plan (engine seam + regression). Related: FE Test Plan journey 5 (no line before its confirmation bar) belongs to T2/T3, not this task.

## Prerequisites

- Repo `C:\aa\projects\rel-str`, branch `prod`, dependencies installed (`npm install`).
- Working tree contains the #869 changes (uncommitted is fine). Scenario 4 compares against `HEAD`, so it only works **before** the change is committed.
- For scenarios 7 and 8: a signed-in session on the dev server (your own account; no fixture exists).
- No secrets, services or feature flags are needed for scenarios 1 to 6.

## Start instructions

Automated scenarios: run the commands in each scenario from the repo root in PowerShell.

Manual scenarios: `npm start` (runs `scripts/start-dev.mjs`), then open `http://localhost:4200` and navigate as stated.

## Scenarios

### 1. New function contract (automated)

- **Confirms:** `computeZigZagAnchorEvents` returns every new pivot and same-side replacement with `confirmBar = pivotBar + rightDepth`.
- **Steps:** `npx jest st-zigzag.anchors`
- **Expected:** 1 suite, 30 tests pass. Includes: single peak yields one event confirmed `rightDepth` bars later; asymmetric depth and depth clamp; replaced event kept in events but not survivors; rejected less-extreme same-side pivot emits nothing; `allowZigZagOnOneBar` both ways; projection ignored; barrel export; and per-series invariants (confirmation lag, ordering, replay equals survivors).
- **Result:** PASS — 1 suite, 30/30 (2026-10-07).

### 2. Existing ZigZag behaviour unchanged (automated)

- **Confirms:** the original specs still pass unmodified, and four frozen outputs captured before the refactor still match.
- **Steps:** `npx jest st-zigzag`
- **Expected:** all ZigZag suites pass (pivots, engine, indicator, swings, stats, triggers, anchors).
- **Result:** PASS — 7 suites, 108/108 (2026-10-07).

### 3. ZigZag consumers still work (automated)

- **Confirms:** nothing downstream of the engine broke.
- **Steps:** `npx jest flex-chart-sandbox chart-data-adapter swing-analysis flex-chart.component`
- **Expected:** all pass.
- **Result:** PASS — 12 suites, 339/339 (2026-10-07).

### 4. Equivalence with the pre-change implementation (automated, one-off)

- **Confirms:** `computeZigZagPivots` returns exactly what it returned before the refactor.
- **Steps:** copy `git show HEAD:src/app/features/shared/components/flex-chart/indicators/st-zigzag.pivots.ts` to a temporary `tmp-pivots-head.ts` beside it; write a temporary spec that runs both implementations over the same inputs and `toEqual`s the full result (pivots and projection); run it; delete both temporary files. Inputs: empty, trending up and down, flat, plateau (equal highs), spike bars, NaN gaps, and 25 random walks, against 5 deviation thresholds x 4 left depths x 4 right depths x one-bar on/off x projection on/off.
- **Expected:** identical in every combination, with many combinations producing pivots.
- **Cleanup:** the two temporary files are deleted (verified: none remain).
- **Result:** PASS — 10,240 comparisons identical, 8,960 of them with at least one pivot (2026-10-07; first run in the code review, repeated here).

### 5. Type safety (automated)

- **Steps:** `npx tsc -p tsconfig.app.json --noEmit` and `npx tsc -p tsconfig.spec.json --noEmit`
- **Expected:** no errors.
- **Result:** PASS — 0 errors in both (2026-10-07).

### 6. Full test suite (automated)

- **Confirms:** no failure anywhere in the repo is attributable to this task.
- **Steps:** `npx jest --coverage=false`
- **Expected:** all tests pass.
- **Result:** PASS (scoped to this task) — 195 of 196 suites pass (3,008 of 3,009 tests). The single failure is `shared/screenshot-capture-contracts.spec.ts › PositionType › is limited to stock in this thread`, a stale assertion in another thread's code. It is **not** in the dependency graph of any file changed by #869 (`jest --findRelatedTests` on the changed sources does not list it), so nothing in the suite is attributable to this task. The 14 gallery failures seen during review are gone after the gallery specs were fixed. The user ruled the unrelated failure out of scope for this task (2026-10-07); it is recorded here for completeness and left to its own thread.

### 7. Manual smoke — ST ZigZag in the flex-chart sandbox

- **Confirms:** the ZigZag chart overlay still renders after the refactor.
- **Starting state:** `npm start` running; signed in.
- **Steps:**
  1. Open `http://localhost:4200/dev/flex-chart`.
  2. Load symbol `AAPL` (or any symbol with a year of daily bars).
  3. In the indicator menu, enable **ST ZigZag**.
- **Expected:** solid line segments joining alternating swing highs and lows, a dashed segment from the last confirmed pivot to the projected pivot, and trigger dots; no errors in the browser console.
- **Cleanup:** disable ST ZigZag.
- **Result:** PASS — user-verified on the dev server (2026-10-07): ZigZag overlay renders, no console errors.

### 8. Manual smoke — Swing Analysis page

- **Confirms:** the swing table and stats, which call the same engine, still populate.
- **Starting state:** `npm start` running; signed in.
- **Steps:**
  1. Open `http://localhost:4200/analysis/swings`.
  2. Enter symbol `AAPL` and load it with the default parameters.
- **Expected:** the chart, swing table and stats panel all populate with plausible values; no errors in the browser console.
- **Cleanup:** none (read-only).
- **Result:** PASS — user-verified on the dev server (2026-10-07): chart, swing table and stats populate, no console errors.

## Negative / edge scenarios

Covered by scenario 1 and the engine specs rather than by manual steps: empty, single and too-few bars; below-threshold moves; all-NaN prices; flat prices; `allowZigZagOnOneBar` true and false; asymmetric and sub-minimum depths; projection on and off.

## Traceability

| Task #869 acceptance criterion | Scenario |
|---|---|
| Pivot walk is one internal function shared by both exports | 1, 2, 4 (behaviourally equivalent) |
| `computeZigZagPivots` output identical; existing specs unmodified | 2, 4 |
| Events for every new pivot and same-side replacement, in walk order | 1 |
| `confirmBar = pivotBar + rightDepth` (clamped), always `< bars.length` | 1 |
| Replaced pivots in events but not in surviving pivots | 1 |
| Rejected candidates emit nothing; `allowZigZagOnOneBar` preserved | 1 |
| `AnchorEvent` added; both functions re-exported from the engine barrel | 1, 5 |
| Projected pivots never produce events | 1 |
| Unit tests from the FE Test Plan pass | 1, 2 |
| (Regression) ZigZag consumers unaffected | 3, 7, 8 |
| (Whole repo) no failure attributable to this task | 6 |

## Regression / smoke checklist

- [x] ZigZag specs green (scenario 2)
- [x] Consumer specs green (scenario 3)
- [x] Typecheck clean (scenario 5)
- [x] Sandbox ZigZag overlay renders (scenario 7)
- [x] Swing Analysis page populates (scenario 8)

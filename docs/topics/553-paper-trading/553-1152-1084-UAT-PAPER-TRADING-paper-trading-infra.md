# UAT — #1084 FE analysis views (stats / histogram / scatter)

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Analysis & Forensics  
**Thread Slug:** trade-analysis  
**Issue:** #1152  
**Thread Parent:** #1059  
**Topic Parent:** #553  
**Task:** #1084  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-21  

## Scope

Workbench analysis views on the filtered subset: stats block, tradeRetPct
histogram (bin-width control, win/loss coloring, mean/median striplines,
full-set overlay toggle), scatter (x/y/color pickers, jitter on discrete x,
tooltip → tradeId), and the table|stats|histogram|scatter view switcher.
All views consume `filteredRows` — the same quarantined + filtered set as
the table.

## Prerequisites

- Dev server running (`npm start`), signed in.
- The AMAT replay dataset exists and is `ready` — `ds-20261020-replay-e1aded53`
  (AMAT · trailing-8, ~104 rows, ~98 closed).

## Scenarios

1. **View switcher present** — open the AMAT dataset; the workbench header
   shows table|stats|histogram|scatter tabs left of the ✕. Expected:
   `table` active by default, table unchanged.
   Result: PASS — `table` default; tabs left of ✕.
2. **Stats block on the default cohort** — switch to `stats`. Expected:
   ~98 trades, ~32.7% win rate, payoff ~1.30 (the replay's known values);
   metric grid readable, per-signalType breakdown table below.
   Result: PASS — user verified metric block reads correctly on AMAT.
3. **Stats honesty on edge filters** — filter to a tiny subset (e.g. one
   signal type); expected: metrics recompute, no `NaN`/`Infinity` strings
   (all-loss shows PF 0; all-win shows ∞).
   Result: PASS — signal-type checkbox filter narrows stats cleanly.
4. **Histogram renders** — switch to `histogram`. Expected: column chart of
   tradeRetPct bins, green right of zero / red left, blue mean + orange
   dashed median vertical lines, faint gray "full set" overlay behind
   (toggleable via "overlay full set" checkbox), bin-width select
   (1/2.5/5/10%) rebuckets.
   Result: PASS — renders (Syncfusion series providers registered
   in-flight); mean/median striplines visible; overlay + toggle work.
   Note: plot area small at current layout — logged to #1085.
5. **Scatter renders** — switch to `scatter`. Expected: daysHeld ×
   tradeRetPct points; x/y pickers offer number columns only; color picker
   offers enum/string columns; hovering a point shows its tradeId; the
   jitter checkbox appears when x has few distinct values (e.g. x =
   ind.zoneV2).
   Result: PASS — renders; pickers/tooltip/jitter verified.
6. **Filter narrows all three views (AC2)** — set a table filter
   (e.g. `ind.zoneV2` = 4) → stats count drops to the filtered N;
   histogram bins the same subset (gray overlay still shows all ~98);
   scatter points = same N.
   Result: PASS — range filter narrows all views to the same subset.
7. **Quarantine holds (AC3)** — with default settings, open/excluded rows
   are absent from every view (AMAT: count stays ~98, not ~103). Enable
   "Include open/excluded" → provisional rows enter stats/histogram/
   scatter (count rises); disable → back to ~98.
   Result: PASS — counts track the quarantine toggle.
8. **Empty state** — filter to zero rows → each view shows its empty
   message (stats dashes, "No rows with returns", "No plottable rows").
   Result: PASS.

## Refinement pass (UI/UX)

9. Chart legibility — plots render inside the workbench region without
   overlap/clip; controls don't wrap awkwardly at ~1440px width.
   Result: PASS — legible; plot area is small (known, logged to #1085 —
   layout revamp planned, not a gate failure).

## Defect found & fixed during QA

- **Filter menu hung the page** (reported during S3/#3): clicking any
  filterable header's funnel icon — and later even the plain header —
  froze the tab with no console output. Root cause isolated via a
  headless-Chrome harness (`/dev/table-perf`, since removed):
  `mat-select` inside `mat-menu` busy-loops the main thread on open —
  an overlay nested in a menu overlay. Fix: replaced the enum/string
  `mat-select` with a `mat-checkbox` option list inside the lazy
  `matMenuContent` panel (same multi-select semantics, no nested
  overlay); `MatSelectModule`/`FormsModule` dropped. Headless verify:
  sort 144ms, funnel open 3ms, checkbox tick 34ms, chip applies.
  Companion improvements kept: stable `tradeId` row keys (sort = DOM
  move, not rebind), precomputed cell text/classes (`renderRows`
  computed), `table-layout: fixed` with kind-based widths, dataset
  library switched to a horizontal scroll strip so DevTools-docked
  viewports keep the workbench reachable. 18/18 table specs + full
  suite green after the fix.

## Traceability

| AC / spec item | Scenario |
|---|---|
| stats block metrics incl. per-signalType | 2, 3 |
| histogram bins/width/colors/striplines | 4 |
| second-cohort overlay | 4, 6 |
| scatter pickers/jitter/tradeId hover | 5 |
| all views off filteredRows (AC2) | 6 |
| quarantine (AC3) | 7 |
| AMAT: 98 closed / ~32.7% / ~1.30 (AC1) | 2 |
| empty/null handling | 8 |
| UI/UX refinement | 9 |

## Regression smoke

- Table view unchanged: sort cycle, filters, chips, column picker,
  include-open toggle (S3–S7 behaviors from #1147 UAT). PASS — verified
  live after the mat-select fix; sort and filter both respond instantly.
- Close/reopen dataset resets to `table` view. PASS.

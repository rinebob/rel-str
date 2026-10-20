# CODE-REVIEW — #1084 FE analysis views (stats block, histogram, scatter)

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Analysis & Forensics  
**Thread Slug:** trade-analysis  
**Issue:** #1084  
**Thread Parent:** #1059  
**Topic Parent:** #553  
**Blueprint:** #1080  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

## Result: PASS

Three axes (Standards, Spec, Thermo-nuclear) plus the full test suite.
Two contract-level findings and two correctness findings were remediated
in-diff during the review; nothing critical, major, or unresolved remains.

## Remediated in-diff

- **Syncfusion feature services missing** — `ejs-chart` rendered an empty
  shell until `ColumnSeriesService`/`ScatterSeriesService`/`LegendService`/
  `TooltipService`/`StripLineService` were registered as component
  providers (histogram.component.ts:35, scatter.component.ts:41) — the
  same pattern stats-panel/flex-chart use. Verified live in the browser.
- **stripLines `size: 0` without `sizeType`** — mean/median markers would
  have been invisible (0px band). Now `size: 1.5, sizeType: 'Pixel',
  zIndex: 'Over'` per the repo's chart-data-adapter precedent.
- **`opacity="0.35"`** on the baseline series — a string attribute on a
  numeric input; now `[opacity]="0.35"`.
- **`scatterPoints` dropped `NaN`/`Infinity`** on either axis into the
  chart (`analysis-stats.util.ts`); now guarded with `Number.isFinite`
  on both axes, spec'd.
- **Zero-return rows counted as wins in bins** — `histogramBins` counted
  `i >= 0` as a win while `computeAnalysisStats` treats 0 as neither.
  Bins now count strictly `v > 0` / `v < 0`; a breakeven trade still sits
  in the `[0, w)` bin (correct edge placement) but is neither-side in
  the counts. Spec'd.
- **Stale color pick produced a phantom `—` series** — `series()` gated
  on raw `colorKey` while `points()` resolved it against present columns;
  both now share `resolvedColor()`.
- **Dead code** — unused `label` payload on histogram chart data; the
  unreachable `rr.length === 0` branch in `bySignalType`.
- **Duplicated view union** — `workbenchView` literal union replaced by a
  module-level `WORKBENCH_VIEWS as const` + derived `WorkbenchView` type.
- **Test gaps** — real jitter displacement spec (the prior spec only
  exercised the single-distinct-x early-out), NaN/Infinity scatter spec,
  zero-return bin spec.

## Open findings (minor / nit — accepted)

- **Scatter pickers narrow "any manifest column"** — x/y restricted to
  `kind === 'number'` (a scatter needs numeric axes); color restricted to
  enum/string with a 12-group cap. Documented narrowing; numeric color
  columns would collapse to one series anyway past the cap.
- **Context metrics span a wider universe than `count`** — `avgDaysHeld`/
  `avgMfe`/`avgMae`/`giveback` average over all input rows, while return
  metrics require a numeric `tradeRetPct`. Visible only when the
  provisional toggle is on; intentional — open trades carry daysHeld but
  no return.
- **Silent >12-group color collapse** — falls back to one series without
  a notice. Acceptable for v1.
- **Streak ordering ties** — same-`entryDate` trades order by CSV
  position; null dates sort first. Edge case, unspecified by spec.
- **Duplicated `row()` fixture** — now in three analysis specs; a shared
  fixture builder is a reasonable follow-up.
- Nits: `expectancyPct` aliases `avgRetPct` (intentional — traders read it
  by that name); `pctCls(winPct - 50)` hardcodes a 50% baseline; `role="tab"`
  buttons lack `aria-controls`; histogram runs the full `computeAnalysisStats`
  for two stripline values.

## Test results

- `analysis-stats.util.spec.ts` — 14/14
- `analysis-views.component.spec.ts` — 13/13
- `analysis.component.spec.ts` — 17/17
- Full suite — **4100/4100 green**; `tsc --noEmit` clean; AOT `ng build` clean.

## AC accounting

- AC1 (AMAT: ~98 closed / ~32.7% win / ~1.30 payoff) — verified in the
  browser by the user: stats block renders the expected values; charts
  render after the providers fix.
- AC2 (filter narrows all three views) — structural: all views consume
  `store.filteredRows()`.
- AC3 (excluded/open quarantined unless toggle) — `viewRows`/`filteredRows`
  quarantine is upstream of every view, including the histogram baseline.

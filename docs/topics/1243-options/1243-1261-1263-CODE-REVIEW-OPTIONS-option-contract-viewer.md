**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** Multi-symbol input  
**Thread Slug:** multi-symbol-input  
**Issue:** #1261  
**Thread Parent:** #1244  
**Topic Parent:** #1243  
**Task:** #1263  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-26  
**Last Updated:** 2026-10-26  

## Verdict: PASS

Two review passes ran. Pass 1 identified five majors across the three axes, all remediated in-cycle (chart-owned `axisLabels` union, single `showPlottedSet` predicate, `chartFocusContractId` rename, `chart-series.utils.ts` + series-builder extraction, loading-contract endpoints). Pass 2 re-ran all three axes on the remediated state: **Thermo-nuclear returned "approval-worthy"**; Spec found one real rendering bug (fixed below); Standards found only judgement calls and by-design unwiring.

## Pass 2 — additional findings remediated in-cycle

1. ~~**Span markers could clip off the underlying axis**~~ (Spec + TN convergence) — `axisRanges.underlying` scanned only bar closes; a strike outside the close range rendered its marker invisible, and with no bars at all the `{0,1}` fallback hid *every* marker — the pure set-view case. Fixed: the axis range now unions the strikes of spans intersecting the visible window (closes or strikes alone both produce a sane range). Two regression specs added (strike outside closes; strikes with no bars).
2. ~~**Builder `hasLowerPanes` flag + unguarded `contracts[0]`**~~ — `single` is now derived inside the builder (`contracts.length === 1 ? contracts[0].points : []`); the flag and the access hazard are gone.
3. ~~**`allDates` emitted stray categories for reversed spans**~~ — skips entries whose `openDate > expiration`, matching `computeMarkerSpans`' skip rule; also migrated to `unionLabels`.
4. ~~**`UnderlyingPoint` shape + remap**~~ — `alignSeriesToLabels` now produces the `ChartPoint` `{date, value}` series directly; interface and remap deleted.
5. ~~**Dead `palettes` binding + exported internals**~~ — `palettes` const/`[palettes]` binding removed (every series sets `fill`); `PLOTTED_COLORS`/`plottedColor` are module-private.

Not fixed (documented, out of scope): spread-chart's pre-existing `console.log`s in computeds and its hand-rolled range math (adoption of the new utils is a separate refactor); dead `setOccIdInput` + stale input-box drift (pre-existing page bug); axis-name literal consts (stable names, cosmetic gain).

## Scope reviewed

- `src/app/features/savant-trader/components/options-contract-chart/options-contract-chart.component.ts` + `.html` — refactor: declarative `<e-series>` → computed `[series]` collection, `plottedSeries` input, span markers, pane gating
- `src/app/features/savant-trader/components/options-contract-chart/options-contract-chart-series.builder.ts` (new, review remediation)
- `src/app/features/savant-trader/components/options-contract-chart/options-contract-chart.component.spec.ts` (new)
- `src/app/features/savant-trader/utils/chart-series.utils.ts` (new, review remediation)
- `src/app/features/savant-trader/pages/option-chart/option-chart.component.ts` + `.html` — projection computeds + bindings
- `src/app/features/savant-trader/pages/option-chart/option-chart.component.spec.ts` (new)
- `src/app/features/savant-trader/stores/plotted-contracts-feature.ts` + spec — `chartFocusContractId` state, `allDates` endpoint coverage
- `src/app/features/savant-trader/stores/options-contract-viewer.store.ts` — focus flag on contract load
- `src/app/features/savant-trader/components/spread-chart/spread-chart.component.ts` — palette const swap only

## Standards axis

Initial findings: spec used `as unknown as`, `as never`, and a partial `as OHLCDatum` fixture (all banned verbatim by guidelines §10); dead `thetaColor`/`vegaColor` consts; `seriesCollection` returned `Record<string, unknown>[]` forcing the spec casts. **All fixed** — the extracted `ChartSeriesSpec` interface gives series a real contract, `onLegendRender` takes a narrowed structural type (no cast needed at call sites), the fixture builds a full `OHLCDatum`, dead consts deleted.

The claimed palette duplication was partially a false positive (agent could not diff; values differ at index 0 by design). Remediated anyway: `MULTI_SERIES_PALETTE` now lives in `chart-series.utils.ts`, spread-chart consumes it unchanged, and the options palette is `[MARK_COLOR, ...MULTI_SERIES_PALETTE.slice(1)]` — one canonical constant.

## Spec axis

Every acceptance criterion on #1263 met. All findings below remediated; the one deferral is documented at the bottom.

- **Loading-contract marker endpoints missed the axis union** — `allDates` only added endpoints for `status === 'loaded'` while the chart emits markers for `loading` contracts (openDate known, points empty). Fixed: `allDates` now adds `openDate` + `expiration` for every non-error contract. Regression test added.
- **Divergent marker-start derivations** — store used `data.startDate`, chart used first-rendered-observation. Fixed: the chart owns endpoint unioning; the store no longer derives a bare-ID start (it's always a rendered date anyway).
- **Underlying overlay interpolated across gaps** — the overlay filtered out missing dates, drawing a line across them. Fixed: underlying points now pad to the union with nulls + `emptyPointSettings: 'Gap'`, consistent with the mark lines' contract.

## Thermo-nuclear axis

Initial verdict "not approval-worthy as-is" — five majors, all remediated:

1. ~~**Marker-endpoint invariant lived in two layers**~~ — the chart produced span endpoints but outsourced "endpoints must be categories" to the store's `allDates` and the page's `chartAxisLabels`. Fixed with the review's own code-judo: the chart now computes `axisLabels` internally (rendered dates ∪ span endpoints). The page's label pick collapsed to `showPlottedSet() ? allDates() : xLabels()` and the store's endpoint union is now belt-and-suspenders, not load-bearing. New chart spec asserts the union.
2. ~~**Divergent set-view predicates**~~ — series projection filtered errors, label pick didn't, template used a third predicate. Fixed: one `showPlottedSet` computed consumed by all three sites.
3. ~~**`focusedPlottedId` was misnamed view intent**~~ — renamed to `chartFocusContractId` (it holds any loaded contract's ID, not just plotted ones), documented as chart-view intent, `clearPlottedFocus` → `clearChartFocus`.
4. ~~**Fourth copy of min/max + alignment logic**~~ — extracted `chart-series.utils.ts` (`alignSeriesToLabels`, `unionLabels`, `minMaxInRange`); the component uses all three and `visibleExtents` now reuses `axisRanges().underlying` instead of recomputing. Spread-chart adoption of the range helpers deferred — its range logic carries extra 5%-pad semantics worth a dedicated pass.
5. ~~**632-line component with ~270 lines of extractable pure code**~~ — extracted `options-contract-chart-series.builder.ts` (palette, `computeMarkerSpans`, `unionAxisLabels`, `buildSeriesCollection`, `LOWER_PANE_AXES`). Component is now 368 lines: inputs, computed wiring, effects, event handlers.

Also fixed from the minor list: `focusedOpenDate`'s transient `parsedOccId` dependency (deleted — openDate now reads straight from the plotted entry by ID); `o[f] as number | null` cast (typed `Exclude<keyof ParsedObservation, 'date'>`); spec's name-exclusion series filter (now role-based via `ChartSeriesSpec.role`).

## Test results

- Full suite (`npx jest`): **264/264 suites, 4554/4554 tests green** at review time.
- Post-remediation savant-trader run: 136/137 suites, 2655 passed / 10 failed — all 10 failures in the untracked `chart-view/` WIP (`getDoc.mockResolvedValue is not a function`, debug `console.log` left in spec), an unrelated parallel-work feature; not a regression from this task.
- `tsc --noEmit`: zero errors in touched files. Pre-existing unrelated errors in `scripts/bulk-swing-sweep.ts` and `indicator-config-dialog`/`chart-view` WIP remain.
- New coverage this task: 14 chart specs (multi-series, union padding, marker derivation/fallback/clamp, legend suppression, axis-union invariant, pane gating, union range) + 8 page projection specs + 6 focus/allDates feature specs.

## Deferred (conscious, documented)

- **Underlying overlay data in pure set view** — `underlyingBars` is only fetched for the loaded/focused contract, so the overlay is empty (not wrong) when viewing an unfocused set. Fetching underlying coverage for the plotted union belongs with the input/feeder work in #1264.
- **Spread-chart range-helper adoption** — `chart-series.utils.ts` exists for it; its extra pad semantics make it a separate refactor.
- **Store `xLabels` naming** — three similarly-named signals across layers (store `xLabels`, `allDates`, chart `axisLabels`); renaming the store's is cosmetic churn deferred to a natural refactor.
- **`focusPlotted`/`setHoveredContract` have no UI callers yet** — chips strip + hover land in #1264/#1265 as designed; the spec-flagged "scope creep" is the drill-down wiring the page already needed.
- **Legend toggling a mark line does not hide its marker** — cosmetic; candidate for #1265 polish.

## Known intentional behavior changes (from pre-refactor single view)

- Single-contract legend entry is the readable label (`600C 2026-01-16`) instead of literal `Mark`.
- A strike-span marker now renders in single mode (PRD: "lands on the single-contract chart first").
- Underlying overlay renders gaps rather than interpolating across missing dates.

## Next

`/proj qa 1243 1263`

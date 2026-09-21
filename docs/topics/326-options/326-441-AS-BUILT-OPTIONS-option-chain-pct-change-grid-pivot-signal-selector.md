**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid  
**Thread:** Pivot-signal selector  
**Thread Slug:** pivot-signal-selector  
**Issue:** #441  
**Thread Parent:** #359  
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** As-Built  
**Status:** Complete  
**Created:** 2026-09-21  
**Last Updated:** 2026-09-21  

# As-Built: Pivot-Signal Selector (Swing Compare)

## Overview

This thread added swing-aware run building to the option-chain
percent-change grid: pick a baseline (large) ZigZag swing set, pick a
frame swing inside it, pick a finer target set, and build comparison
runs from the small swings' pivot dates — each run produces one
heatmap grid per target date.

## What Was Built

### Store / feature (`option-chain-pct-change.store.ts`, `swing-compare.feature.ts`)

- Explicit `baselineSetId` / `targetSetId` / `frameSwing` state +
  `selectBaselineSet` / `selectTargetSet` / `selectFrameSwing` methods.
- `targetSetChoices` — saved analyses filtered to `devThreshold` lower
  than the baseline set's (baseline itself as fallback when nothing is
  finer, for the single-set case).
- `dateList` — merged confirmed pivots + signal barDates inside the
  frame, carrying labels, `pivotIsHigh`, `pivotPrice` (swing extreme),
  and signal directions. `mergeDateList`/`defaultTypeForStart` live in
  `utils/swing-compare.utils.ts`.
- `runs: SwingCompareRun[]` — `{ startDate, targetDates[], type }` with
  `addRun` / `removeRun`.
- `snapshotCache` (per-date `HistoricalOptionContract[]`) +
  `snapshotErrors` (per-date error strings) shared across runs.
  `ensureSnapshots` fetches missing dates with per-date `catchError`
  (one upstream failure can't sink a batch), clears stale errors on
  (re)fetch so retries show a loading state, and caps concurrency at 8
  (every call is a live Alpha Vantage fetch upstream; 75 req/min key).
- `loadSymbolSignals` / signal-history cache feeds signal dates into
  `dateList` — signals can be run starts or targets.

### FrameSwingPickerDialogComponent (`components/frame-swing-dialog.component.ts`)

- The complete builder, replacing the earlier inline pickers:
  Baseline Set dropdown → large zigzag chart + swing list → target set
  dropdown (finer `devThreshold` only) → small zigzag clipped to the
  frame window → start/target checkboxes → type → Add run.
- Small chart x-axis maps the frame's `[start,end]` window; out-of-frame
  pivots/swings are clipped (`frameChartGeometry` in utils).
- Pivot hairlines + rotated date labels at each confirmed in-frame
  pivot (red = swing-high, blue = swing-low) so chart swings are
  identifiable against the date list.
- Click-to-build: clicking a small swing toggles its endpoint dates as
  targets; the first click prefills start = swing start and type from
  direction (down→PUT, up→CALL); checked swings render highlighted.
- Runs commit directly to the store while the dialog stays open —
  multiple runs per session.

### Results (`components/swing-compare.component.ts`, `run-section.component.ts`)

- `SwingCompareComponent` reduced to the run list; each run renders a
  `RunSectionComponent` (collapsible, lazy grid per target date).
- Failed dates render a "snapshot unavailable" line with the callable
  error code (`unavailable` vs `resource-exhausted`) plus a retry
  button that refetches only that date.
- Layout density pass: zero-padding results area, removed the
  empty-state placeholder and the swing-compare border to maximize
  grid space.

### Backend (`functions/src/options-contract.callables.ts`)

- `getHistoricalOptionsChain` maps `PartnerHttpError` to real
  `HttpsError` codes: 429 → `resource-exhausted`, 404 → `not-found`,
  5xx → `unavailable` — with the partner status + body in the message.
  Previously every upstream failure arrived as undifferentiated
  `internal`.

## Deviations from the PRD

- **Dialog instead of inline pickers.** The PRD/IMPL described
  dropdowns + zigzag expandos inside the left panel; user feedback
  moved the entire builder into a Material dialog. `SwingSetPickerComponent`
  was built then deleted in favor of the dialog.
- **Explicit set selection.** The original design auto-derived
  baseline/target docs by `devThreshold`; the shipped version requires
  the user to pick both sets explicitly (target filtered to lower dev).
- **Per-date failure tolerance** was added beyond the PRD: the partner
  endpoint returns 502 `UPSTREAM_ERROR` for dates with no vendor data;
  the UI now isolates those failures per date instead of failing the
  run.

## Verification

- 340 tests green across the feature suite (store, utils, dialog,
  swing-compare, run-section, page, grid).
- `tsc --noEmit` clean on `tsconfig.app.json` + `tsconfig.spec.json`.
- Live QA: real QQQ swing sets, frame picking, run building, grid
  rendering, and upstream-failure paths exercised in the browser.

## Known Limitations

- Dates where Alpha Vantage has no options data surface as
  `unavailable: UPSTREAM_ERROR` per date — no client-side workaround;
  a Savant-side data gap.
- Computed grids are not yet cached server-side — the planned
  parameter-hash result cache is future work.

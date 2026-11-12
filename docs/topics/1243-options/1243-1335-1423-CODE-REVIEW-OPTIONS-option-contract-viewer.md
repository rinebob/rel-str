**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** OCC Contract String Group Generator  
**Thread Slug:** occ-string-generator  
**Issue:** #1335  
**Thread Parent:** #1325  
**Topic Parent:** #1243  
**Task:** #1423  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-11  
**Last Updated:** 2026-11-11  

# Code Review — Task #1423 (FE: Chart page layout — selector left, chips right, full-height chart)

**Verdict: PASS (Round 3)** — three convergent rounds. Round 2 passed all axes with minors; round 3 (delta-scoped) found one design-seam miss all three axes agreed on plus one residual twin — both fixed and spec-pinned. Focused suites 203/203; tsc + AOT clean.

## Round 3 re-review (delta-scoped — post-round-2 fixes only)

| Axis | Result |
|---|---|
| Standards | **PASS** — all 5 deltas verified; flagged the symbol-swap bypass hole |
| Spec | **PASS** — same hole flagged + the loadPlotted-worker pin twin |
| Thermo-nuclear | **FAIL→fixed** — named the correct seam (the `chartExtents` assigned-hook pattern) |

Round-3 findings, all fixed in-gate:

- **F1 — `rejectedEntries` clear covered only 1 of 4 symbol-switch paths.** The component wrapper cleared the notice for the textarea swap, but `onContractListDoc` (`?list=`/chooser), the analysis-doc path, and `onReplaySelected` call `page.onSymbolChange` directly — a stale `wrong-underlying` notice would re-render under the NEW symbol's name (`rejectionReasonLabel` reads `page.symbol()` live). Fix: `onSymbolSwitched` assigned-hook on `OptionChartPageService` (mirrors the existing `chartExtents` hook — DI can't run page→load), invoked inside `onSymbolChange`; the component assigns the clear in its ctor. The wrapper collapsed back to a thin alias; `switchSymbolForDoc` in list.service keeps the deduped guard.
- **N1-twin — `loadPlotted` worker error path didn't release hover/pin.** A pin set on a *loading* chip (allowed — its span already renders) that then failed stranded `pinnedContractId` on a dead spec → dim-everything, and error chips can't be clicked to unpin. Same equality-guarded clear as `loadContractInternal`/`removePlotted` added to the worker's catch (`plotted-contracts-feature.ts:290-303`).
- Spec pins: symbol-swap notice clear (component + page-hook level), failed-mid-load pin release (feature spec), container-leave bindings (DOM spec with real event dispatch).

## Round 2 re-review (same three axes, post-fix code)

| Axis | Result |
|---|---|
| Standards | **PASS** — all 6 findings verified fixed w/ regression coverage; 2 new minors (both fixed in-gate) |
| Spec | **PASS** — all 5 ACs met (AC3 center-header placement accepted as deviation); 1 new minor (fixed in-gate) |
| Thermo-nuclear | **PASS** — fixes are net simplifications; 1 new minor-major edge (fixed in-gate), deferreds confirmed |

Round-2 fixes landed during the gate:

- **Underlying chip kept the last contract lit** (Standards N-minor, Thermo N2): it lives inside `.plotted-chips` but had no enter/focus handler — sliding onto it held the previous contract's hover. Now `setHoveredContract(null)` on enter/focus (pin fallback shows). `option-chart.component.html:657-668`.
- **`rejectedEntries` staleness** (Spec minor, Thermo N3): a `?results=`/`emitEntriesToChart` send or a symbol swap left the stale "N entries skipped" notice visible — the M3 fix made the drawer-hide visible. Cleared in `emitEntriesToChart` (`option-chart-load.service.ts:114`) and in the component `onSymbolChange` wrapper (`option-chart.component.ts:106-111`).
- **Stranded pin on a failed foreign contract** (Thermo N1 — the round's worst new issue): `loadContractInternal`'s error branch released `chartFocusContractId` but not `hoveredContractId`/`pinnedContractId` — a pin on a catalog-row contract that failed stranded a dim-everything state with nothing lit. Same symmetric clear as `removePlotted` added to the error path (`options-contract-viewer.store.ts:200-212`).
- **Loading-chip hover analyzed, not a defect** (Thermo N4): loading contracts emit their span marker mid-fetch, so hover/pin on a loading chip lights a real span — legitimate. The failure path is covered by the N1 clear.
- **DOM binding pin added** (Standards gap note): real `mouseenter`/`mouseleave` dispatch on `.chip-main`/`.plotted-chips` asserts the template wiring (`option-chart-dom.spec.ts:151-173`); the fixture's contract fetch now resolves so chips reach `loaded` status.
- **Stray underlying chip in rejections-only aside**: gated on `chipContracts().length > 0`.

Deferred (consciously): `focusPlotted`/`clearChartFocus`/`isMultiMode` have zero production callers — `loadContract` is the live focus path; the drill-down UI-entry question is a thread-level follow-up, not a gate blocker. `selectDates` date-key granularity documented limitation. SCSS is 1,075 lines — was ~1,022 pre-diff (carry-over, not introduced).

## Round 1 (FAIL — superseded by Round 2)

One critical contract break shared by Standards + Thermo, four majors across the axes. Full suite was green (5460/5460) — the critical was a runtime hover-corruption path no spec exercised.

## Axes summary

| Axis | Result |
|---|---|
| Standards | 1 critical, 1 major, 3 minors, 6 nits — **FAIL** |
| Spec | 4/5 ACs met; right-column AC has a notice-visibility hole; narrow-width AC unimplemented — **FAIL** |
| Thermo-nuclear | 3 majors, 4 minors — **FAIL** |

## Critical (shared finding — Standards + Thermo, independently reached)

**C1. `seriesContractIds` ordinal map broken by the z-order reorder.**
`options-contract-chart-series.builder.ts` moves the highlighted mark to the
array end; `options-contract-chart.component.ts:384-392` still maps the k-th
`role:'mark'` spec → `contracts[k]` ("the builder pushes them in plottedSeries
order" — the docstring the reorder falsified). While a highlight is active,
`_Series_i` hover targets emit the wrong `contractId` → re-highlights a
different contract → re-reorders → ping-pongs per `mousemove`. No spec ever set
`highlightedContractId` on the hover path, so this escaped all 5460 greens.
**Fix:** carry `contractId` on `ChartSeriesSpec` for mark/marker roles; map
`s.contractId` — deletes the ordinal trick and the `MARKER_NAME_PREFIX` parse
for id resolution. Spec the highlighted-hover emission.

## Majors

| # | Axis | Finding | Fix |
|---|---|---|---|
| M1 | Thermo | Pin/hover survives focus claim and dims the drill-down — `loadContractInternal` sets `chartFocusContractId` but `highlightedContractId` still resolves → focused single contract renders at 0.25 in its own view | Gate the computed on `chartFocusContractId() == null` (feature.ts:88) |
| M2 | Thermo | 150 ms `hoverClearTimer` reimplements container-leave semantics — `mouseleave` on `.plotted-chips` already fires once on true exit; per-chip gaps are container interior | Container `(mouseleave)` + `(focusout)` w/ `relatedTarget` containment; delete timer + `ngOnDestroy` teardown |
| M3 | Spec | Rejected-token notice lives in the left drawer (html:393), drawer is default-closed, and if all tokens reject there is no chips panel at all — rejected emits can be totally invisible | Move `.rejection-notice` into `aside.chips-panel`; render the aside on `chipContracts().length > 0 \|\| rejectionNotice()` |
| M4 | Standards | `focusPlotted`/`clearChartFocus` zero production callers; `clearChartFocus` JSDoc promises a "chips 'back' affordance" that was never built | Fix the stale doc; focusPlotted's missing UI entry noted for follow-up (single-contract `loadContract` is the live focus path) |

## AC verdicts (Spec axis)

| # | Criterion | Verdict |
|---|---|---|
| 1 | Chip overflow scrolls inside right column; chart never shifts | MET (caveat: 0→1-chip transition reflows 200px once) |
| 2 | Selector/generator surfaces live in left column | MET |
| 3 | Mini-controls render while session active | MET — placed in center `.contract-header-bar`, not a right-column header (deviation, defensible) |
| 4 | Defined collapse/overflow at narrow widths | **UNMET** — no `@media` rule; chart compresses toward 0 under 540px of fixed panels |
| 5 | No regression `loadPlotted`/chip↔series hover/picker wiring; specs updated | **FAIL via C1** — the chip↔series hover path itself is the broken one |

## Minors / nits to fold in

- `DIM_OPACITY` literal 0.25 repeated 4× + width/size literals — builder's own const convention (`options-contract-chart-series.builder.ts:159-204`).
- `[class.pinned]` bound with no `.pinned` rule — pin needs a distinct visual from hover-highlight anyway (icon alone is subtle).
- `ms-menu-host` classes (html:63,145,176) vestigial post-`cdkConnectedOverlay` — no rule references them.
- Collapsed drawer keeps focusable controls under `aria-hidden` — `[attr.inert]` fixes tab order cheaply.
- `.side-panel` transitions `margin-right`; only `margin-left` collapse exists — harmless, declared together.
- Dimmed span can cross the lit mark (per-role-group z-order only) — lift the hot mark+span to the absolute end of the visual layer.
- `selectDates` selects whole dates — multi-pick Wednesdays can check >10 rows vs the 10 plotted. Date-keyed selection is by design; **documented limitation**, not a fix target.
- `(document:click)` host listener + per-menu `stopPropagation` could yield to `overlayOutsideClick` — optional.
- Feature-spec pin-clear paths (loadPlotted/removePlotted) uncovered — cheap pins.

## Test evidence

- Focused suites: 137/137, 58/58 — pass. Full suite: **308 suites / 5460 tests — all pass.**
- tsc clean; AOT build clean (pre-existing papaparse warning only).
- The C1 path (chart-side `seriesHovered` while `highlightedContractId` set) had **no coverage** — precisely the escaped bug.

## Round-2 fix list (to implement before re-review)

C1, M1, M2, M3, AC4 (@media rule), plus minors: DIM_OPACITY, .pinned style,
ms-menu-host removal, inert, absolute-end hot-pair ordering, feature-spec
pin-clear pins, stale JSDoc. Deferred: focusPlotted UI-entry question,
selectDates date-key granularity, overlayOutsideClick refactor.

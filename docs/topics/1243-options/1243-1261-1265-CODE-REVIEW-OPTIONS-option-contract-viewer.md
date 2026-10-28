**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** Multi-symbol input  
**Thread Slug:** multi-symbol-input  
**Issue:** #1261  
**Thread Parent:** #1244  
**Topic Parent:** #1243  
**Task:** #1265  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

## Scope

Connected chip↔series hover: `seriesHovered` output on the contract chart emitting the contract id under the pointer — `chartMouseMove` parses Syncfusion's rendered element ids (`_Series_{i}` for mark lines/points/symbols and span markers, `_chart_legend_{g|text|shape}_{i}` for legend items) through a series-index→contractId map; `chartMouseLeave` + non-series targets emit `null`; emissions deduped; page binds the output to `store.setHoveredContract`, so a chart-side hover lights the matching chip and dims the other series — completing the loop with the chip-side hover shipped in #1264.

Diff reviewed: working tree vs HEAD (`080b99a0`), 4 files, ~130 lines + 4 new specs. Three axes run in parallel (Standards, Spec, Thermo-nuclear); findings remediated in-cycle and re-verified.

## Findings & resolutions

### Remediated in-cycle

| Finding | Severity | Resolution |
|---|---|---|
| Legend index mapped via `plottedSeries()[g]` — worked only because marks land first; legend indices are actually visibleSeries positions and cancelled markers keep their slots (`legend.js:547-591`), so `g_2` in the spec was an unreachable DOM id | Minor (spec + TN, convergent) | Legend branch routes through `seriesContractIds()[g]` — the same domain as the `_Series_` branch; comment corrected; spec updated to the real underlying id `g_4` |
| Mark specs mapped to contracts by display label — two same-label contracts (e.g., different underlyings, same strike/expiration/type) collapse to the last, highlighting the wrong chip | Minor (spec + TN, convergent) | Marks map by ordinal — the k-th `role:'mark'` spec is the k-th `plottedSeries` entry, matching `buildSeriesCollection` order |
| Stale emitted hover across dataset changes — if `hoveredContractId` outlived its contract, every new series would render dimmed (builder dims all non-matching) until the next pointer event | Minor (TN) | `resetHoverOnSetChange` effect resets `lastHoverEmitted` and emits `null` when `plottedSeries` changes |

### Remediated nits in-cycle

- `onChartMouseMove(event: { target?: string })` → real `IMouseEventArgs` (same pattern as `flex-chart.component.ts`); `IMouseEventArgs.target` verified as the element id string at `chart.js:2315`.
- `lastHoverEmitted` tri-state (`undefined` sentinel) → initialized `null`; first redundant emit eliminated.
- Spec now covers `_text_`/`_shape_` legend child ids (hovering the label or glyph, not just the group box).

### Deferred (documented, non-blocking)

- Hover parsing + `seriesContractIds` could extract into `options-contract-chart-series.builder.ts` — component is ~440 lines, over the repo's 400-line smell threshold. Deferred as a future extraction alongside the chips-strip note from #1264's review.
- `lastHoverEmitted` vs direct store writes: programmatic `hoveredContractId` changes (non-pointer) can briefly desync the dedupe cache — self-correcting, low probability.
- Coverage gap per spec axis: the `(seriesHovered) → store` template binding is untestable in the page spec's non-rendered style — consistent with existing coverage; the `g_2`-style impossible-id gap was the only codified error.
- Nits: `<tspan>`-wrapped legend text emits null mid-label (labels don't wrap today); touch-drag keeps the touchstart element's emit (cosmetic); hover hit area is the stroke itself (1.5px dashed marker is a thin target — dots are the reliable affordance).

### Considered and rejected

- `runOutsideAngular` fast path (flex-chart precedent): the app runs zoneless change detection — DOM events don't schedule CD ticks; only signal writes mark dirty, and emissions are already deduped. No benefit here.
- `_shape_marker_` regex alternative: unreachable today (mark lines have `marker.visible:false`, markers are legend-cancelled) — kept as cheap defense.

## Axis results

- **Standards:** no majors; minors/nits listed above.
- **Spec:** all 6 ACs satisfied after remediation (chip enter/leave, dim/restore, series+legend→store, un-hover restore, marks+markers identical, specs both directions).
- **Thermo-nuclear:** no critical/major; verified `_Series_` index equals `seriesCollection()` order (stable zOrder sort), no false-positive ids reachable (no TrendLine/Trackball/DataLabel services configured), no emit→dim→rerender loop (order stable), tooltip/crosshair layers are `pointer-events:none`.

## Test evidence

- Focused: `npx jest src/app/features/savant-trader/components/options-contract-chart src/app/features/savant-trader/pages/option-chart` — 2 suites, 43 tests green (4 new hover specs).
- Full suite: 270 suites / 4,706 tests — 1 unrelated timeout flake in `option-chain.integration.spec.ts` (passed 215ms in isolation; option-chain table is outside this diff).
- `npx tsc --noEmit -p tsconfig.app.json` — clean. `npx ng build --configuration development` — clean (event bindings type-checked).

## Verdict

**PASS** — task may advance to `7_QA`.

## UAT notes for QA

The runtime id-mapping is verified against Syncfusion 30.2.7 source, not the live DOM — manual check should hover (a) a mark line mid-segment, (b) a span marker dot and its dashed line, (c) a legend label and its glyph, (d) the underlying line/legend entry (expect no chip, restore), (e) move off → restore; plus chip-hover regression.

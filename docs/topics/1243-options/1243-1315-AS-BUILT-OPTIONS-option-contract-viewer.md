**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** Multi-symbol input  
**Thread Slug:** multi-symbol-input  
**Issue:** #1315  
**Thread Parent:** #1244  
**Topic Parent:** #1243  
**Domain:** OPTIONS  
**Type:** AS-BUILT  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

## What was built

`/options/chart` extended from a single-contract mark viewer into a multi-contract time-series viewer. Pasted OCC IDs (optionally dated `YYYY-MM-DD,<id>`) load as a **Plotted Set** — each contract gets a colored mark line over the underlying overlay, dated entries get an entry→expiration strike-span marker, and a chips strip shows load progress/removal. One bare ID keeps the original rich single-contract view (IV/Greeks/volume/OI panes). Ship order: #1262 → #1263 → #1264 → #1265.

## Architecture

- **`shared/options-contract-contracts.ts`** — `PlottedEntry { contractId, openDate? }`: the plotted-pair contract crossing the FE/shared boundary.
- **`options-plotted-pairs` util + `plotted-contracts-feature.ts`** — parse (dedupe keeping earliest open date, rejection reasons) and `withPlottedContracts` store feature: `plottedContracts`, `plottedSeries`, `plottedLoadProgress`, `hoveredContractId`, `loadPlotted`.
- **`options-contract-chart-series.builder.ts`** — pure series construction: shared palette, mark lines (built first → legend indices 0..n-1), `__span__`-prefixed span markers (legend-cancelled but still consume legend indices), union category axis, aligned underlying overlay, clip-to-entry/lifetime window.
- **`options-contract-chart.component.ts`** — signals in/out: `plottedSeries`, `highlightedContractId`, `seriesHovered` output. `chartMouseMove` maps Syncfusion DOM ids (`_Series_{i}` marks+markers by mark ordinal; `_chart_legend_{g|text|shape}_{i}` via series index) to contract ids — never label-keyed. `chartMouseLeave` + dataset-change effect clear stale hover. `snapToData:false` crosshair + right-edge `underlyingAxis` crosshairTooltip.
- **`option-chart.component.*`** — pair textarea input, single-vs-plotted dispatch, chips (swatch keyed to non-error palette index, open date, spinner, remove), `Loaded X/Y` progress, >50 confirm, `(seriesHovered)` binding, in-header panel collapse.
- **`OptionsContractViewerStore`** — unchanged single-contract path; `loadPlotted` batch-loads alongside it.

## Decisions and deviations from plan

- **Hover semantics changed mid-flight**: "chip focus" originally implied single-contract drill-in; user clarified it means *highlight the loaded line, dim the rest, keep everything rendered* — implemented as opacity emphasis over `hoveredContractId`, no refetch (#1264 QA refinement, #1265 reverse direction).
- **Span markers anchor to `openDate`** (strategy selection date), not first trading observation, per user correction.
- **Clip defaults to lifetime** — the "Clip to entry" header toggle applies on demand; not defaulted-on per user correction.
- **Crosshair freed** (`snapToData:false`) + opposed-axis tooltip restored for the right-edge underlying price readout.
- **Legend index domain**: Syncfusion increments legend indices for cancelled entries — hover mapping routes through series order, not `plottedSeries` position, verified against ej2-charts@30.2.7 source.
- **Mark→contract mapping is ordinal**, not label-keyed — same-label contracts across underlyings cannot mis-highlight (found in #1265 review).

## Deferred

Normalized (percent) mode; catalog multi-select; Contract List/pick-doc handoff; cadence filtering; router state; multi-leg templates; cross-underlying axis handling (v1 same-underlying); extraction of hover-id parsing into the series builder (component ~440 lines).

## Gate record

| Task | Review | QA | UAT |
|---|---|---|---|
| #1262 parser+store | PASS | #1268 | 8/8 PASS |
| #1263 multi-series chart | PASS | #1287 | 9/9 PASS |
| #1264 input+chips+progress | PASS | #1292 | 10/10 PASS |
| #1265 connected hover | PASS | #1315 | 8/8 PASS |

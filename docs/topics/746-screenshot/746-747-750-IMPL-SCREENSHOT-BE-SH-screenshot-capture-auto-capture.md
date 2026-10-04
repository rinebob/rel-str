**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Auto-Capture  
**Thread Slug:** auto-capture  
**Issue:** #750  
**Thread Parent:** #747  
**Topic Parent:** #746  
**Domain:** SCREENSHOT  
**Type:** IMPL  
**Area:** BE-SH  
**Status:** Draft  
**Created:** 2026-10-03  
**Last Updated:** 2026-10-03  

# Implementation Plan — BE-SH: Chart Screenshot Capture

## Scope

Backend + shared contracts: a callable Cloud Function that renders the quick-charts chart server-side to SVG, derives a PNG, writes both to Firebase Storage, and returns the SVG inline plus paths. No browser, no DOM serialization anywhere in the pipeline.

## Module layout

```
shared/
  screenshot-capture-contracts.ts   — spec + response types, ChartInterval (canonical), CaptureEvent, PositionType
  screenshot-capture-utils.ts       — buildScreenshotStoragePath (path convention), buildCaptureChartResult
  flex-chart-theme.ts               — canonical chart palette + stripLine builder (FE + functions share it)
  flex-chart-scale-math.ts          — canonical log transform, nice ticks, price formatting (FE + functions)
  flex-chart-indicator-visuals.ts   — canonical indicator visual vocabulary: zone/uptick/signal/trend-strength/std-dev/HTF-window colors, axes, reflines (FE + functions)

functions/src/screenshot-capture/
  capture-chart.ts                  — captureChartSnapshot callable (orchestration only)
  chart-data-loader.ts              — Firestore bars + computeSymbolIndicatorSeries → models per interval
  chart-data-assembler.ts           — slice window + pane assembly → render model (pure)
  chart-series-mappers.ts           — per-family series mappers (bands/std-dev/zones/TS/dots/windows, pure)
  render-model.ts                   — render-model types (assembler ↔ renderer seam)
  svg-renderer.ts                   — render model → SVG string (primitives)
  svg-primitives.ts                 — candle / line / scatter / column / rangeFill / text emitters
  svg-layout.ts                     — pane layout, axis scales, bar-grid metadata
  chart-theme.ts                    — dark palette re-export + capture-only additions (event marker, color remap)
  rasterizer.ts                     — SVG → PNG via @resvg/resvg-js + bundled font
  storage-writer.ts                 — bucket writes, path convention
  assets/                           — bundled .ttf for rasterizer text
```

Review remediation (#766): the FE `chart-theme.ts`, `log-transform.ts`, and
`price-format.ts` were hoisted to `shared/` rather than duplicated — the FE
files re-export the shared modules (same pattern as `ChartInterval` in
`indicator-computation.ts`/`indicator.types.ts`).

Review remediation (#767): the indicator visual vocabulary (zone ±4 colors,
uptick/signal dot colors, trend-strength colors/axis/reflines, std-dev
palette/dash/opacity/period, HTF window colors) was likewise hoisted to
`shared/flex-chart-indicator-visuals.ts` — previously literal copies in the
FE indicator files and the assembler. `st-zone.indicator.ts` keeps its own
±3 table (pre-existing FE inconsistency, distinct from the callable-path ±4
table — flagged for a separate FE decision, not unified here).

`index.ts` exports the callable. Callable file stays thin — parse spec → assemble → render → rasterize → store → return.

## Contract (SHARED)

Implemented in `shared/screenshot-capture-contracts.ts` (shapes) +
`shared/screenshot-capture-utils.ts` (path builder `buildScreenshotStoragePath`
+ result assembler `buildCaptureChartResult`), aliased as
`@screenshot-capture/contracts` and `@screenshot-capture/utils`.
`ChartInterval` is the canonical enum in the contracts file — the previous
duplicates in `indicator-computation.ts` and `indicator.types.ts` re-export it.

```ts
enum CaptureEvent { 'order-placed' | 'order-filled' | 'position-closed' | 'manual' }
enum PositionType { 'stock' } // option types reserved for follow-on Thread
type CaptureInterval = ChartInterval.DAILY | ChartInterval.WEEKLY; // monthly out of scope

interface CaptureChartSpec {
  symbol: string;
  intervals?: readonly CaptureInterval[]; // default [daily, weekly]
  event: CaptureEvent;
  positionType: PositionType;
  refId?: string;                // opaque caller key → path (6-char) + header
  width?: number;                // px, default TBD card-width preset
  height?: number;
  visibleBars?: number | 'all';  // default 30 (matches quick-charts); 'all' = full series
}

interface CaptureArtifact {      // one per requested interval
  interval: CaptureInterval;
  svg: string;                   // inline markup for immediate client use
  svgPath: string;
  pngPath?: string;
}

interface CaptureChartResult {   // svg/paths derived from artifacts by
  svg: string;                   // buildCaptureChartResult — artifacts is
  paths: string[];               // canonical, top-level fields are conveniences
  artifacts: CaptureArtifact[];
}
```

## Data assembly

Reuse in-process (no self-callable):

- `getCachedBarsFromSymbolData(symbol, marketDate)` → daily/weekly/monthly bars
- `computeSymbolIndicatorSeries(symbol, daily, weekly, monthly)` → `SymbolIndicatorSeriesResponse`
- `functions/src/indicators/std-dev-lines.ts` → ST Std Dev Lines computed from the same bars (user requirement — **not** part of quick-charts' default indicator list; FE-parity is asserted by a spec that diffs the assembler's emitted series against the actual FE `computeStdDevLinesSeries` output on shared fixture bars)
- FE extras equivalents: HTF zone windows + signal/uptick dot markers already arrive inside the indicator-series response (`dotMarkers`, `htfWindows`) — map them, don't recompute
- Zigzag: not rendered (excluded by spec even though flex-chart supports it)

Slice each interval's bars + all series to the last `visibleBars` (default 30 D / 30 W; `'all'` = full series, no slice — whole-chart view for dev inspection) — "current chart," no as-of truncation.

## Renderer design

SVG primitives, flex-chart visual language, dark palette from `chart-theme.ts`:

- **Main pane:** candles (bull/bear fills), trend bands as behind-price candle bodies (z-order equivalent), std-dev range-area fills + lines, uptick dots overlay, HTF window shaded rects, event marker on latest bar
- **Lower panes:** signal dots (`lower-1`), zone V1/V2 + trend strength per default pane assignment, HTF window (`lower-3`); pane heights proportional to quick-charts
- **Header strip:** symbol · event · timestamp · positionType · refId · interval — one text row
- **Axes:** right-side price labels (crop-friendly), minimal x-date ticks, log-scale option mirroring `logScale` default true
- **Bar-grid metadata on SVG root:** `data-plot-x`, `data-bar-width`, `data-bar-count` — enables client-side viewBox crop ("quick zoom to last N bars") without re-render

## Rasterization

`@resvg/resvg-js` → PNG at spec dimensions. Two deploy concerns:

1. **esbuild external:** add `--external:@resvg/resvg-js` to the functions build — napi binary must not be bundled
2. **Font:** resvg needs a font for text — bundle one .ttf under `assets/` and `loadFont` at init; keep header/axis text to one family/size ramp

## Storage

`admin.storage().bucket()` (default bucket = GCS). Path convention is owned by `buildScreenshotStoragePath` in `shared/screenshot-capture-utils.ts`:

```
st-trade-screenshots/{SYMBOL}/{yyyy-MM-dd}-{HHmmss}-{event}-{positionType}[-{refId6}]-{interval}.{svg,png}
```

- `HHmmss` guarantees same-day same-event captures never overwrite.
- `refId`, when present, is sanitized to alphanumerics + truncated to 6 chars and appended before the interval segment.
- `st-trade-screenshots` follows the `st-` domain-prefix convention and stays distinct from the trade journal's `trades/.../screenshots` segment.

## Error contract

- `invalid-argument` — missing/invalid spec fields (symbol, event, positionType not `'stock'`)
- `failed-precondition` — insufficient bars (`< visibleBars`)
- `internal` — renderer/rasterizer/storage failure, logged with symbol+spec

## Build/deploy touchpoints

- `functions/package.json` deps: `@resvg/resvg-js` (pinned ≥7-day-old release)
- `functions/package.json` build script: add `--external:@resvg/resvg-js`
- `functions/src/index.ts`: export `captureChartSnapshot`

## Risks

| Risk | Mitigation |
|---|---|
| resvg font rendering differs from browser text | bundle one font; snapshot-test SVG structure, eyeball PNG on dev page |
| std-dev-lines parity FE vs BE math | verify against `st-std-dev-lines.indicator.spec.ts` fixtures |
| pane layout drift vs quick-charts | dev page shows captures next to real chart; iterate |

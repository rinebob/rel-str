**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Auto-Capture  
**Thread Slug:** auto-capture  
**Issue:** #784  
**Thread Parent:** #747  
**Topic Parent:** #746  
**Task:** #766  
**Domain:** SCREENSHOT  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-04  
**Last Updated:** 2026-10-04  

# UAT — #766 SVG renderer: render model → deterministic SVG

## Scope

Server-side SVG renderer: `render-model.ts` (pane/series contract — series order = paint order, windows as pane-level layers, final colors in the model), `svg-layout.ts` (chartRows-equivalent height split, log/linear scales, ticks), `svg-primitives.ts` (candle/line/range/scatter/column/refline/gridline/text emitters), `svg-renderer.ts` (assembly + metadata header + `data-*` crop attributes), `chart-theme.ts` (dark palette + light-vocab remap). Shared hoists: `shared/flex-chart-theme.ts`, `shared/flex-chart-scale-math.ts` (FE files re-export). No runtime caller yet — #767 assembles models, #768 rasterizes.

## Prerequisites

- Repo checkout at `C:\aa\projects\rel-str`; `npm install` + `functions/npm install` done.
- No credentials or network required — renderer operates on a fixed fixture; the #767 verify additionally exercises it on real data.

## Scenarios

### 1. Renderer unit suite

- **Steps:** `npx jest tests/functions/screenshot-capture --coverage=false`
- **Expected:** all specs pass — well-formed SVG from the fixed model (candle rects, line paths, scatter dots, column bars, header text, event marker), per-pane layering (gridlines under linear, over log stripLines), reflines, empty-pane omission, flat-range NaN fallback, non-finite point filtering, pane order contract.
- **Result:** PASS — 39 renderer/layout/primitives specs green (post-round-2 focused sweep).

### 2. Well-formedness + crop metadata + determinism

- **Steps:** `cd functions && npx tsx scripts/verify/screenshot-capture-766-render.ts`
- **Expected:** 9/9 checks — XML tag balance, `data-plot-x`/`data-bar-width`/`data-bar-count` present, no `NaN`/`undefined` in markup, byte-identical output on identical input; writes `.devin/tmp/screenshot-capture-766/screenshot-766-daily.svg`.
- **Result:** PASS — 9/9.

### 3. Real-data render via #767 pipeline

- **Steps:** `cd functions && npx tsx scripts/verify/screenshot-capture-767-assemble.ts GOOG 60` — drives the same renderer against live assembled models.
- **Expected:** 20/20; daily + weekly SVGs in `.devin/tmp/screenshot-capture-767/`.
- **Result:** PASS — 20/20.

### 4. Visual parity (manual)

- **Steps:** open the generated SVGs in a browser; compare against a live quick-chart.
- **Expected:** quick-charts dark language — teal/red candles, band layers behind price, dashed std-dev lines, amber event marker, lower panes below price.
- **Result:** PASS — user confirmed ("looks good", 60-bar daily + weekly).

### 5. Compile gates

- **Steps:** `cd functions && npx tsc --noEmit`; `npx tsc -p tsconfig.app.json --noEmit`.
- **Expected:** both clean — `@flex-chart/theme`/`@flex-chart/scale-math` aliases resolve in both surfaces; FE shims re-export correctly.
- **Result:** PASS — exit 0 both.

### 6. Full-suite regression

- **Steps:** `npx jest --coverage=false`
- **Expected:** no suite broken by the shared/ hoist + shim conversion.
- **Result:** PASS — 183 suites / 2674 tests.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Well-formed SVG: candles, lines, scatter, header, marker | 1, 2 |
| `data-plot-x`/`data-bar-width`/`data-bar-count` crop metadata | 1, 2 |
| Deterministic output | 2 |
| Verify script 9/9; visual quick-charts language | 2, 3, 4 |
| Review findings addressed | 1–6 |

## Execution log

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Renderer specs | PASS | 39 specs green |
| 2 | Verify 766 | PASS | 9/9 — balance, metadata, determinism |
| 3 | Verify 767 (real data) | PASS | 20/20 — GOOG 60 bars |
| 4 | Visual parity | PASS | user confirmation |
| 5 | Compile gates | PASS | both tsc exit 0 |
| 6 | Full suite | PASS | 183 / 2674 |

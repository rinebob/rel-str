**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Auto-Capture  
**Thread Slug:** auto-capture  
**Issue:** #791  
**Thread Parent:** #747  
**Topic Parent:** #746  
**Task:** #767  
**Domain:** SCREENSHOT  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-04  
**Last Updated:** 2026-10-04  

# UAT — #767 Chart data assembler: bars + indicator series → render model

## Scope

Server-side chart-data pipeline for `captureChartSnapshot`: `chart-data-loader.ts` (Firestore bars → `computeSymbolIndicatorSeries` → `assembleRenderModel` per interval), `chart-data-assembler.ts` (slicing, pane assembly, options), `chart-series-mappers.ts` (per-family series mapping), plus the `shared/flex-chart-indicator-visuals.ts` canonical vocabulary consumed by FE indicators + assembler. No callable endpoint yet (#769) — acceptance is at the render-model/SVG-artifact seam.

## Prerequisites

- Repo checkout at `C:\aa\projects\rel-str`; `npm install` + `functions/npm install` done.
- Firestore access for the real-data verify script (GOOG symbol data must be cached — it is).
- Node IPv4 preload for Firestore/network commands if DNS hangs: `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs`.

## Scenarios

### 1. Assembler unit suite — series coverage, slicing, pane omission

- **Steps:** `npx jest tests/functions/screenshot-capture/chart-data-assembler.spec.ts --coverage=false`
- **Expected:** all specs pass — expected-series presence (zones V1/V2, trend-strength columns + signal dots, trend bands, std-dev lines/fills, uptick dots, HTF windows), `visibleBars` slicing index-aligned on bars + every series, `'all'` renders full history, `0`/negative/fractional `visibleBars` reject, zigzag absent, pane omission for absent AND present-but-empty indicator families, neutral-HTF single-layer resolution, weekly → monthly window wiring.
- **Result:** see Execution log.

### 2. Std-dev deep parity vs FE implementation

- **Steps:** same suite — the parity spec diffs all 17 lines (data, width, dash, remapped color) and all 10 fills (data, opacity, color) positionally against real FE `computeStdDevLinesSeries` output on shared fixture bars.
- **Expected:** positional equality — a BE band-math divergence fails the spec.
- **Result:** see Execution log.

### 3. Real-data end-to-end verify (GOOG, 60 bars, daily + weekly)

- **Steps:** `cd functions && npx tsx scripts/verify/screenshot-capture-767-assemble.ts GOOG 60`
- **Expected:** `20/20 checks passed`; writes `.devin/tmp/screenshot-capture-767/screenshot-767-daily.svg` + `…-weekly.svg` with `data-bar-count="60"`, pane order `main,lower-3,lower-2,lower-1`, lower-1 axis ±50, lower-3 axis ±7, no `NaN`/`undefined` in markup, all series x within `[0,60)`.
- **Result:** see Execution log.

### 4. Visual parity — generated SVGs vs live quick-chart (manual)

- **Steps:** serve the artifacts (`cd .devin\tmp\screenshot-capture-767 && npx http-server -p <port>` or any static server), open `screenshot-767-daily.svg` and `screenshot-767-weekly.svg` in a browser; compare pane-for-pane against the GOOG quick-chart in the app (same symbol, trailing 60 bars).
- **Expected:** ST look — trend-band candle layers behind price candles, std-dev channel (center + band lines + fills), V1/V2 uptick dots on main; lower-3 zone V2 dots + window dots on ±7 axis; lower-2 zone V1 dots; lower-1 trend-strength histogram + shadow columns + signal dots on ±50 axis with threshold reflines; weekly mirrors with monthly windows.
- **Result:** pending user confirmation (post-remediation re-check).

### 5. Compile gates

- **Steps:** `cd functions && npx tsc --noEmit`; `npx tsc -p tsconfig.app.json --noEmit` (repo root).
- **Expected:** both exit 0 — the `@flex-chart/indicator-visuals` alias resolves in both compilation surfaces and every FE consumer typechecks against the shared module.
- **Result:** see Execution log.

### 6. Regression — full jest suite

- **Steps:** `npx jest --coverage=false`
- **Expected:** no suite broken by the shared-constants hoist (FE indicator files now consume `shared/flex-chart-indicator-visuals.ts`).
- **Result:** see Execution log.

### 7. Manual UI/UX refinement pass

- The deliverable has no app UI surface (the SVG artifact is the user-visible product). The visual-parity scenario (4) is the refinement pass.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Render model contains all expected series (zones, TS, bands, std-dev, dots, HTF windows) | 1, 3 |
| `visibleBars` slicing index-aligned; `'all'` = full series; invalid values reject | 1 |
| Zigzag absent; std-dev matches expected band computation | 1, 2 |
| Empty panes omitted; FE pane order | 1, 3 |
| Verify script 20/20; SVGs match live quick-chart | 3, 4 |
| Compile/alias wiring in both surfaces | 5 |
| Review findings addressed | 1–6 (fixes are what the scenarios exercise) |

## Regression / smoke

- Full suite — scenario 6.
- `…-766-render.ts` verify — 9/9 (renderer fixtures unchanged in behavior by #767 contract updates).

## Execution log

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Assembler unit suite | PASS | 24 specs green (jest, post-remediation) |
| 2 | Std-dev deep parity | PASS | positional diff — 17 lines + 10 fills vs `computeStdDevLinesSeries` |
| 3 | Real-data verify | PASS | 20/20, GOOG 60 bars, daily+weekly |
| 4 | Visual parity (manual) | PASS | user confirmed 60-bar daily + weekly SVGs match expected ST look |
| 5 | Compile gates | PASS | functions tsc + app tsc exit 0 |
| 6 | Full suite | PASS | 183 suites / 2674 tests |
| 7 | UI/UX refinement | N/A→4 | no app UI; scenario 4 is the visual pass |

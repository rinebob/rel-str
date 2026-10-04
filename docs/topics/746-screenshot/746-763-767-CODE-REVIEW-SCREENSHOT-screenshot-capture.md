**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Auto-Capture  
**Thread Slug:** auto-capture  
**Issue:** #763  
**Thread Parent:** #747  
**Topic Parent:** #746  
**Task:** #767  
**Domain:** SCREENSHOT  
**Type:** CODE-REVIEW  
**Status:** Approved  
**Created:** 2026-10-04  
**Last Updated:** 2026-10-04  

# Code Review — #767 chart data assembler

## Scope reviewed

- `functions/src/screenshot-capture/` — `chart-data-assembler.ts`, `chart-data-loader.ts` (new); `render-model.ts`, `svg-renderer.ts` (contract changes during #767: windows → layer array, model carries final colors)
- `tests/functions/screenshot-capture/chart-data-assembler.spec.ts` (new); `svg-renderer.spec.ts` (fixture updates)
- `functions/scripts/verify/screenshot-capture-767-assemble.ts` + `screenshot-capture-767.md` + `run-all.ts`/`README.md` registration
- `functions/src/st-cloud-function/signals.ts` (ambient `FirebaseFirestore.*` → explicit type imports)
- Post-remediation additions: `shared/flex-chart-indicator-visuals.ts` (canonical indicator visual vocabulary); `chart-series-mappers.ts` (per-family mappers split); `functions/scripts/verify/svg-check.ts` (shared tag-balance helper); `@flex-chart/indicator-visuals` alias in `tsconfig.json`, `functions/tsconfig.json`, `jest.config.js`; FE consumers updated in place (`indicator-converters.ts`, `st-zone-v2.indicator.ts`, `st-trend-strength.indicator.ts`, `st-std-dev-lines.indicator.ts`, `signal-marker-converters.ts`, `base-indicators.ts`, `indicator-computation.ts`)

## Standards axis

3 documented-standard findings + ~8 judgement calls. All remediated.

- **violation → fixed** — `chart-data-assembler.ts` at 482 lines crossed the 400-line strong-smell threshold (guidelines §1). Split into `chart-data-assembler.ts` (212 — options, slicing, pane assembly) + `chart-series-mappers.ts` (330 — seven per-family mappers + helpers).
- **violation → fixed** — FE-visual constants duplicated: `ZONE_COLORS` was the 4th copy in the repo (converters, zone-v2, zone-local, assembler); uptick/signal/TS/std-dev constants were 2nd copies — the guidelines' own "duplication with an intentional comment" anti-pattern (§2). Hoisted to `shared/flex-chart-indicator-visuals.ts`; FE files consume it via `@flex-chart/indicator-visuals`. Note: `st-zone.indicator.ts` (local V1 calc) keeps a genuinely *different* ±3 table — a pre-existing FE inconsistency, deliberately not unified (documented in the module header + IMPL doc).
- **judgement → fixed** — `toOhlcv` duplicated private `barsToOhlcv` (indicator-computation.ts). Exported and shared.
- **judgement → fixed** — `DEFAULT_CAPTURE_WIDTH/HEIGHT` exported from the assembler while sibling defaults lived in `shared/screenshot-capture-contracts.ts`. Moved to contracts.
- **judgement → fixed** — 767's SVG well-formedness check was weaker than 766's `checkXmlBalance`. Extracted to `scripts/verify/svg-check.ts`; both scripts share it.
- **naming → fixed** — `RenderPaneWindows` named one layer, not a window set → `RenderPaneWindowLayer`; `upV1/upV2` → `zoneV1Upticks`/`zoneV2Upticks`.
- **noted, not changed** — `getCachedBarsFromSymbolData` swallows load errors → empty bars → a valid-but-empty model. Pre-existing loader behavior; the callable's `failed-precondition` contract (#768+) is the right place to surface it.
- **verified clean** — every external contract call checked against real signatures (`getCachedBarsFromSymbolData`, `computeSymbolIndicatorSeries`, `computeStdDevLines`); no `as any`/`as never` anywhere; spec uses the real pipeline, not type-erased mocks; verify script matches conventions and is registered.

## Spec axis

All three acceptance criteria MET after remediation; FE parity verified line-by-line against the actual converter/indicator sources.

- **partial AC → fixed** — the std-dev parity spec only diffed the center line + asserted counts; the IMPL doc requires a diff "against the actual FE `computeStdDevLinesSeries` output." The spec now positionally diffs **all 17 lines** (data, width, dash, remapped color) and **all 10 fills** (data, opacity, color) against real FE output on shared fixture bars.
- **contract gap → fixed** — `render-model` documented "inactive panes are omitted" but present-but-empty data (all-null zone arrays when `bars < warmup`) produced zero-point panes. Assembler now emits a lower pane only when a series has ≥1 point (`hasPoints`), matching `chartRows` collapse. Spec covers `indicators: {}` and all-null zone arrays.
- **dead code → fixed** — `htfKey` monthly else-branch was unreachable (`CaptureInterval` is daily|weekly). Replaced with an exhaustive `Record<CaptureInterval, 'weekly'|'monthly'>` — a new interval now forces a compile error.
- **verified correct** — slicing + rebase to `[0, barCount)`; `'all'` skips slicing; z-order (bands → price → fills → lines → dots; HTF column behind primary; connector behind scatter); zone ±4 colors = converter table; price-candle `#ef5350` correctly *not* remapped; pane order main → lower-3 → lower-2 → lower-1; axes ±7/±50 + reflines; zigzag never emitted; backend `trendStrength` math-identical to the FE inline calculator (FE's backend-data refusal targets stale deployed responses — parity-safe in-process).

## Thermo-nuclear axis

Verdict **MET** — both hard design calls confirmed as the right judo: remap-in-assembler over the `#ef5350` collision (renderer can't distinguish color provenance), windows-as-pane-layer preserving "series order = paint order." Findings below all remediated.

- **major → fixed** — constants duplication (the Standards finding above; both axes converged on the shared-module judo).
- **major (latent) → fixed** — the pane-omission contract gap above.
- **minor → fixed** — neutral HTF zone (`zone === 0`) emits *both* window dots on one bar; grouping layers by color alone double-painted green+red over the same range. `htfWindowLayers` now resolves each bar to one layer — its single dot color, or a neutral layer — and a spec asserts no bar is covered by two layers.
- **minor → fixed** — inconsistent rebase bounds enforcement: only `dotMarkerSeries` bounded `x < len`; over-long input arrays could leak `x ≥ barCount` points. Every mapper now clamps via `windowEnd`/`rebaseIndex`.
- **minor → fixed** — `visibleBars` unvalidated: `0` → `slice(-0)` = silently full; negatives dropped from the front. Now throws on non-positive/non-integer; spec asserts `0`, `-5`, `2.5` reject.
- **test quality → fixed** — spec:381 misnamed ("lower-1-only" but asserted main-only) → renamed; weekly test strengthened (asserts monthly windows actually wired through the weekly→monthly key); added `visibleBars > bars.length`, pane-omission, neutral-layer, and validation cases.
- **noted** — `zoneSeries`/`htfWindowDots` key by position/date like FE; only `dotMarkers` rebase by `m.index` — matches the response's own contract (markers carry `index`, series are bar-aligned).

## Test results

- `tests/functions/` — 79 tests green (24 assembler specs including deep std-dev parity)
- Affected-surface sweep (`flex-chart` + `chart-indicators` + `tests/functions`) — 263 tests green
- Full suite — 181 suites / 2649 tests green (pre-remediation baseline; remediation deltas covered by the two runs above + both tsc builds)
- `functions tsc --noEmit` clean; `tsconfig.app.json --noEmit` clean
- `scripts/verify/screenshot-capture-767-assemble.ts` — 20/20 (GOOG, 60 bars); `…-766-render.ts` — 9/9

## Round 2 — remediation verification + fresh pass

Both reporting axes verified all 12 round-1 fixes landed (VERIFIED-FIXED each, file:line evidence). Thermo-nuclear verdict: **MET** — contracts structurally sound, no import cycles, bounds uniform, neutral-window resolution correct. The fresh pass found one real residual: the round-1 hoist missed sibling copies of the same vocabulary. All remediated.

- **violation → fixed** — `st-signal-dots.indicator.ts` still held literal `LONG_COLOR`/`SHORT_COLOR`/`DOT_OFFSET` duplicating `ST_SIGNAL_DOT_COLORS` + the offset in `indicator-computation.ts`. Hoisted `ST_SIGNAL_DOT_OFFSET`; file now consumes the shared module.
- **violation → fixed** — `st-zone-window.indicator.ts` still hardcoded long/short colors + `y: ±6` duplicating `ST_HTF_WINDOW`. Migrated; also fixed a pre-existing doc bug (header said long at +6 / short at −6; the code has always been the reverse).
- **violation → fixed** — `TREND_BAND_COLORS` duplicated verbatim between `indicator-computation.ts` and `st-trend-bands.indicator.ts`. Hoisted as `ST_TREND_BAND_COLORS`; both consume it.
- **nit → fixed** — `st-zone.indicator.ts` neutral refline literal → `{ ...ST_ZONE_NEUTRAL_REFLINE, label: 'Neutral' }` (its ±3 color table stays per the documented divergence).
- **nit → fixed** — assembler header claimed `hasPoints` "mirrors `chartRows`"; chartRows keys on series *presence*, `hasPoints` is stricter. Comment corrected; `zoneSeries` guard aligned to `!points?.length`.
- **considered, not changed** — `ST_ZONE_FALLBACK_COLOR` reused as a generic scatter fallback (correct value, cosmetic name); thin `const X = SHARED.x` re-alias locals (readability aid, consistent pattern); `ST_HTF_WINDOW.neutralColor` placement (doc-defended, capture-only). Pre-existing `barsToOhlcv` twins in `backtest-*` files — out of scope.

### Round-2 verification

- Focused sweep (screenshot-capture + flex-chart + flex-chart-sandbox) — 19 suites / 268 tests green
- `functions tsc --noEmit` clean; `tsconfig.app.json --noEmit` clean
- `scripts/verify/screenshot-capture-767-assemble.ts` — 20/20 (GOOG, 60 bars)

## Verdict

**PASS** — two remediation rounds. Round 1: shared indicator-visuals hoist (structural parity, eliminates the 4th/2nd constants copies), file split, pane-omission contract made true, neutral-window shading fix, deep std-dev parity coverage, bounds/validation hardening. Round 2: the remaining vocabulary copies (`st-signal-dots`, `st-zone-window`, `TREND_BAND_COLORS`) migrated — every literal duplicate of the shared module is now gone. No critical or major findings remain; residual items are cosmetic and documented.

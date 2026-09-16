**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST ZigZag Indicator  
**Thread Slug:** st-zigzag  
**Issue:** #325  
**Thread Parent:** #322  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Implementation Plan  
**Status:** Draft  
**Created:** 2026-09-15  
**Last Updated:** 2026-09-15  

---

# FE Implementation Plan: ST ZigZag Indicator

## Overview

All ZigZag computation is FE-side. No BE callable, no BE engine module.
The FE computes pivots inline from bars already loaded in the chart,
derives swings, computes stats, renders a chart overlay + a separate
analysis page, and persists swing analyses directly to Firestore.

## Modules

### 1. Pure Engine — `st-zigzag.engine.ts`

**Location:** `src/app/features/shared/components/flex-chart/indicators/st-zigzag.engine.ts`

A pure, framework-agnostic module containing all ZigZag computation logic.
No Angular dependencies. Imported by both the chart indicator and the
analysis page.

**Exports:**

- `ZigZagConfig` interface — `{ devThreshold, leftDepth, rightDepth, allowZigZagOnOneBar, projectionPivots }`
- `Pivot` interface — `{ barIndex, time, price, isHigh, confirmed }`
- `Swing` interface — `{ direction, start, end, magnitudePercent, magnitudeAbsolute, duration, volume, confirmed }`
- `SwingStats` interface — distribution summary + histogram data per direction
- `computeZigZagPivots(bars: PriceBar[], config: ZigZagConfig): { pivots: Pivot[], projection?: Pivot }` — batch pivot detection ported from TradingView's `findPivotPoint` + `newPivotPointFound` + `findProjectionPivot` + `updateProjectionPivot`
- `deriveSwings(pivots: Pivot[], projection?: Pivot): Swing[]` — segments between consecutive pivots, with the projected swing as the last entry (`confirmed: false`)
- `computeSwingStats(swings: Swing[]): SwingStats` — distribution summary (mean, median, std dev, percentiles, min, max) + histograms (binned), confirmed swings only

**Algorithm:**

The `computeZigZagPivots` function walks bars sequentially, maintaining:
- `pivots: Pivot[]` — confirmed pivots
- `lastPivot` — the most recent confirmed pivot
- `projectedPivot` — the current projected (unconfirmed) pivot

For each bar:
1. `findPivotPoint(barIndex, bars, leftDepth, rightDepth, isHigh)` — checks if the bar is a local extreme. Left side: bars `leftDepth+1` to `leftDepth+rightDepth` back must be strictly below (high pivot) or above (low pivot). Right side: bars `0` to `rightDepth-1` back must be ≤ (high) or ≥ (low).
2. `newPivotPointFound(candidate, lastPivot, devThreshold)` — checks if the candidate deviates from the last pivot by at least `devThreshold`% in the opposite direction. If same direction, extends the last pivot.
3. If `projectionPivots` is enabled, `findProjectionPivot` tracks the tentative developing pivot and `updateProjectionPivot` handles invalidation/confirmation.

### 2. Chart Indicator — `st-zigzag.indicator.ts`

**Location:** `src/app/features/shared/components/flex-chart/indicators/st-zigzag.indicator.ts`

Follows the StdDevLines pattern: `IndicatorOption` config + calculator
that transforms engine output into chart-ready line series.

**Exports:**

- `ST_ZIGZAG_INDICATOR: IndicatorOption` — registered in the indicator menu
  - `id: 'st-zigzag'`
  - `type: StIndicator.ST_ZIGZAG` (new enum member)
  - `defaultPane: 'overlay'`
  - `params: devThreshold, leftDepth, rightDepth, allowZigZagOnOneBar, projectionPivots`
- `calculateZigZag(bars, options): ZigZagChartSeries` — calls `computeZigZagPivots`, transforms pivots into line segments + a dashed segment for the projected pivot

**Chart series shape:**

- `lines: { index: number; y: number }[]` — solid line segments connecting confirmed pivots
- `projectedLine: { index: number; y: number }[]` — dashed line from last confirmed pivot to projected pivot

### 3. Registry Integration — `indicator-registry.ts`

**Location:** `src/app/features/shared/components/flex-chart/indicators/indicator-registry.ts`

- Add `ST_ZIGZAG = 'st-zigzag'` to `StIndicator` enum in `flex-chart.types.ts`
- Add `ST_ZIGZAG_INDICATOR` to `ST_INDICATOR_OPTIONS`
- Register `calculateZigZag` in `indicatorCalculators`
- Map `ST_ZIGZAG` to the `line` series type
- Add chart-template handling for the dashed projected line

### 4. Swing Analysis Store — `swing-analysis.store.ts`

**Location:** `src/app/features/savant-trader/swing-analysis/swing-analysis.store.ts`

NgRx SignalStore managing analysis page state:

- `symbol: string`
- `config: ZigZagConfig`
- `pivots: Pivot[]`
- `projection: Pivot | null`
- `swings: Swing[]`
- `stats: SwingStats | null`
- `loading: boolean`
- `savedAnalyses: SwingAnalysisDoc[]` — list of persisted analyses for the current symbol

**Methods:**

- `setSymbol(symbol)` — updates symbol, triggers bar load + recompute
- `updateConfig(partial)` — updates config, recomputes pivots/swings/stats
- `saveAnalysis()` — writes to `zig-zags/{symbol}/{paramsId}` via Firestore
- `loadSavedAnalyses()` — reads `zig-zags/{symbol}` subcollection
- `loadAnalysis(docId)` — loads a saved analysis into the store

### 5. Swing Table Component — `swing-table.component.ts`

**Location:** `src/app/features/savant-trader/swing-analysis/components/swing-table.component.ts`

Custom table matching the existing portfolio-dashboard table pattern.

- Inputs: `swings: Swing[]`, `loading`, `error`
- Sortable columns: #, direction, start date, end date, duration, magnitude %, magnitude $, start price, end price, volume
- Filters: direction (dropdown), date range, duration range, magnitude range
- Last row (current swing, `confirmed: false`) rendered with distinct styling (muted/dashed/italic)
- Pure signal-based sorting and filtering — no external library

### 6. Stats Panel Component — `stats-panel.component.ts`

**Location:** `src/app/features/savant-trader/swing-analysis/components/stats-panel.component.ts`

- Inputs: `stats: SwingStats | null`, `loading`
- Renders distribution summary (mean, median, std dev, percentiles, min, max) per direction
- Renders histograms using Syncfusion column charts (magnitude %, duration, split by direction)
- Confirmed swings only (projected swing excluded from stats)

### 7. Analysis Page Component — `swing-analysis-page.component.ts`

**Location:** `src/app/features/savant-trader/swing-analysis/swing-analysis-page.component.ts`

- Route: `/savant-trader/swing-analysis`
- Layout: param controls (symbol, devThreshold, leftDepth, rightDepth, allowZigZagOnOneBar, projectionPivots) + isolated chart (flex-chart with only ST_ZIGZAG enabled) + swing table + stats panel
- "Save Analysis" button calls `store.saveAnalysis()`
- Injects `SwingAnalysisStore`

### 8. Firestore Persistence — `swing-analysis.service.ts`

**Location:** `src/app/features/savant-trader/swing-analysis/swing-analysis.service.ts`

- `saveAnalysis(symbol, config, swings, stats)` — writes to `zig-zags/{symbol}/{paramsId}`
- `loadAnalyses(symbol)` — reads `zig-zags/{symbol}` subcollection
- `loadAnalysis(symbol, docId)` — reads single document
- `paramsId` builder: `dev{N}_L{N}_R{N}_1bar{Y|N}_proj{Y|N}` (human-readable)

### 9. Firestore Security Rules

Add rules for `zig-zags/{symbol}/{analysisId}`:
- Authenticated users can read and write their own analyses
- No unauthenticated access

## Phases

### Phase 1: Engine + Chart Indicator

Foundation — pure engine + chart overlay. No analysis page yet.

- Task: Create `st-zigzag.engine.ts` with `computeZigZagPivots`, `deriveSwings`, `computeSwingStats`, and all types
- Task: Create `st-zigzag.indicator.ts` with chart config + calculator
- Task: Register in `indicator-registry.ts` + `flex-chart.types.ts`

### Phase 2: Analysis Page

Analysis page with table, stats, histograms, and persistence.

- Task: Create `swing-analysis.store.ts` (SignalStore)
- Task: Create `swing-analysis.service.ts` (Firestore persistence)
- Task: Create `swing-table.component.ts` (sortable/filterable table)
- Task: Create `stats-panel.component.ts` (distribution summary + histograms)
- Task: Create `swing-analysis-page.component.ts` + route (page shell with isolated chart + param controls + save button)
- Task: Add Firestore security rules for `zig-zags` collection

## Cross-Area Dependencies

- Phase 2 depends on Phase 1 (analysis page imports the engine)
- No SHARED (Pine) dependency — Pine export is independent

## Risks

- **Projection logic complexity** — the `findProjectionPivot` + `updateProjectionPivot` + invalidation logic is the hardest part to port correctly. Mitigated by testing against known TradingView outputs.
- **Chart rendering for dashed lines** — the flex-chart template may need new handling for the projected line's dashed style. Check how StdDevLines handles dash arrays.
- **Firestore security rules** — new collection needs rules. Verify the existing rules file structure before adding.

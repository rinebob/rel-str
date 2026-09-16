**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST ZigZag Indicator  
**Thread Slug:** st-zigzag  
**Issue:** #325  
**Thread Parent:** #322  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Test Plan  
**Status:** Draft  
**Created:** 2026-09-15  
**Last Updated:** 2026-09-15  

---

# FE Test Plan: ST ZigZag Indicator

## E2E User Journeys

- Journey 1: User opens flex-chart, enables ST ZigZag from indicator menu → sees ZigZag lines overlaid on price chart with dashed projected line
- Journey 2: User navigates to `/savant-trader/swing-analysis`, enters a symbol, adjusts params → sees isolated chart with ZigZag, swing table, and stats panel
- Journey 3: User clicks "Save Analysis" → swing analysis persisted to Firestore, visible in saved analyses list
- Journey 4: User loads a saved analysis → chart, table, and stats populate from persisted data

## Integration Tests

- Chart indicator + registry: ST_ZIGZAG appears in indicator options, calculator produces chart-ready series
- Chart indicator + flex-chart template: solid lines for confirmed pivots, dashed line for projected pivot
- Analysis page + store: param changes trigger recompute, store state flows to table + stats
- Store + Firestore service: save/load round-trip, paramsId generation correct
- Stats panel + Syncfusion charts: histogram data renders correctly

## Unit Tests

### Pure Engine (`st-zigzag.engine.spec.ts`)

**Primary test seam — pure function calls with synthetic bar arrays.**

`computeZigZagPivots`:
- Simple uptrend → one pivot high at the peak
- Simple downtrend → one pivot low at the trough
- Alternating highs/lows → correct pivot sequence
- `devThreshold` filtering: small moves below threshold don't create pivots
- Same-direction extension: a higher high updates the last pivot, doesn't create a new one
- `allowZigZagOnOneBar = false`: high+low on same bar → only one registered
- `allowZigZagOnOneBar = true`: high+low on same bar → both registered
- Asymmetric depths: `leftDepth ≠ rightDepth` produces correct confirmation window
- Projection: projected pivot returned separately, correct direction (opposite of last confirmed)
- Projection invalidation: price exceeds projected pivot → invalidated, new projection found
- `projectionPivots = false`: no projection returned
- Edge cases: insufficient bars for confirmation, single bar, all-NaN prices, empty bars array
- Depth minimum: `leftDepth` or `rightDepth` below 2 → clamped to 2

`deriveSwings`:
- Correct swing direction alternation (up/down/up/down)
- Magnitude calculation: both % and $ correct
- Duration = bar count between pivots
- Volume accumulation across swing bars
- Projected swing as last entry with `confirmed: false`
- Empty pivots → empty swings
- Single pivot → no swings (need 2 pivots for a swing)

`computeSwingStats`:
- Mean/median/std dev/percentiles on known swing sets
- Min/max correct
- Count per direction correct
- Histogram bucket assignment and counts
- Projected swing excluded from stats
- Empty swings → empty stats

### Chart Indicator (`st-zigzag.indicator.spec.ts`)

- `ST_ZIGZAG_INDICATOR` metadata: correct id, type, pane, params, defaults
- `calculateZigZag` produces correct line series from known pivots
- Dashed projected line segment correct
- NaN handling in series data

### Swing Table (`swing-table.component.spec.ts`)

- Renders all swing columns
- Sort by each column (ascending/descending)
- Filter by direction
- Filter by date range
- Filter by duration range
- Filter by magnitude range
- Last row (projected swing) has distinct styling
- Empty state when no swings

### Stats Panel (`stats-panel.component.spec.ts`)

- Renders distribution summary values
- Renders histogram charts
- Empty state when no stats
- Loading state

### Swing Analysis Store (`swing-analysis.store.spec.ts`)

- `setSymbol` triggers recompute
- `updateConfig` triggers recompute
- `saveAnalysis` calls Firestore service with correct paramsId
- `loadSavedAnalyses` populates list
- `loadAnalysis` populates store from saved doc

### Swing Analysis Service (`swing-analysis.service.spec.ts`)

- `saveAnalysis` writes to correct Firestore path
- `loadAnalyses` reads subcollection
- `loadAnalysis` reads single doc
- `paramsId` builder produces human-readable string

## Test Seams

- **Highest seam: pure function** — `computeZigZagPivots`, `deriveSwings`, `computeSwingStats` are pure functions. Test with synthetic inputs. Fastest, most reliable.
- **Component test harness** — `swing-table.component` and `stats-panel.component` via Angular TestBed with mocked store.
- **Store test** — `swing-analysis.store` with mocked Firestore service.

## Existing Test Coverage

- `st-std-dev-lines.indicator.spec.ts` — prior art for indicator metadata + calculation tests
- `equity-positions-table.component.spec.ts` — prior art for table component tests
- Portfolio dashboard store tests — prior art for SignalStore tests

## Edge Cases

- Empty bars array → no pivots, no swings, empty stats
- Single bar → no pivots (insufficient for depth confirmation)
- All-NaN prices → no pivots
- Very small `devThreshold` (0.01%) → many pivots, short swings
- Very large `devThreshold` (50%) → few pivots, long swings
- `leftDepth` or `rightDepth` = 1 → clamped to 2
- Bars with missing volume → volume field handles undefined
- Projection with no confirmed pivots yet → no projection
- Saving analysis with same params → overwrites existing doc

**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Dual ST ZigZag Overlay  
**Thread Slug:** dual-st-zigzag-overlay  
**Issue:** #386  
**Thread Parent:** #383  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Implementation Plan  
**Status:** Draft  
**Created:** 2026-09-17  
**Last Updated:** 2026-09-17  

---

# FE Implementation Plan — Dual ZigZag Swing Analysis

## Scope

Refactor the swing analysis page to support two (N-ready) ZigZag instances
with independent configs, a nested tree swing table, a stats panel toggle,
and independent Firestore persistence. Remove bars duplication from saved
analyses.

Covers US-1, US-2, US-3, US-5, US-6, US-7 from the PRD.

## Current state

- `SwingAnalysisStore` holds a single `config: ZigZagConfig`, single
  `pivots`, `swings`, `stats`.
- `SwingAnalysisInput` stores `bars: PriceBar[]` (full price history per doc).
- Swing table is a flat single-config table.
- Stats panel shows single-config stats.
- `loadAnalysis` reads bars from the saved doc.

## Phase 1: Bars deduplication (US-1)

### Task B1: Remove bars from saved analyses

**Files:**
- `src/app/features/savant-trader/swing-analysis/swing-analysis.types.ts`
- `src/app/features/savant-trader/swing-analysis/swing-analysis.store.ts`
- `src/app/features/savant-trader/swing-analysis/swing-analysis.service.ts`

**Changes:**
- Remove `bars: PriceBar[]` from `SwingAnalysisInput` and `SwingAnalysisDoc`.
- `saveAnalysis()` no longer writes bars to Firestore.
- `loadAnalysis()` no longer reads bars from the doc. Instead, it loads bars
  from the chart service (same path as `setSymbol`).
- Existing saved docs with `bars` are handled gracefully — the field is
  ignored on read (Firestore converter strips unknown fields or the type
  mismatch is silent).
- The store's `bars` signal is populated from the chart service, not from
  the saved doc.

## Phase 2: Multi-config store + dual-mode UI + persistence (US-2, US-3, US-7)

### Task B2: Refactor SwingAnalysisStore to configs array

**File:** `src/app/features/savant-trader/swing-analysis/swing-analysis.store.ts`

**Changes:**
- Replace `config: ZigZagConfig` with `configs: ZigZagConfig[]`.
- Replace `pivots`, `projection`, `swings`, `stats` with arrays:
  `pivots: Pivot[][]`, `projections: (Pivot | null)[]`,
  `swings: Swing[][]`, `stats: (SwingStats | null)[]`.
- `paramsIds` is derived from each config via `deriveParamsId()`.
- `updateConfig(index, partial)` updates one config and recomputes only
  that config's pivots/swings/stats.
- `setSymbol()` loads bars once, then recomputes all configs.
- `saveAnalysis(index)` saves one config independently under its own
  `paramsId`.
- `loadAnalysis(docId, index)` loads one config into a slot.
- `dualMode: boolean` field — when false, `configs` has one entry; when
  true, two entries.
- `toggleDualMode()` adds/removes the second config.

**Defaults:**
- Config 0 (primary, large): `devThreshold=10, leftDepth=10, rightDepth=10,
  allowZigZagOnOneBar=true, projectionPivots=true, lineColor='#1976d2'`
- Config 1 (secondary, small): `devThreshold=3, leftDepth=3, rightDepth=3,
  allowZigZagOnOneBar=true, projectionPivots=true, lineColor='#e65100'`

### Task B3: Dual-mode toggle and config UI

**File:** `src/app/features/savant-trader/swing-analysis/swing-analysis-page.component.ts`

**Changes:**
- Add a toggle control for dual mode.
- When dual mode is on, show two stacked collapsible config sections.
- Each section controls one config's: deviation, leftDepth, rightDepth,
  lineColor, allowZigZagOnOneBar.
- Projection pivots are always on (no toggle in UI).
- `chartConfig` computed builds an array of `IndicatorConfig` entries —
  one when dual mode off, two when on. Each has a unique `id`.
- Config section 1 (primary) is labeled "Large Swings".
- Config section 2 (secondary) is labeled "Small Swings".

## Phase 3: Nested tree table + stats toggle (US-5, US-6)

### Task B4: Nested tree swing table

**File:** `src/app/features/savant-trader/swing-analysis/components/swing-table.component.ts`

**Changes:**
- When dual mode is on, the table becomes a nested tree.
- Parent rows = large swings (config 0).
- Child rows = small swings (config 1) whose start time falls within the
  parent large swing's time range.
- A small swing belongs to the large swing that was active when the small
  swing started (small.start.time >= large.start.time AND
  small.start.time <= large.end.time).
- Expand/collapse all button.
- Individual parent rows expand/collapse independently.
- The "current swing" for each config is the last row at its level.
- Sorting applies to parent rows; children stay chronological.
- When dual mode is off, the table reverts to flat single-config view.
- Implemented deviation (Task #394): small swings outside every parent's
  range (before the first parent starts, after the last ends) render as
  orphan top-level rows (`isOrphan`, `S{n}` index) so no data is dropped.
  `TreeSwingRow` extends `Swing` with `children: Swing[]` + `isOrphan`;
  expand state is tracked in a `Set` keyed by row position rather than
  embedded on the row.

**New type:**
```typescript
interface TreeSwingRow extends Swing {
  children: Swing[];        // small swings within this large swing
  isOrphan: boolean;        // unassigned small swing, rendered top-level
}
```

### Task B5: Stats panel with large/small/all toggle

**File:** `src/app/features/savant-trader/swing-analysis/components/stats-panel.component.ts`

**Changes:**
- When dual mode is on, add a toggle: large / small / all.
- "Large" shows stats for config 0 swings.
- "Small" shows stats for config 1 swings.
- "All" shows combined stats (merge both swing arrays, recompute stats).
- When dual mode is off, shows single-config stats as today.
- The toggle is a segmented control (three buttons).

## Cross-area dependencies

- Phase 2 (Task B3) is blocked by SHARED Task A2 (multi-ZigZag rendering).
  The dual-mode UI can't be visually verified until flex-chart supports
  two ZigZags.
- Phase 3 (Tasks B4, B5) is blocked by Phase 2 (Task B3). The nested tree
  and stats toggle need two sets of swings from the store.

## Risks

- **Store refactoring risk:** Changing from single config to array is a
  significant refactor. All existing tests for `SwingAnalysisStore` will
  need updating.
- **Tree table complexity:** Angular Material has no built-in tree table.
  Custom row expansion logic is required. Keep it simple — track expanded
  state in a `Set<number>` keyed by parent index.
- **Small swing assignment:** Edge case where a small swing spans two large
  swings. Assign to the large swing active at the small swing's start.

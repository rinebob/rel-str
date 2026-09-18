**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Dual ST ZigZag Overlay  
**Thread Slug:** dual-st-zigzag-overlay  
**Issue:** #386  
**Thread Parent:** #383  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Test Plan  
**Status:** Draft  
**Created:** 2026-09-17  
**Last Updated:** 2026-09-17  

---

# FE Test Plan — Dual ZigZag Swing Analysis

## E2E journeys

1. **Bars dedup:** Save an analysis → Firestore doc does not contain `bars`.
   Load the analysis → bars are loaded from chart service, config/swings/stats
   from doc. Chart renders correctly.
2. **Dual mode toggle on:** Toggle dual mode → chart shows two ZigZag
   instances with distinct colors. Table becomes nested tree. Stats panel
   shows large/small/all toggle.
3. **Dual mode toggle off:** Toggle dual mode off → chart shows one ZigZag.
   Table reverts to flat. Stats panel shows single-config stats.
4. **Independent config:** Change config 1 (large) deviation → only large
   swings recompute. Change config 2 (small) deviation → only small swings
   recompute. Chart updates only the affected instance.
5. **Nested tree:** Expand a large swing row → see contained small swings.
   Collapse → children hidden. Expand all → all parents expanded. Collapse
   all → all parents collapsed.
6. **Stats toggle:** Click "Small" → stats panel shows small swing stats.
   Click "All" → shows combined stats. Click "Large" → shows large stats.
7. **Independent save:** Save config 1 → Firestore doc under paramsId 1.
   Save config 2 → Firestore doc under paramsId 2. Load config 1 → only
   config 1 restored. Load config 2 → only config 2 restored.

## Integration boundaries

- `SwingAnalysisStore` exposes `configs: ZigZagConfig[]`, `swings: Swing[][]`,
  `stats: (SwingStats | null)[]`, `dualMode: boolean`.
- `SwingAnalysisService.saveAnalysis` no longer writes `bars`.
- `SwingAnalysisService.loadAnalysis` no longer returns `bars`.
- Swing table accepts `swings: Swing[]` (flat) or `treeSwings: TreeSwingRow[]`
  (nested) depending on dual mode.
- Stats panel accepts `stats: SwingStats | null` (single) or
  `statsSets: (SwingStats | null)[]` (dual) plus a mode toggle.

## Unit test targets

### `swing-analysis.types.ts`
- `SwingAnalysisInput` does not include `bars`.
- `SwingAnalysisDoc` does not include `bars`.
- `deriveParamsId` produces distinct IDs for different configs.

### `swing-analysis.store.ts`
- Initial state: `configs` has one entry (primary defaults), `dualMode` is
  false.
- `toggleDualMode()` adds a second config with small-swing defaults.
- `toggleDualMode()` off removes the second config.
- `updateConfig(0, { devThreshold: 15 })` updates only config 0.
- `updateConfig(1, { devThreshold: 5 })` updates only config 1.
- `saveAnalysis(0)` saves config 0 under its own paramsId.
- `saveAnalysis(1)` saves config 1 under its own paramsId.
- `loadAnalysis(docId, 0)` loads into config 0 slot.
- `loadAnalysis(docId, 1)` loads into config 1 slot.
- Recompute only affects the changed config's pivots/swings/stats.

### `swing-analysis.service.ts`
- `saveAnalysis` payload does not include `bars`.
- `loadAnalysis` returns doc without `bars`.
- Existing docs with `bars` field are handled (field ignored).

### `swing-table.component.ts`
- Flat mode: renders flat table (as today).
- Nested mode: renders parent rows with expand/collapse.
- `buildTreeSwings(largeSwings, smallSwings)` assigns small swings to
  containing large swings by start time.
- Expand/collapse all button toggles all parent rows.
- Sorting applies to parent rows only; children stay chronological.

### `stats-panel.component.ts`
- Single mode: shows single stats (as today).
- Dual mode: shows large/small/all toggle.
- "All" mode: merges swing arrays and recomputes stats.
- Toggle persists in component state (not Firestore).

### `swing-analysis-page.component.ts`
- `chartConfig` builds one IndicatorConfig when dual mode off, two when on.
- Each IndicatorConfig has a unique `id`.
- Config sections are stacked collapsible.
- Toggle control switches dual mode.

## Edge cases

- Small swing that spans two large swings → assigned to large swing active
  at small swing's start.
- No small swings within a large swing → parent row has no children, expand
  is no-op.
- No large swings (empty pivots) → all small swings render as orphan
  top-level rows (`S{n}`) — implemented deviation (Task #394): orphans are
  kept so no data is dropped; a small swing outside every parent's range
  also renders as an orphan row interleaved chronologically.
- Config with identical params → same paramsId (save overwrites).
- Loading a saved analysis when dual mode is off → loads into config 0.
- Loading a saved analysis when dual mode is on → loads into the selected
  slot.

## Test seams

- `SwingAnalysisStore` via `TestBed` with mocked `SwingAnalysisService`.
- `SwingAnalysisService` via `TestBed` with mocked Firestore.
- Swing table and stats panel via `ComponentFixture` with mock inputs.
- `buildTreeSwings` is pure — test directly with mock swing arrays.

**Topic:** Option chain percent change grid  
**Topic Slug:** `option-chain-pct-change-grid`  
**Thread:** Pivot-signal selector  
**Thread Slug:** `pivot-signal-selector`  
**Issue:** #418  
**Thread Parent:** #359  
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** TEST  
**Area:** FE  
**Status:** Complete  
**Created:** 2026-09-18  
**Last Updated:** 2026-09-18  

---

# Test Plan — Pivot-signal selector (FE)

## Unit — store

- `loadSwingData` populates `savedAnalyses` + `signals` on symbol set;
  clears on symbol change; empty arrays on error
- `dateList` merges confirmed pivots + signals inside the frame only;
  unconfirmed pivots excluded; sorted ascending; labels correct
- `dateList` dedupes same-date signal+pivot into one entry
- `targetCandidates` returns only dates after the chosen start
- `defaultTypeForStart`: swing-low/LONG → CALL; swing-high/SHORT → PUT
- `addRun`/`removeRun` manage the runs list; ids unique
- `ensureSnapshots` fetches only missing dates; no refetch on repeat

## Unit — utils

- `mergeDateList` — frame bounds filtering, label correctness, sort,
  same-date dedupe
- `swingPolyline`/`swingSegments` — geometry output for empty,
  single-pivot, and multi-swing sets

## Unit — components

- `SwingSetPickerComponent` — dropdown lists set params; expando renders
  zigzag; clicking a swing segment emits the right swing
- `SwingCompareComponent` — start dropdown lists dateList entries;
  target checkboxes restricted to post-start dates; type defaults by
  start direction and is overridable; add/remove run works
- `RunSectionComponent` — collapsed initially; first expand calls
  `ensureSnapshots` + renders grids; per-target grids render; mini-chart
  popup works inside run grids
- Page — empty state when no saved analyses; signals-only-empty still
  lists pivots

## Integration

- Full flow: set symbol → pick frame set → expand zigzag → click swing →
  date list populates → build run → expand section → grids render
- Two runs (one CALL chain, one PUT chain) render side by side with
  correct types
- Global filters apply to all runs identically

## Edge cases

- Symbol with no saved analyses → empty state, no crash
- Frame with no internal pivots/signals → empty date list, run builder
  disabled
- Run where start snapshot lacks a contract → contract absent from that
  grid (existing behavior)
- Rapid add/remove runs → no stale overlays or leaked OverlayRefs

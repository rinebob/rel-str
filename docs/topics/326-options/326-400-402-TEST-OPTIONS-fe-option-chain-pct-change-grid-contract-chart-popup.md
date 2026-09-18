**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid  
**Thread:** Contract chart popup  
**Thread Slug:** contract-chart-popup  
**Issue:** #402  
**Thread Parent:** #400  
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** Test Plan  
**Area:** FE  
**Status:** Draft  
**Created:** 2026-09-18  
**Last Updated:** 2026-09-18  

---

# Test Plan — FE: Contract chart popup

## Unit tests — series extraction

**File:** `src/app/features/savant-trader/pages/option-chain-pct-change/utils/pct-change.utils.spec.ts` (extend)

### extractContractSeries

- Returns correct `{date, price, delta}` points for a contract present
  in all snapshots (start + N targets)
- Returns points in chronological order (start first, then targets)
- Skips snapshots where the contract is absent (partial series)
- Returns empty array when contract is in no snapshots
- Resolves price using mark → bid/ask midpoint → last fallback
- Returns `delta: null` when delta is missing or unparseable
- Handles contract with only one target date (2-point series)
- Handles contract with very low price ($0.01)
- Does not mutate input snapshots

## Unit tests — store selection state

**File:** `src/app/features/savant-trader/pages/option-chain-pct-change/option-chain-pct-change.store.spec.ts` (extend)

- `previewContract` sets `selectedCell` and clears `isContractPinned`
- `previewContract` is a no-op when `isContractPinned` is true
- `pinContract` sets `selectedCell` and `isContractPinned = true`
- `clearContractSelection` resets `selectedCell` to null and
  `isContractPinned` to false
- `selectedContractSeries` returns empty array when no cell selected
- `selectedContractSeries` returns correct series when a cell is
  selected (verified against fixture snapshots)
- `selectedContractSeries` reflects contract from all target snapshots,
  not just the clicked grid's target date

## Unit tests — mini chart component

**File:** `src/app/features/savant-trader/pages/option-chain-pct-change/components/contract-mini-chart.component.spec.ts` (new)

- Renders contractID, strike, expiration, type in header
- Renders SVG with two polylines (price + delta)
- Renders price axis labels (min, max at minimum)
- Renders delta axis labels
- Renders legend
- Handles 2-point series (short line)
- Handles series with null delta points
- Renders nothing or a minimal state for empty series

## Unit tests — grid component

**File:** `src/app/features/savant-trader/pages/option-chain-pct-change/components/pct-change-grid.component.spec.ts` (extend)

- Populated cells render a chart icon; empty cells do not
- `mouseenter` on icon calls `store.previewContract` with correct args
- `mouseleave` on icon calls `store.clearContractSelection` when not
  pinned
- `click` on icon calls `store.pinContract` with correct args
- `cdkConnectedOverlay` is attached when `selectedCell` matches the
  cell's contractID and the grid's targetDate
- `cdkConnectedOverlay` is not attached for cells in other grids
- Icon does not affect cell layout (absolute positioned or sized to
  fit within cell bounds)

## Integration tests — page

**File:** `src/app/features/savant-trader/pages/option-chain-pct-change/option-chain-pct-change.component.spec.ts` (extend)

- Hovering icon on a cell in grid A shows overlay; hovering icon on a
  cell in grid B shows overlay for that cell (when nothing pinned)
- Pinning an overlay in grid A, then hovering an icon in grid B, does
  nothing
- Clicking outside the pinned overlay closes it
- After closing a pinned overlay, hover on another icon shows a new
  overlay

## Edge cases

- Contract expires before last target date (line stops early)
- Contract appears in only one snapshot (single point, or 2 points
  with start)
- Rapid mouse sweep across multiple icons (no flicker, no state leaks)
- Scroll the grid while overlay is open (overlay repositions or closes)
- Click icon, then click a different cell (not an icon) — overlay stays
  pinned (only click-outside or Esc closes)

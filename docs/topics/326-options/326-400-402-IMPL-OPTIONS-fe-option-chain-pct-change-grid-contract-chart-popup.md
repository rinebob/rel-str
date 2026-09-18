**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid  
**Thread:** Contract chart popup  
**Thread Slug:** contract-chart-popup  
**Issue:** #402  
**Thread Parent:** #400  
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** Implementation Plan  
**Area:** FE  
**Status:** Draft  
**Created:** 2026-09-18  
**Last Updated:** 2026-09-18  

---

# Implementation Plan — FE: Contract chart popup

## Scope

FE-only. Hover/click icon on populated grid cells opens a CDK overlay
with an SVG sparkline of the contract's price and delta across the
analysis window. No backend or shared-contract changes.

## Components

### 1. Series extraction utility

**File:** `src/app/features/savant-trader/pages/option-chain-pct-change/utils/pct-change.utils.ts` (extend)

Add a lightweight pure function that extracts one contract's price/delta
series from the already-loaded snapshots:

```typescript
/** A single point in a contract's time series. */
export interface ContractSeriesPoint {
  date: string;        // YYYY-MM-DD
  price: number;       // resolved mark → bid/ask mid → last
  delta: number | null;
}

/** Extract a contract's price/delta series across start + target
 *  snapshots. Skips snapshots where the contract is absent. */
export function extractContractSeries(
  contractID: string,
  startDate: string,
  startSnapshot: HistoricalOptionContract[],
  targetSnapshots: { date: string; contracts: HistoricalOptionContract[] }[],
): ContractSeriesPoint[]
```

Implementation: linear scan of each snapshot for `contractID`, reuse the
existing `resolvePrice` fallback logic, collect
`{date, price, delta}` points in chronological order. Returns empty
array when the contract is in none of the snapshots.

### 2. Store selection state

**File:** `src/app/features/savant-trader/pages/option-chain-pct-change/option-chain-pct-change.store.ts` (extend)

Add to state:

```typescript
/** Which cell is selected (contract + which target-date grid). */
selectedCell: { contractID: string; targetDate: string } | null;
/** Whether the selection is pinned (stays open until click-outside). */
isContractPinned: boolean;
```

Add computed:

```typescript
/** The contract's price/delta series across all snapshots. */
selectedContractSeries: computed(() => {
  const sel = store.selectedCell();
  if (!sel) return [];
  return extractContractSeries(
    sel.contractID, store.startDate(),
    store.startSnapshot(), store.targetSnapshots(),
  );
})
```

Add methods:

```typescript
/** Hover: set the selected cell (ignored when pinned). */
previewContract(contractID: string, targetDate: string): void
/** Click: pin the overlay open. */
pinContract(contractID: string, targetDate: string): void
/** Un-hover or click-outside: clear selection and unpin. */
clearContractSelection(): void
```

Rules:
- `previewContract` is a no-op when `isContractPinned` is true.
- `pinContract` sets both `selectedCell` and `isContractPinned = true`.
- `clearContractSelection` resets both to `null`/`false`.
- `selectedContractSeries` is a computed signal — no subscription, no
  side effects.

### 3. Mini chart component

**File:** `src/app/features/savant-trader/pages/option-chain-pct-change/components/contract-mini-chart.component.ts` (new)

Pure presentational component. Inputs:

```typescript
readonly contractID = input.required<string>();
readonly strike = input.required<number>();
readonly expiration = input.required<string>();
readonly type = input.required<OptionType>();
readonly series = input.required<ContractSeriesPoint[]>();
```

Renders:
- Header: contractID, strike, expiration, type badge
- SVG sparkline (~220×80px):
  - Two polylines: price (primary color) + delta (secondary color)
  - Price axis: left edge, 2-3 tick labels (min, mid, max)
  - Delta axis: right edge, 2-3 tick labels (-1, 0, +1 range)
  - Start/end value annotations on each series
  - Small legend (price color swatch + "Price", delta swatch + "Δ")
- Thin border, subtle shadow, white background

No store injection — takes all data via inputs.

### 4. Grid component changes

**File:** `src/app/features/savant-trader/pages/option-chain-pct-change/components/pct-change-grid.component.ts` (extend)

- Import `CdkConnectedOverlay`, `CdkOverlayOrigin` from `@angular/cdk/overlay`
- Import `ContractMiniChartComponent` and `MatIconModule`
- On each populated cell (`@if (cell)` branch), add a small chart icon
  in the top-right corner:
  - `mat-icon` with `show_chart` icon, ~8px, `opacity: 0.3` at rest,
    `opacity: 1` on cell hover
  - The icon element is the `cdkOverlayOrigin` anchor
  - `(mouseenter)` → `store.previewContract(cell.contractID, grid().targetDate)`
  - `(mouseleave)` → `store.clearContractSelection()` (only if not pinned)
  - `(click)` → `store.pinContract(cell.contractID, grid().targetDate)`
- Add a `cdkConnectedOverlay` template bound to the icon origin,
  containing `<app-contract-mini-chart>`. Shown only when
  `store.selectedCell()?.contractID === cell.contractID &&
  store.selectedCell()?.targetDate === grid().targetDate`.
- The grid injects the store (it already does for reading grid data) —
  this is event emission, not data assembly.

### 5. Page integration

**File:** `src/app/features/savant-trader/pages/option-chain-pct-change/option-chain-pct-change.component.ts` (minimal)

- Add a `(document:click)` listener (or use CDK overlay's backdrop
  click) to call `store.clearContractSelection()` when the click is
  outside a pinned overlay.
- No other page changes needed — the grid handles everything.

## Dependencies

- `@angular/cdk/overlay` (already a dependency via Angular Material)
- `MatIconModule` (already used elsewhere)
- `ContractSeriesPoint`, `extractContractSeries` from `pct-change.utils.ts`
- `HistoricalOptionContract` from `@options-contract/contracts`
- `OptionType` from `@options-contract/contracts`

## Risks

- **CDK overlay positioning in CSS grid:** the icon is inside a CSS-grid
  cell. CDK `ConnectedOverlay` positions relative to the origin element
  regardless of layout, so this should work. If the grid scrolls, the
  overlay needs `scrollStrategy` — use `repositionScrollStrategy` so it
  follows the cell.
- **Icon visibility in tiny cells:** cells are ~14px tall with 0.55rem
  font. The icon must be small enough not to break layout but visible
  enough to discover. May need to increase `min-height` slightly or
  use `position: absolute` for the icon so it doesn't affect cell flow.
- **Store size:** adding selection state is small — a few fields and
  methods. No risk of store bloat at this scale.

## Test plan

See `326-400-402-TEST-OPTIONS-fe-option-chain-pct-change-grid-contract-chart-popup.md`.

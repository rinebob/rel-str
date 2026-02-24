# RS-FE-FEAT-RSMA – `dashboard-v3` RSMA (EMA-Based RS Scoring and Sorting)

## 1. Overview and Goals

This implementation document describes how to introduce **RSMA (RS Moving Average)** scoring into the `dashboard-v3` heatmap using NgRx Signal Store and Angular signals.

- **RSMA Definition (v1):**
- RSMA is an **EMA (Exponential Moving Average)** of RS values per pair.
- Supported windows: **5, 10, 30** RS periods.
- Supported intervals: **DAILY, WEEKLY, MONTHLY**.
- RSMA is defined purely as `RSMA_L = EMA_L(RS_t)` over the last `L` RS samples; no additional factors.

**Goals:**

- Allow the user to **sort heatmap rows by RSMA** instead of single-period RS.
- Support RSMA-based sorting for **Daily, Weekly, and Monthly** heatmap views.
- Keep **cell color based on RS** (current period) in v1; RSMA only affects sort order.
- Implement scoring in a **Signal Store slice** over the existing `HeatmapSlice` / `HeatmapViewModel` model (no backend schema changes for v1).

## 2. Data Dependencies

### 2.1 Existing types (summary)

From `docs/planning/2.5_HEATMAP_VIEW.md`:

- `HeatmapQuery` – includes `interval: 'DAILY' | 'WEEKLY' | 'MONTHLY'`.
- `HeatmapSlice` – includes:
  - `rows: HeatmapRowMeta[]`.
  - `columns: HeatmapColumnMeta[]`.
  - `rsValues: (number | null)[][]` – `rsValues[rowIndex][colIndex] = RS value or null`.

The RSMA implementation will **not** change these contracts. It will consume `HeatmapSlice` and emit **derived scoring** for:

- `Daily` – RSMA over daily RS series.
- `Weekly` – RSMA over weekly RS series.
- `Monthly` – RSMA over monthly RS series.

### 2.2 RSMA configuration

Introduce a small, store-owned RSMA config type for the v3 dashboard:

```ts
export type RsmaWindow = 5 | 10 | 30;

export interface RsmaConfig {
  interval: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  window: RsmaWindow; // 5/10/30 periods
}
```

- `interval` is mirrored from `HeatmapQuery.interval`.
- `window` is selected by the user via a small UI control in `dashboard-v3`.

Future (not in v1): add a `colorMode: 'RS' | 'RSMA'` flag, and persisted user defaults.

## 3. EMA Formula and Utility

### 3.1 EMA definition

For a sequence of RS samples `x_t` and window length `L`:

- Smoothing factor: `alpha = 2 / (L + 1)`.
- Recurrence:
  - `EMA_0 = x_0` (first non-null RS in the series for that row).
  - `EMA_t = alpha * x_t + (1 - alpha) * EMA_{t-1}` for `t > 0`.

We will apply this over the **non-null RS values** for a given row, in **time order matching `HeatmapSlice.columns`**.

### 3.2 TS helper (shared utility)

Create a pure helper function in an existing shared TS utilities file (no Angular imports) that:

- Accepts a numeric array containing `number | null` RS values.
- Returns an array of the **same length** containing `number | null` EMA results.
- Handles leading `null`s by emitting `null` until the first non-null RS value.

Signature sketch:

```ts
export function computeEmaSeries(
  values: (number | null)[],
  window: RsmaWindow,
): (number | null)[] {
  // implementation per EMA definition above
}
```

This utility will be used by the dashboard-v3 Signal Store to derive RSMA series per row.

## 4. NgRx Signal Store Design

### 4.1 Store responsibilities

The `dashboard-v3`-scoped Signal Store (see `src/app/features/dashboard-v3/store/dashboard-v3.store.ts`) will be extended to:

- Hold **RSMA configuration** (`RsmaConfig`) as part of its state.
- Derive **per-row RSMA values** from the current `HeatmapSlice` using the EMA helper.
- Expose a derived signal (or part of `HeatmapViewModel`) that provides the **RSMA value to sort by for the active column**.
- Update the existing sort behavior so that clicking a sortable RS column uses RSMA for comparisons when RSMA sorting is enabled.

### 4.2 Store state additions

Extend the dashboard-v3 store state with:

```ts
interface DashboardV3State {
  // existing fields...
  heatmapQuery: HeatmapQuery | null;
  heatmapSlice: HeatmapSlice | null;
  sort: HeatmapSortSpec;

  // New RSMA-config state
  rsmaWindow: RsmaWindow; // default 10
}
```

Notes:

- `rsmaWindow` is **per dashboard** (not per column) and applies to the currently active `interval` from `heatmapQuery`.
- If `heatmapQuery` is `null` or `heatmapSlice` is not ready, RSMA-derived values resolve to `null` and sort falls back to existing behavior.

### 4.3 Derived RSMA series

Add a derived selector/signal inside the store that maps `heatmapSlice` to RSMA arrays per row:

- Input: `heatmapSlice?.rsValues` and `rsmaWindow`.
- Output: `rsmaValues[rowIndex][colIndex]` mirroring `rsValues` shape.

Pseudo-code sketch:

```ts
const rsmaValues = computed(() => {
  const slice = this.heatmapSlice();
  const window = this.rsmaWindow();
  if (!slice) return [];

  return slice.rsValues.map(rowRsValues =>
    computeEmaSeries(rowRsValues, window),
  );
});
```

This computed value stays **interval-agnostic**; the interval is already implicit in the RS data used to build `heatmapSlice`.

### 4.4 Active column RSMA for sorting

When the user clicks a heatmap header to set `HeatmapSortSpec`:

- We already know `columnIndex` and `direction`.
- For that `columnIndex`, sort rows by `rsmaValues[rowIndex][columnIndex]` descending/ascending.
- Ties can fall back to symbol or baseline.

If `rsmaValues[rowIndex][columnIndex]` is `null`:

- Treat as the **lowest rank** when sorting descending (and highest when ascending) to keep consistent ordering.

Implementation strategy:

- Extend the existing view-model or sorting helper in the store to read from the RSMA matrix when the sort target is an RS column.
- Keep the underlying `HeatmapCellVM.color` calculation unchanged (still based on `rsValues[rowIndex][columnIndex]`).

## 5. UI Integration (dashboard-v3)

### 5.1 RSMA window selector

Add a small, unobtrusive RSMA window selector in `dashboard-v3` controls:

- Control: dropdown or segmented buttons with options **5 / 10 / 30**.
- Behavior:
  - Changes update `rsmaWindow` in the store.
  - Trigger recomputation of `rsmaValues` via the computed selector.
  - Sorting reuses the new RSMA values automatically.

We will **not** persist this setting yet; it resets to the default (10) on page reload.

### 5.2 Sorting behavior

- If the user clicks a **non-RS column**, retain existing sort semantics.
- If the user clicks an **RS data column** in the heatmap header:
  - Sort rows by RSMA for the currently selected `rsmaWindow`.
  - Use RSMA values for comparisons but keep displayed `value` and `color` as RS.

Implementation detail:

- Reuse the existing `HeatmapSortSpec` (`columnIndex`, `direction`).
- In the sort implementation, branch on whether `columnIndex` points to a data column that should use RSMA.

## 6. Daily / Weekly / Monthly Behavior

The RSMA implementation must work identically for all three intervals:

- When `HeatmapQuery.interval === 'DAILY'`:
  - `heatmapSlice` is built from daily RS archives.
  - RSMA is EMA over daily RS.
- When `interval === 'WEEKLY'` or `interval === 'MONTHLY'`:
  - `heatmapSlice` is built from weekly/monthly RS data (once multi-interval RS is fully wired).
  - RSMA is EMA over weekly/monthly RS respectively.

No special-casing is needed inside the RSMA helper itself; it simply works on whatever RS series the slice provides.

## 7. Testing Strategy

### 7.1 Unit tests (Jest)

Create tests under `tests/core` or `tests/frontend` mirroring the dashboard-v3 store path:

- **EMA utility tests:**
  - Expected case: known RS sequence with hand-computed EMA for windows 5/10/30.
  - Edge case: leading `null` values should propagate until the first non-null RS.
  - Failure case: empty array / all-null array returns all-null.

- **Store selector tests:**
  - Given a mocked `heatmapSlice` with a few rows and columns, ensure `rsmaValues` matrix is correctly shaped and matches EMA expectations.
  - Sorting test: with a specific `HeatmapSortSpec` and `rsmaWindow`, verify that rows are ordered by RSMA, not by raw RS.

### 7.2 E2E tests (Cypress)

Extend the main dashboard flow tests to cover RSMA sorting:

- Load `dashboard-v3` with a known dataset (emulator).
- Select a specific RSMA window (e.g., 10).
- Click a middle RS column header to sort descending.
- Assert that the top N rows correspond to the highest RSMA values for that column.

## 8. Future Enhancements (Out of Scope for This Ticket)

- **Color by RSMA:** add a `colorMode` toggle to switch cell coloring between RS and RSMA.
- **Persisted RSMA preferences:** store RSMA window and color mode per user (local storage or Firestore-backed user settings) per `docs/planning/4_STATE_MANAGEMENT.md`.
- **Backend precomputed RSMA:** if needed for performance, extend archive/snapshot writers to store `rsMa5Ema`, `rsMa10Ema`, `rsMa30Ema` fields and have the store consume those instead of computing client-side.

# RS-FE-FEAT-HMUI-2602 – Dashboard v3 Heatmap UI: Sort, Filter, and Render Treatments

## 1. Context & Goals (FE)

> **IMPORTANT SCOPE NOTE – v3 Only**
>
> - All work described in this document applies to a new **`dashboard-v3`** implementation.
> - `dashboard-v3` will be **based on the existing dashboard v2** code (initially copied from v2), but will evolve separately.
> - The current **dashboard v2 remains operational and unchanged** while v3 is built, tested, and validated.

- **Context**
  - Dashboard v2 heatmap currently supports a limited set of pairs.
  - Backend is moving toward full production universes per baseline (SPY/QQQ/X*), with RS series persisted in Firestore.
- **Primary FE Goal**
  - Render and interact with **all prod pairs** per baseline in the **dashboard v3** heatmap with:
    - Robust **baseline selection** (SPY, QQQ, X* baselines).
    - Symmetric **Top/Middle/Bottom** RS filters.
    - **Time-range** controls for RS history consumption.
    - **Scalable rendering** (virtual scroll) that can handle 500+ pairs.

---

## 2. Baseline Selection (FE)

### 2.1 Baseline Source

- **Primary data sources (Firestore)**
  - `pair-registry` collection: canonical list of all pairs and their baselines.
  - `symbol-data` collection (or equivalent): symbol-level metadata (name, exchange, etc.).
- **App meta docs (for FE convenience)**
  - `appMeta/baselines` doc (shape TBD, e.g.):
    - `{ baselines: string[]; displayNames: Record<string, string> }`.
  - `appMeta/symbols` doc (or similar) to cache symbol metadata used frequently in the UI.
- **Shape (target, TS)**
  - Normalize to a baseline metadata type:
    - `{ id: string; label: string; type: 'index' | 'sector'; universeSizeHint?: number; }`.
- **Population strategy**
  - Provide a script (e.g. under `scripts/`) that reads `pair-registry`/`symbol-data` and (optionally) any bulk-import holdings files, then writes/updates the `appMeta/baselines` and symbol meta docs in Firestore in the shape needed by v3.

### 2.2 UI Component (Dashboard v3)

- **Baseline Chip Bar (v3)**
  - Standalone component rendered **above the v3 heatmap** in `dashboard-v3`.
  - Angular Material chip list used for selection.
- **Options**
  - `SPY` (default selected).
  - `QQQ`.
  - All X* sector ETFs found in holdings assets (e.g., `XLB`, `XLE`, `XLF`, ...).
- **Behavior**
  - Single-select chip list.
  - Selecting a chip updates a `selectedBaselineId` signal on `DashboardV3Store`.
  - The v3 store maintains `baselineUniverses: Record<string, string[]>` where values are canonical `BASE-TARG` pair IDs (e.g., `SPY-AAPL`).
  - Baseline change updates the **baseline-driven universe** via a derived `currentUniversePairs` computed signal and triggers a v3-only heatmap data load.

---

## 3. Ordering Metric (FE)

### 3.1 Canonical Sort Field

- **Metric**
  - **Always sort by latest `post` RS value** for the pair:
    - Read from `pairs/{BASE}_{SYMBOL}.post.latest`.
- **Rationale**
  - `post` RS is the canonical, end-of-day RS value used for trade decisions.
  - Sorting by a single, stable metric avoids confusion across baselines and time ranges.

---

## 4. Universe Slice Filters (Top / Middle / Bottom)

### 4.1 Requirements

- Treat **top and bottom performers symmetrically**.
- Provide visibility into **laggards** (short candidates) and **leaders** (long candidates).
- Provide filters for **middle segments**, where potential new candidates emerge.

### 4.2 Slice Definitions

- Operate over the **sorted RS list** (descending by latest post RS).
- Define slices as **percentile bands** of this sorted list.

#### 4.2.1 Core Slice Options

- **All**
  - 0–100% of pairs (no filter beyond any existing baseline/time filters).
- **Top Slices**
  - `Top 10%`
  - `Top 25%`
  - `Top 50%`
- **Bottom Slices**
  - `Bottom 10%`
  - `Bottom 25%`
  - `Bottom 50%`
- **Middle Slices**
  - `Middle 25%` (fixed as the 37.5%–62.5% percentile band of the sorted list).
  - `Middle 50%` (fixed as the 25%–75% percentile band of the sorted list).

> Implementation detail: the middle ranges above are **fixed** and must be implemented deterministically. Tests should explicitly cover the 25%/37.5%/62.5%/75% boundaries so behavior remains stable over time.

### 4.3 Slice Chip Bar (v3)

- **Component**
  - Secondary chip bar rendered **below baseline chips** and **above the v3 heatmap**.
- **State**
  - `selectedUniverseSlice` signal in the v3 store (enum-like), e.g. internal values such as:
    - `'ALL' | 'TOP_10' | 'TOP_25' | 'TOP_50' | 'BOTTOM_10' | 'BOTTOM_25' | 'BOTTOM_50' | 'MIDDLE_25' | 'MIDDLE_50'`.
  - UI labels should be **human-friendly** (e.g., `Top 10%`, `Bottom 25%`, `Middle 50%`) and must not expose the raw enum keys directly.
- **Behavior**
  - Slices are applied to the **sorted** RS list and combined with virtual scroll / density controls.
  - Changing slice resets the v3 viewport to the top of the universe.

### 4.4 Slice Computation Strategy

- Given sorted array `pairs[]` and slice option:
  - Compute indices by `Math.floor/ceil(percent * length)`.
  - Return a new array view (do not mutate original).
- Edge cases:
  - Very small universes (even though the smallest X* universe is currently believed to be >30 symbols) should still yield at least 1 pair for narrow slices if mathematically possible.

---

## 5. Time-Range Selector (RS History)

### 5.1 Options & Defaults

- **Chip Options**
  - `6M`
  - `1Y`
  - `2Y`
  - `5Y`
  - `All`
- **Default**
  - **6M** selected by default.
  - Rationale: Angular and the browser can comfortably render 6 months of data for 100 rows in the heatmap’s context.

### 5.2 Behavior

- `selectedTimeRange` signal in the v3 store, mapping to a duration window (e.g., number of trading days or date range).
- Affects:
  - Any **sparklines** or per-row historical summaries displayed in the v3 heatmap.
  - Default date range when navigating to the RS chart from a v3 heatmap row.
- Implementation can use:
  - Either **client-side filtering** of a longer local series.
  - Or **bounded server requests** (e.g., load only last N days) once backend contracts support it.

---

## 6. Rendering Strategy & Virtualization

### 6.1 Row Counts & Pagination

- **Paginator Page Sizes**
  - `25`, `50`, `100`, `All`.
- **Default Page Size**
  - `100` rows per view (targeting SPY’s ~500 instruments, so ~5 pages).
- **Conditions**
  - Only show pagination/virtualization controls if the slice result exceeds the smallest page size.

### 6.2 Virtual Scroll Choice

- Use **Angular CDK Virtual Scroll** for the heatmap row list.
- Rationale:
  - CDK virtual scroll supports large item sets by only instantiating/rendering visible rows + buffer.
  - Fits our model where each row is independent and can be rendered from a pure view model.

### 6.3 Virtualized Heatmap Component

- **Approach**
  - Extract heatmap rows into a dedicated component that:
    - Accepts a flat list of row view models.
    - Integrates `cdk-virtual-scroll-viewport` for **vertical** scrolling as the first step.
  - Map each row view model to an existing heatmap row cell structure.
  - Once vertical virtualization is in place, empirically increase the number of rows (starting from the known-safe ~20 rows back to 2019) to determine how many rows the heatmap can handle before performance becomes an issue.
  - Keep a requirement to eventually implement a strategy for **horizontal** virtual scrolling / windowing of the time axis (RS history back to 2019), so that we do not render the entire horizontal bar set at once:
    - Either via a second synced scroll container for columns, or by limiting the visible time window to the current time-range selection and lazily updating when the user pans.
- **Behavior**
  - Virtual scroll will handle **scrolling and rendering** more efficiently than manual pagination alone.
  - Paginator may still be provided as a UX affordance, but the primary scalability backing is virtual scroll.

### 6.4 Interaction with Time-Range & Filters

- Filters (Top/Middle/Bottom slices) and time range are applied **before** giving data to the virtual scroll viewport.
- Virtual scroll consumes the final filtered/sliced array; windowing is handled internally by CDK.

---

## 7. State Model (Store) – Dashboard v3 Heatmap

### 7.1 Key Signals (v3)

- `selectedBaselineId` – current baseline (SPY, QQQ, X*), stored in `DashboardV3Store`.
- `baselineUniverses` – `Record<string, string[]>` mapping baseline → array of canonical pair IDs (`BASE-TARG`).
- `currentUniversePairs()` – computed from `selectedBaselineId` + `baselineUniverses`; drives which pairs are considered for the v3 universe.
- `selectedUniverseSlice` – current percentile slice option for v3.
- `selectedTimeRange` – current time-range option for v3.
- `pageSize` – current page size (25/50/100/All) for v3 UI density controls (may be secondary when virtual scroll is primary).
- `sortedPairsByRsV3()` – derived list of **pair IDs** for the selected baseline, sorted by **latest post RS**.
- `slicedPairsV3()` – derived from `sortedPairsByRsV3()` + slice option.
- `displayPairsV3()` – final list of pair IDs fed into the v3 heatmap’s virtual scroll viewport.

> **Design Constraint:** Dashboard v3 must not depend on or mutate any v2 feature/store state. It may reuse shared read-only infrastructure (e.g., Firestore services, RS calc engine) but all v3 UI state and selectors live in `DashboardV3Store` and v3-only helpers.

### 7.2 Baseline Change Flow (v3)

1. User selects a different baseline chip in the v3 baseline bar.
2. `DashboardV3Store` updates `selectedBaselineId` and recomputes `currentUniversePairs()`.
3. A v3-only loader fetches heatmap data for `currentUniversePairs()` via canonical pair IDs and shared RS calc/Firestore services.
4. Derived selectors recompute `sortedPairsByRsV3()` and `slicedPairsV3()`.
5. The v3 heatmap component re-renders from v3 store state.

### 7.3 Filter / Time-Range Change Flow (v3)

- Universe slice change updates `selectedUniverseSlice` and recomputes `slicedPairsV3()`.
- Time-range change updates `selectedTimeRange` and affects only history-dependent views in the v3 heatmap and linked charts.

---

## 8. Implementation Tasks (FE)

Use the following subtasks under epic **RS-FE-FEAT-HMUI-2602**. Check them off as they are completed and record commits / key filenames next to each item as you go.

- [ ] **RS-FE-FEAT-HMUI-2602-T01 – Dashboard v3 scaffold & routing**
  - Copy dashboard v2 to a dashboard v3 feature folder, add `/dashboard-v3` route and sidenav entry, and ensure guards match v2.

- [ ] **RS-FE-FEAT-HMUI-2602-T02 – Baseline metadata & appMeta wiring**
  - Read baseline lists from `src/assets/holdings` and/or `pair-registry` / `symbol-data` and map into normalized baseline metadata.
  - Implement `appMeta/baselines` (and related symbol meta docs) in Firestore in the shape needed by v3.

- [ ] **RS-FE-FEAT-HMUI-2602-T03 – Baseline chip bar UI (v3)**
  - Implement `BaselineChipBarComponent` in **dashboard v3**, using Angular Material chips and normalized baseline metadata.
  - Extend `DashboardV3Store` with baseline metadata and `selectedBaselineId` / `selectedBaseline` signals.

- [ ] **RS-FE-FEAT-HMUI-2602-T04 – Baseline-driven universe selection (v3, pair-centric)**
  - Define `baselineUniverses: Record<string, string[]>` in `DashboardV3Store`, where each value is a list of canonical `BASE-TARG` pair IDs for that baseline.
  - Seed `baselineUniverses` initially from static/stubbed data (e.g., emulator `pair-registry` export), then later from FE-facing backend APIs once available.
  - Implement `currentUniversePairs()` as a computed signal and a v3-only loader that uses `currentUniversePairs()` as the canonical universe for the v3 heatmap (no dependency on v2 lists).

- [ ] **RS-FE-FEAT-HMUI-2602-T05 – Heatmap data loading for large universes (v3-only)**
  - **Prototype (FE-only, small universes)**
    - Implement a **v3-only** data loading pipeline for RS metrics over small baseline universes (e.g., stubbed 10–25 pair sets), driven by canonical pair IDs from `currentUniversePairs()`.
    - Reuse shared read-only infrastructure where appropriate (e.g., Firestore services, RS calc engine) but do not call v2 feature/store methods.
    - Normalize loaded RS series into row view models / `RanksDataWithColors` consumed exclusively by the v3 heatmap.
  - **Production (500+ pairs) – backend snapshots required**
    - Introduce backend precomputation of per-baseline, per-timeframe heatmap snapshots (e.g., `heatmapSnapshots/{baseline}_{timeframe}`) that contain a ready-to-render `RanksDataWithColors` matrix and associated header metadata.
    - The FE v3 loader should, in production, fetch a single snapshot document (or a very small number of docs) for the selected baseline + timeframe instead of issuing one read per pair.
    - FE-side `currentUniversePairs()` and slice options will operate over the snapshot matrix (and/or snapshot-provided sorted pair lists), not by directly walking the raw pair archive at runtime.

- [ ] **RS-FE-FEAT-HMUI-2602-T06 – Sorting & symmetric percentile slicing (v3)**
  - Define `UniverseSliceOption` enum and constants for all top/bottom/middle slices in the v3 store.
  - Implement canonical RS-based sorting by latest `post` RS and slice calculations for All/Top/Bottom/Middle percentiles over the v3 baseline universe.

- [ ] **RS-FE-FEAT-HMUI-2602-T07 – Universe slice chip bar UI**
  - Implement `UniverseSliceChipBarComponent` to drive universe slice selection.
  - Wire it to store state (e.g., `selectedUniverseSlice`) and derived selectors over the sorted RS list.

- [ ] **RS-FE-FEAT-HMUI-2602-T08 – Time-range selector**
  - Define `TimeRangeOption` enum and mapping to specific durations (6M, 1Y, 2Y, 5Y, All), with default 6M.
  - Implement `TimeRangeChipBarComponent` and propagate the selected time range into RS history rendering and chart navigation defaults.

- [ ] **RS-FE-FEAT-HMUI-2602-T09 – Vertical virtual scroll for heatmap rows**
  - Create/extend a heatmap rows component that uses `cdk-virtual-scroll-viewport` for vertical scrolling.
  - Integrate this component into **dashboard v3** heatmap, consuming the final filtered/sliced `displayPairs` array.

- [ ] **RS-FE-FEAT-HMUI-2602-T10 – Horizontal windowing / virtual scroll for RS history**
  - Implement horizontal windowing or virtualization of the RS history axis so we can safely handle historical data back to 2019.
  - Ensure it interacts correctly with time-range selection.

- [ ] **RS-FE-FEAT-HMUI-2602-T11 – Paginator and UX density controls**
  - Provide a page-size selector (25/50/100/All) as a UX "density" control alongside virtual scroll, defaulting to 100 rows.
  - Adjust styling/height for comfortable browsing and ensure controls remain usable on smaller screens.

- [ ] **RS-FE-FEAT-HMUI-2602-T12 – Testing & verification**
  - Jest unit tests for: sorting by latest post RS, slice calculations for all top/bottom/middle variants, and time-range option mapping.
  - Cypress E2E tests for: baseline switch + slice filters + time-range + scroll behavior; confirm top/bottom filters produce expected extremes visually.

---

## 9. Open Decisions & Notes

- **Middle bands exact percentile ranges**
  - Fixed as 37.5%–62.5% for Middle 25% and 25%–75% for Middle 50%; code and tests must reflect these exact boundaries.
- **Virtual scroll vs. paginator priority**
  - This doc assumes **virtual scroll is the primary scalability mechanism**, with paginator mainly acting as a density preference.

### 9.1 Dashboard v3 Strategy

- To avoid disrupting the existing implementation, all of the above work will be done in a new **`dashboard-v3`** feature:
  - Copy the current dashboard v2 implementation to a v3 directory/route.
  - Apply new baseline chips, universe slice filters, time-range selector, and virtualized heatmap to v3 only.
  - Once v3 is validated, we can decide whether to deprecate or migrate v2.

### 9.2 Routing & Navigation for Dashboard v3

- **New Route**
  - Introduce a dedicated route for v3 (e.g. `/dashboard-v3`), wired to the root v3 component.
  - Keep the existing v2 route (e.g. `/dashboard-v2` or current dashboard path) unchanged so existing flows continue to work.
- **Sidenav / Navigation Menu**
  - Add a new navigation entry for **Dashboard v3** alongside the existing **Dashboard v2** entry.
  - Clearly label the v3 route in the UI (e.g. "Dashboard (v3)" or similar) so it is easy to distinguish from v2 during the transition period.
  - Do **not** remove or repoint the v2 menu item until v3 is fully validated and we explicitly decide to migrate.
- **Access Control / Guards**
  - Ensure the v3 route uses the same auth guard and access rules as v2 so behavior is consistent for signed-in users.


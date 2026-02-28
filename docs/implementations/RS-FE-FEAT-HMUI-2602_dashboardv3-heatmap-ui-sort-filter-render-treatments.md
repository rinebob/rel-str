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
- For deep scroll-back beyond the viewport snapshot range (e.g., back to 2019), the FE must **not** issue per-pair Firestore reads. Instead, it will use a dedicated **baseline history function** (see BE doc `RS-BE-FEAT-HMSNAP-2602`) that returns a baseline-level matrix (`pairs[]`, `dates[]`, `values[][]`) for the requested time segment, which the v3 heatmap data service merges into its in-memory matrix.

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
3. `DashboardV3Store` triggers `HeatmapV3DataService.loadViewportSnapshot()` for the selected baseline + timeframe; the data service reads the corresponding viewport snapshot doc and exposes a bounded matrix via signals.
4. Derived selectors recompute `sortedPairsByRsV3()` and `slicedPairsV3()` over the set of visible pairs, using the data service’s viewport matrix as the underlying data source.
5. The v3 heatmap component re-renders from v3 store state and the viewport matrix exposed by the data service.

### 7.3 Filter / Time-Range Change Flow (v3)

- Universe slice change updates `selectedUniverseSlice` and recomputes `slicedPairsV3()`.
- Time-range change updates `selectedTimeRange` and affects only history-dependent views in the v3 heatmap and linked charts.

### 7.4 Heatmap Data Loading & Viewport Snapshot Integration (v3)

To keep the v3 store focused on **selection state** and avoid turning it into a bulk data cache, heatmap data loading for large universes is mediated through a dedicated data loader/service that wraps Firestore access and exposes a compact, view-ready matrix to the v3 heatmap.

#### 7.4.1 HeatmapV3DataService interface (conceptual)

```ts
interface HeatmapV3ViewportMatrix {
  pairs: string[];
  dates: string[];
  /**
   * In-memory matrix derived from the backend viewport snapshot.
   * Firestore does not allow nested arrays, so the stored document
   * uses `rows: Array<{ pair: string; values: number[] }>` instead
   * of a raw number[][]. HeatmapV3DataService maps that shape into
   * this `values: number[][]` matrix in memory, aligning rows to
   * `pairs` and columns to `dates` by index.
   */
  values: number[][];
}

interface HeatmapV3DataService {
  loadViewportSnapshot(baselineId: string, timeframe: Timeframe): void;
  viewportMatrix(): Signal<HeatmapV3ViewportMatrix | null>;
  loading(): Signal<boolean>;
  error(): Signal<string | null>;
}
```

- **Responsibilities**
  - Resolve the Firestore path for the current baseline + timeframe viewport snapshot:
    - `heatmap-snapshots/{baselineId}-{timeframe}-viewport` as defined in the BE doc and implemented in Cloud Functions.
  - Use AngularFire/Firestore SDK + RxJS (e.g., `switchMap`, `shareReplay`) to read a single snapshot doc on the happy path.
  - Expose the latest loaded viewport matrix and loading/error state via Angular **signals** for consumption by v3 components.
  - Provide a clean abstraction so that archive shards or alternative data sources can be added later without changing `DashboardV3Store` or the heatmap component’s contract.

#### 7.4.2 DashboardV3Store responsibilities and constraints

- `DashboardV3Store` owns **selection and UI state only**:
  - `selectedBaselineId`, `baselineUniverses`, `currentUniversePairs()`.
  - `selectedUniverseSlice` (Top/Middle/Bottom band selection).
  - `selectedTimeRange` (6M/1Y/2Y/5Y/All) and any pagination/virtual-scroll density preferences.
- `DashboardV3Store` **must not** own or cache raw viewport matrices (`values: number[][]`) or archive data; it only:
  - Decides *what* baseline/timeframe/slice/time-range the user wants.
  - Triggers `HeatmapV3DataService.loadViewportSnapshot()` when baseline or timeframe changes.
- Heatmap components (`HeatmapV3Component` and related view-model helpers) read from:
  - `HeatmapV3DataService.viewportMatrix()` for raw (bounded) numeric data.
  - `DashboardV3Store` for current selection/slice/time-range.
  - `RsCalcsStore.heatmapColors()` to map RS values into `RanksDataWithColors`.

This separation ensures that:
- v3 store remains small and composable.
- Bulk data loading and caching concerns are isolated in the data service.
- Heatmap rendering logic operates on a **bounded viewport matrix**, regardless of how deep the backend’s RS history extends.

### 7.5 Heatmap Color Palette Selection (Extensible)

Dashboard v3 needs a robust, extensible mechanism for choosing and switching between different heatmap color treatments (e.g., classic red/green gradient, multi-stop warm/cool, strict two-color schemes).

#### 7.5.1 Palette Registry (FE-only)

- Define a **palette registry** in a shared FE utility (e.g., `color-utils.ts` or a small `heatmap-color-registry.ts`).
- Registry concept:

  ```ts
  type HeatmapPaletteId = 'classicRedGreen' | 'warmCoolDiverging' | 'twoColorRedBlue' | 'customX';

  interface HeatmapPaletteMeta {
    id: HeatmapPaletteId;
    /** Human-readable label for UI (e.g., "Classic (Red/Green)") */
    label: string;
    /** Short description for tooltips / docs */
    description: string;
    /** Whether this palette is primarily gradient-based or binary */
    kind: 'gradient' | 'binary';
    /** Factory that returns the concrete string[] palette for the current config */
    createColors: () => string[];
  }
  ```

- Maintain a single `HEATMAP_PALETTES: HeatmapPaletteMeta[]` array that is the **source of truth** for:
  - Which palettes are available in the UI.
  - How to generate their underlying color arrays.
- Existing generators map cleanly into this registry:
  - `classicRedGreen` → `generateColorArray(NUM_HEATMAP_MIDPOINTS)`.
  - `warmCoolDiverging` → `generateWarmColdColorArray(NUM_HEATMAP_MIDPOINTS)`.
  - `twoColorRedBlue` → `generateTwoColorWarmCoolArray()` (current v3 default).

Adding a new palette becomes **data-only**: add a new `HeatmapPaletteMeta` entry; no changes to store or heatmap component contracts.

#### 7.5.2 Store Wiring for Palette Selection

- Extend `RsCalcsStore` or `DashboardV3Store` with a small piece of state for the currently selected palette:
  - Option A (global RS-level):
    - `RsCalcsStore` holds `selectedHeatmapPaletteId: HeatmapPaletteId`.
    - This applies across any view that consumes `heatmapColors`.
  - Option B (v3-only):
    - `DashboardV3Store` holds `selectedHeatmapPaletteIdV3: HeatmapPaletteId`.
    - Only dashboard v3 uses this; v2 or other views can keep their own choices.

- Expose a method to change the palette:

  ```ts
  setHeatmapPalette(id: HeatmapPaletteId): void;
  ```

  which:
  - Looks up the `HeatmapPaletteMeta` in the registry.
  - Calls `meta.createColors()`.
  - Updates `heatmapColors` in `RsCalcsStore` (and persists `selectedHeatmapPaletteId` in store state).

- Heatmap rendering code **does not change**; it continues to:
  - Read `heatmapColors()` from `RsCalcsStore`.
  - Map normalized RS metrics into palette indices.

#### 7.5.3 UI Control – Palette Selector

- Introduce a small palette selector UI in `dashboard-v3`:
  - **Form factor options**:
    - Compact **radio-group** with labeled options when there are only a few palettes.
    - **Dropdown / select** if the registry grows beyond 3–4 options.
  - Sourced directly from `HEATMAP_PALETTES`:
    - The component iterates over the registry array and renders one option per `HeatmapPaletteMeta`.
    - This ensures any palette added in code is automatically available to the user.

- Behavior:
  - On selection change, the component calls `setHeatmapPalette(id)` on the chosen store (global or v3-specific).
  - Changing palettes **does not** require a new backend fetch; it simply:
    - Recomputes `heatmapColors` locally.
    - Causes the heatmap to re-render with the new color mapping.

- UX affordances:
  - Show short labels such as:
    - "Classic (Red/Green)".
    - "Warm/Cool Gradient".
    - "Binary (Red/Blue 0.5 Split)".
  - Optionally include a small inline legend or swatch preview using the first few colors of each palette.

#### 7.5.4 Extensibility & Testing

- Extensibility:
  - To add a new palette, implement a new generator or direct color array, then register it in `HEATMAP_PALETTES` with an `id`, `label`, and `createColors` function.
  - No changes are required in:
    - `DashboardV3Store` heatmap snapshot mapping.
    - `HeatmapV3Component` row mapping logic.

- Testing Considerations:
  - Unit tests should verify that:
    - `setHeatmapPalette(id)` correctly updates `heatmapColors` and `selectedHeatmapPaletteId`.
    - Binary palettes (length === 2) still use the special threshold logic in `DashboardV3Store` mapping.
    - Gradient palettes (length > 2) use the existing index math (scaled and clamped by palette length).
  - E2E tests should at least cover:
    - Switching between two palettes and observing a visual change in cell colors for the same underlying RS values.
    - Confirming that palette switches do not trigger additional Firestore reads (only FE re-render).

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
    - ⚠️ **ARCHITECTURE UPDATE (Feb 2026)**: Viewport documents are **deprecated**. The system now uses **historical/current shard** architecture.
    - The **authoritative backend design** for per-baseline, per-timeframe **time-sharded snapshots** lives in:
      - `RS-BE-FEAT-HMSNAP-2602_backend-heatmap-snapshots-for-dashboard-v3.md`.
    - **All shards use `hist` naming** (e.g., `SPY-DAILY-hist-2026-H1`). The "current" shard is determined by date logic, not document naming.
    - **Implementation tasks for shard migration**:
      - **[DONE] FE-HMUI-T05a**: Create shard detection utilities (`getCurrentShardId()`, `getAllShardDocIds()`, etc.)
        - Implemented in `src/app/core/utils/heatmap-shard.utils.ts`
        - Supports DAILY (6-month), WEEKLY (2-year), MONTHLY (4-year) shards
      - **[DONE] FE-HMUI-T05b**: Update heatmap data service with shard loading methods
        - Added `getCurrentShardOnce()` for single shard loading
        - Added `getAllShardsOnce()` for full timeline loading
      - **[DONE] FE-HMUI-T05c**: Load all shards in parallel with caching
        - **REVISED**: Progressive loading removed due to layout shift issues
        - All shards loaded in parallel (~500ms for 15 shards)
        - Single render cycle avoids jarring UI updates
        - Implemented `HeatmapCacheService` for in-memory caching (5-min TTL)
        - First load: ~500ms, subsequent loads: instant (0ms)
      - **[DONE] FE-HMUI-T05d**: Update data models for `HeatmapSnapshotV2` interface
        - Added interfaces and conversion methods in data service
        - Store updated to consume merged shard matrices
      - **[PENDING] FE-HMUI-T05e**: Remove all viewport document references and silent fallbacks
      - **[PENDING] FE-HMUI-T05f**: Add explicit error handling for missing shards
      - **[PENDING] FE-HMUI-T05g**: Test with production data and validate performance
    - **Loading strategy** (revised Feb 2026):
      1. Check cache for instant return (0ms)
      2. Load all shards in parallel (current + historical)
      3. Merge shards chronologically
      4. Cache merged result
      5. Single render with complete timeline
      - **Rationale**: Progressive loading caused layout shift when historical data arrived. With <1s total load time and caching, single-load approach provides better UX.
    - **Shard naming examples**:
      - DAILY current: `SPY-DAILY-hist-2026-H1` (6-month shard)
      - WEEKLY current: `SPY-WEEKLY-hist-2025-2026` (2-year shard)
      - MONTHLY current: `SPY-MONTHLY-hist-2023-2026` (4-year shard)
    - FE-only loaders are allowed for development/prototyping but **must not** be used as a silent fallback in production. When snapshots/history calls fail in prod, the UI should surface an explicit error state (e.g., listing failed baselines/pairs) rather than silently reintroducing per-pair archive reads.
    - FE-side `currentUniversePairs()` and slice options operate over the matrix derived from merged shard data; this FE doc remains focused on how that matrix is interpreted, sliced, and rendered in v3, not on long-term archival storage.

- [x] **RS-FE-FEAT-HMUI-2602-T06 – Heatmap palette selector (v3)**
  - Introduce a global `HeatmapPaletteStore` backed by a registry (`HEATMAP_PALETTES`) describing all supported palettes.
  - Wire `DashboardV3Store` to consume `HeatmapPaletteStore.getSelectedPaletteColors()` when computing `heatmapRanksData` for both archive and snapshot paths.
  - Add a compact palette selector control (button-toggle group) to the v3 header row alongside the D/W/M interval buttons, and ensure palette switches only recolor existing data without triggering additional backend fetches beyond the snapshot reload.

- [ ] **RS-FE-FEAT-HMUI-2602-T07 – Sorting & symmetric percentile slicing (v3)**
  - Define `UniverseSliceOption` enum and constants for all top/bottom/middle slices in the v3 store.
  - Implement canonical RS-based sorting by latest `post` RS and slice calculations for All/Top/Bottom/Middle percentiles over the v3 baseline universe.

- [ ] **RS-FE-FEAT-HMUI-2602-T08 – Universe slice chip bar UI**
  - Implement `UniverseSliceChipBarComponent` to drive universe slice selection.
  - Wire it to store state (e.g., `selectedUniverseSlice`) and derived selectors over the sorted RS list.

- [ ] **RS-FE-FEAT-HMUI-2602-T09 – Time-range selector**
  - Define `TimeRangeOption` enum and mapping to specific durations (6M, 1Y, 2Y, 5Y, All), with default 6M.
  - Implement `TimeRangeChipBarComponent` and propagate the selected time range into RS history rendering and chart navigation defaults.

- [x] **RS-FE-FEAT-HMUI-2602-T10 – Vertical virtual scroll for heatmap rows**
  - **COMPLETED**: Implemented Angular CDK virtual scrolling for all three heatmap columns (pair names, data cells, buttons).
  - Three synchronized `cdk-virtual-scroll-viewport` instances with 28px item size.
  - Only ~21 rows rendered at a time (600px viewport ÷ 28px row height).
  - Middle viewport controls scrolling, syncs to first column and buttons via `scrolledIndexChange` event.
  - DOM size stays constant (~31,500 cells) regardless of dataset size (12 or 500+ pairs).
  - Performance: Smooth scrolling with large datasets, no browser lag.

- [ ] **RS-FE-FEAT-HMUI-2602-T11 – Horizontal windowing / virtual scroll for RS history**
  - Implement horizontal windowing or virtualization of the RS history axis so we can safely handle historical data back to 2019.
  - Ensure it interacts correctly with time-range selection.

- [ ] **RS-FE-FEAT-HMUI-2602-T12 – Paginator and UX density controls**
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

### 9.1.1 Heatmap Color Treatment – Warm/Cool vs. Red/Green

- **Background (v2)**
  - Dashboard v2 heatmap used a classic **red → yellow → green** gradient.
  - In dense grids, the green/yellow side tended to visually blend, while reds dominated attention.
  - Red/green also has accessibility drawbacks (common color vision issues).

- **v3 Color Strategy**
  - v3 switches the primary mental model from **red/green** to **warm/cool**:
    - "Warm" corresponds to **stronger / better** relative strength.
    - "Cold" corresponds to **weaker / worse** relative strength.
  - We use a **strict two-color palette** for the initial v3 rollout:
    - **Index 0** – `#d7191c` (red): *cold / down* bucket.
    - **Index 1** – `#2c7bb6` (blue): *warm / up* bucket.
  - Mapping rule (for normalized RS metrics in `[0, 1]`):
    - `value < 0.5` → index `0` → **red**.
    - `value >= 0.5` → index `1` → **blue**.
  - This yields a very clear, binary view of the universe: everything is either in the "red half" or the "blue half" of relative strength.

- **Implementation Notes**
  - Palette is generated in `color-utils.ts` via `generateTwoColorWarmCoolArray()` and stored in `RsCalcsStore.heatmapColors`.
  - `DashboardV3Component.ngOnInit()` selects the palette for v3 by calling `setHeatmapColors(generateTwoColorWarmCoolArray())`.
  - The dashboard v3 store’s snapshot mapper detects the two-color palette (`palette.length === 2`) and applies the explicit threshold logic instead of treating it as a multi-stop gradient.
  - Existing gradient generators (classic red/yellow/green and multi-stop warm/cool) are preserved for future toggles or A/B tests; v3 simply chooses the two-color palette by default.

- **Spidey Colors (Blue/Red Choice)**
  - The specific red/blue anchors are intentionally close to well-known diverging palettes (e.g., ColorBrewer `RdBu`) and happen to land near **"Spider‑Man" red/blue**.
  - This is acceptable and even helpful:
    - Highly legible against the existing light theme.
    - Strong contrast between warm and cool halves.
    - Easy to describe verbally ("Spidey red vs. Spidey blue"), which aids debugging and collaboration.
  - If future UX feedback prefers a softer treatment (e.g., teal + amber, or muted navy + rust), the only change required is to swap the two hex values in `generateTwoColorWarmCoolArray()`; the thresholding and store plumbing remain the same.

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


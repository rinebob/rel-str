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

### 2.2 UI Component

- **Baseline Chip Bar**
  - Standalone component rendered **above the heatmap** in Dashboard v2.
  - Angular Material chip list used for selection.
- **Options**
  - `SPY` (default selected).
  - `QQQ`.
  - All X* sector ETFs found in holdings assets (e.g., `XLB`, `XLE`, `XLF`, ...).
- **Behavior**
  - Single-select chip list.
  - Selecting a chip updates a `selectedBaselineV2` signal in the RS app/dashboard store.
  - Baseline change resets pagination and triggers a data load (or uses cached data) for the new universe.

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

### 4.3 Slice Chip Bar

- **Component**
  - Secondary chip bar rendered **below baseline chips** and **above the heatmap**.
- **State**
  - `selectedUniverseSliceV2` signal in store (enum-like), e.g. internal values such as:
    - `'ALL' | 'TOP_10' | 'TOP_25' | 'TOP_50' | 'BOTTOM_10' | 'BOTTOM_25' | 'BOTTOM_50' | 'MIDDLE_25' | 'MIDDLE_50'`.
  - UI labels should be **human-friendly** (e.g., `Top 10%`, `Bottom 25%`, `Middle 50%`) and must not expose the raw enum keys directly.
- **Behavior**
  - Slices are applied to the **sorted** RS list and combined with pagination / virtual scroll.
  - Changing slice resets pagination to first page.

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

- `selectedTimeRangeV2` signal in store, mapping to a duration window (e.g., number of trading days or date range).
- Affects:
  - Any **sparklines** or per-row historical summaries displayed in the heatmap.
  - Default date range when navigating to the RS chart from a heatmap row.
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

## 7. State Model (Store) – Dashboard v2 Heatmap

### 7.1 Key Signals

- `selectedBaselineV2` – current baseline (SPY, QQQ, X*)
- `selectedUniverseSliceV2` – current percentile slice option.
- `selectedTimeRangeV2` – current time-range option.
- `pageSizeV2` – current page size (25/50/100/All) for UI controls (may be secondary when virtual scroll is primary).
- `sortedPairsByRsV2()` – derived list of pairs for the selected baseline, sorted by **latest post RS**.
- `slicedPairsV2()` – derived from `sortedPairsByRsV2()` + slice option.
- `displayPairsV2()` – final list fed into the heatmap’s virtual scroll viewport.

### 7.2 Baseline Change Flow

1. User selects a different baseline chip.
2. Store updates `selectedBaselineV2`.
3. Store triggers load or returns cached pairs for that baseline.
4. Derived selectors recompute `sortedPairsByRsV2()` and `slicedPairsV2()`.
5. Virtualized heatmap re-renders.

### 7.3 Filter / Time-Range Change Flow

- Universe slice change updates `selectedUniverseSliceV2` and recomputes `slicedPairsV2()`.
- Time-range change updates `selectedTimeRangeV2` and affects only history-dependent views.

---

## 8. Implementation Tasks (FE)

### 8.1 Baseline & Assets Wiring

- [ ] Read baseline lists from `src/assets/holdings` and map them into normalized baseline metadata.
- [ ] Extend RS/dashboard store with `selectedBaselineV2` and actions.
- [ ] Implement `BaselineChipBarComponent` in **dashboard v3** (see 9.1 below).
- After completion, record in this doc:
  - Commits and key filenames that implemented this task.

### 8.2 Universe Slice Filters

- [ ] Define `UniverseSliceOption` enum and constants for all top/bottom/middle slices.
- [ ] Add `selectedUniverseSliceV2` to store and implement slice computation over sorted RS data.
- [ ] Implement `UniverseSliceChipBarComponent` to drive this state.
- [ ] Add unit tests for slice calculations, including edge cases (very small universes).
- After completion, record in this doc:
  - Commits and key filenames that implemented this task.

### 8.3 Time-Range Selector

- [ ] Define `TimeRangeOption` enum and mapping to specific durations (6M, 1Y, 2Y, 5Y, All).
- [ ] Add `selectedTimeRangeV2` to store with default `6M`.
- [ ] Implement `TimeRangeChipBarComponent`.
- [ ] Wire time-range through to RS history rendering and chart navigation defaults.
- After completion, record in this doc:
  - Commits and key filenames that implemented this task.

### 8.4 Virtualized Heatmap Rendering

- [ ] Create/extend a heatmap rows component to use `cdk-virtual-scroll-viewport` for vertical scrolling.
- [ ] Implement horizontal windowing/virtualization of the RS history axis so we can safely handle data back to 2019.
- [ ] Integrate the virtualized component into **dashboard v3** heatmap, consuming `displayPairsV2()`.
- [ ] Verify performance at:
  - ~500 rows (SPY universe) with 6 months of visible history.
  - Smaller universes (QQQ, X* ETFs).
- After completion, record in this doc:
  - Commits and key filenames that implemented this task.

### 8.5 Paginator & UX Polish

- [ ] Provide page-size selector (25/50/100/All) even when virtual scroll is in use, as a UX “density” control.
- [ ] Default to 100 rows; adjust styling and height to ensure comfortable browsing.
- [ ] Ensure controls remain usable on smaller screens.
- After completion, record in this doc:
  - Commits and key filenames that implemented this task.

### 8.6 Testing

- [ ] Jest unit tests:
  - Sorting by latest post RS.
  - Slice calculations for all top/bottom/middle variants.
  - Time-range option mapping.
- [ ] Cypress E2E:
  - Baseline switch + slice filters + time-range + scroll behavior.
  - Confirm that top/bottom filters produce expected extremes visually.
- After completion, record in this doc:
  - Commits and key filenames that implemented this task.

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

# RS-BE-FEAT-HMSNAP-2602 – Backend Heatmap Snapshots for Dashboard v3

## 1. Overview (BE)

- **Goal**
  - Provide **precomputed RS heatmap snapshots** per baseline and timeframe to support the `dashboard-v3` heatmap UI at production universe sizes (500+ pairs), with **single-doc** reads on the FE happy path.
  - This document is the **backend counterpart** to the FE epic:
    - `RS-FE-FEAT-HMUI-2602 – Dashboard v3 Heatmap UI: Sort, Filter, and Render Treatments`.
- **Scope**
  - Cloud Functions + Firestore data model for heatmap snapshots.
  - Integration with existing RS calc / backfill pipeline where possible.
  - Does **not** cover FE rendering or state management; those remain in the FE doc.

---

## 2. Contracts with Frontend

### 2.1 Collection & Document Keys

- **Collection**: `heatmapSnapshots`
- **Viewport document ID convention (v1)**:
  - `{baselineId}_{timeframe}_viewport` (e.g., `SPY_DAILY_viewport`, `QQQ_WEEKLY_viewport`, `XLF_MONTHLY_viewport`).
- **Baseline IDs**
  - Must match FE `DashboardV3Store` baseline ids (`SPY`, `QQQ`, `XPH`, and later `X*` sector ETFs).
- **Timeframe values**
  - Must match the shared `Timeframe` enum used by FE + BE:
    - `'DAILY' | 'TWO_DAY' | 'WEEKLY' | 'MONTHLY' | ...`.

### 2.2 Snapshot Document Shape (v1 – viewport only)

Each v1 snapshot document is a **compact matrix** for the **viewport window only**, with row/column order explicitly defined. These docs are optimized for **fast first paint** of the v3 heatmap and intentionally do not contain full-history data.

```ts
interface HeatmapSnapshotViewportV1 {
  baseline: string;                   // e.g. 'SPY'
  timeframe: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'TWO_DAY' | string;
  updatedAt: FirebaseFirestore.Timestamp;

  // Row order (pairs)
  pairs: string[];                    // canonical BASE-TARG ids, e.g. 'SPY-AAPL'

  // Column order (dates) – viewport window only
  dates: string[];                    // canonical Y-M-D keys in ascending order

  // RS metric values, aligned to [pairIndex][dateIndex]
  values: number[][];                 // primary metric (e.g. post/normalized RS) for the viewport range

  version: 1;
}
```

- **Viewport ranges (v1 hard caps)**
  - `DAILY`: last **60 trading days**.
  - `WEEKLY`: last **~6 calendar months** (≈ 26 buckets).
  - `MONTHLY`: last **~2 years** (≈ 24 buckets).

> Backfill and RS archives may contain history back to 2019 or further. Viewport snapshots intentionally capture only the most relevant recent window to keep document size, read cost, and FE processing time tightly bounded.

- **FE responsibility**
  - FE maps `(pairs, dates, values)` into `RanksDataWithColors` using existing `RsCalcsStore.heatmapColors()`.
  - FE handles **color mapping, sorting, slicing, and local time-range windowing** over the viewport matrix.
- **BE responsibility**
  - Ensure viewport snapshots are **complete, aligned**, and **reasonably fresh** for the supported baselines + timeframes.

### 2.3 Versioning and Evolution

- The schema above is **V1**. If we need to evolve it:
  - Add a `version: number` field (default `1`).
  - FE should treat unknown versions as **unsupported** and fall back to FE-only loader.

---

## 3. Data Sources & Dependencies

- **Pair universes**
  - Primary: `pair-registry` collection (canonical list of pairs and baselines).
  - Initial v1 can allow a **static universe mapping** in code that mirrors FE stubs while BE wiring matures.
- **RS / price inputs**
  - Existing data used by RS backfill and diagnostics functions, including:
    - `getPairRSArchive`
    - `getPairDailyBars`
    - Any internal helpers used by `processRsJobTask` / backfill pipelines.
- **Shared RS calc engine**
  - Reuse the existing **RS computation logic** used in `processRsJobTask` and related jobs, so that snapshot RS values match production RS semantics.

---

## 4. Snapshot Computation Pipeline

### 4.1 High-Level Flow (viewport)

For a given `(baseline, timeframe)` pair, v1 focuses only on the **viewport window**:

1. **Resolve baseline universe**
   - Compute the list of `BASE-TARG` pair IDs for the baseline (SPY/QQQ/X*), either from:
     - `pair-registry` (preferred), or
     - A static mapping baked into the job (for v1 bootstrapping).
2. **Fetch RS/price series**
   - For each pair, fetch the RS time series or the underlying OHLC bars needed to compute RS for the requested timeframe.
   - Use **batched or stream-based** access patterns to avoid N×1 document reads wherever possible.
3. **Run RS calc engine**
   - Apply the same RS calculations as the production backfill pipeline.
   - Produce a RS series for each pair in a common canonical date space.
4. **Normalize into viewport snapshot matrix**
   - Compute a canonical set of `dates[]` for the **viewport** window only, based on the chosen `timeframe` and ranges in 2.2:
     - `DAILY`: last 60 trading days.
     - `WEEKLY`: last ~6 months of week buckets.
     - `MONTHLY`: last ~2 years of month buckets.
   - For each pair and each canonical date:
     - Choose the RS value for that bucket (latest available in the bucket, or some aggregation).
     - Optionally include `normValues` and/or `phases` if available.
5. **Write viewport snapshot doc**
   - Write to `heatmapSnapshots/{baseline}_{timeframe}_viewport` with the schema above.
   - Overwrite in place; FE expects latest snapshot.

### 4.2 Bucketing & Canonical Dates

- **Bucket key function**
  - Reuse the same bucket logic as FE uses in `DashboardV3Store` where possible, to keep semantics aligned.
- **Canonical date selection**
  - For weekly/monthly buckets, choose a canonical representative date (e.g. Monday of the week, first trading day of month) and persist that as the `dates[]` entry.

### 4.3 Error Handling and Gaps

- If a pair is missing RS data for a bucket:
  - Write `NaN` or `null` in `values` for that cell.
  - FE will treat these as **placeholders** and render accordingly (greyed or empty cells).

---

## 5. Cloud Functions Design

### 5.1 Admin-Only Snapshot Rebuild Function

- **Function name (suggested)**
  - `rebuildHeatmapSnapshotAdmin`
- **Type**
  - HTTPS or Callable function, **admin-only**, similar to other `*Admin` jobs.
- **Input payload (JSON)**

```ts
interface RebuildHeatmapSnapshotRequest {
  baseline: string;    // e.g. 'SPY', 'QQQ', 'XLF'
  timeframe: string;   // must map to Timeframe enum (e.g. 'DAILY', 'WEEKLY')
}
```

- **Behavior**
  - Validate baseline/timeframe.
  - Run the snapshot computation pipeline (Section 4).
  - Write `heatmapSnapshots/{baseline}_{timeframe}_viewport` as the authoritative viewport snapshot doc for FE.
  - Return status + summary (`pairs.length`, `dates.length`, duration, any warnings).

### 5.2 Baseline History Function (scroll-back support)

Viewport snapshots alone are not sufficient for deep scroll-back (e.g., back to 2019) over large universes. A separate **baseline history function** provides batched access to older RS history without forcing the FE to fan out per pair.

- **Function name (suggested)**
  - `getBaselineHeatmapHistory`
- **Type**
  - HTTPS or Callable function, callable from FE.
- **Input payload (JSON)**

```ts
interface GetBaselineHeatmapHistoryRequest {
  baseline: string;         // e.g. 'SPY', 'QQQ', 'XLF'
  timeframe: string;        // 'DAILY' | 'WEEKLY' | 'MONTHLY' | ...
  from: string;             // ISO date (inclusive)
  to: string;               // ISO date (inclusive)
}
```

- **Behavior**
  - Validate inputs and resolve the baseline universe (pairs) as in the viewport pipeline.
  - Read RS archives for **all pairs in the baseline** over the requested `from`/`to` range, using batched/parallel access close to Firestore.
  - Normalize into the same matrix shape used by viewport snapshots:

    ```ts
    interface BaselineHeatmapHistoryMatrix {
      pairs: string[];
      dates: string[];
      values: number[][];   // [pairIndex][dateIndex]
    }
    ```

  - Return this matrix as JSON to the FE.
- **Sharding / internal storage**
  - The function may internally read from time-sharded backend artifacts (e.g., `*_hist_2019_2020`, `*_hist_2021_2022`) or directly from RS archives.
  - **Symbol-sharded heatmap history is explicitly out of scope** for this API; the FE must always obtain history via a small, fixed number of baseline-level calls per segment, not per symbol.

### 5.3 Scheduling (Optional)

- **Phase 1 (manual)**
  - Trigger `rebuildHeatmapSnapshotAdmin` manually via HTTP for SPY/QQQ and chosen timeframes.
- **Phase 2 (scheduled)**
  - Add a Cloud Scheduler job to call this function nightly for active baselines + timeframes.

### 5.3 Logging & Observability

- Log per-run metrics:
  - Baseline, timeframe, duration.
  - Universe size (pairs, dates).
  - Error counts.
- Consider writing a small `heatmapSnapshotsMeta/{baseline}_{timeframe}` doc with the latest `updatedAt` + last run status if additional visibility is needed.

---

## 6. Frontend Integration Notes

> Full FE implementation details remain in `RS-FE-FEAT-HMUI-2602_dashboardv3-heatmap-ui-sort-filter-render-treatments.md`. This section only describes the BE-facing contract.

- FE **v3 loader behavior** (intended steady state):
  1. Given a selected baseline + timeframe, FE attempts to read `heatmapSnapshots/{baseline}_{timeframe}`.
  2. If the doc exists and is valid:
     - FE maps `(pairs, dates, values)` to its internal `RanksDataWithColors` view model and renders the heatmap.
     - Sorting, percentile slicing, and time-range windowing are all applied **client-side**.
  3. If the doc is missing or invalid:
     - FE may fall back to a **prototype FE-only loader** (current behavior) for small universes.

- FE expectations from BE:
  - Snapshot docs exist for at least the primary baselines/timeframes in use by dashboard v3 (initially SPY/QQQ and a subset of X* ETFs).
  - Latency to read one snapshot doc is negligible compared to the prior per-pair series fetch cost.

---

## 7. Implementation Tasks (BE)

Use the following subtasks under epic **RS-BE-FEAT-HMSNAP-2602**.

- [ ] **RS-BE-FEAT-HMSNAP-2602-T01 – Define snapshot schema & FE contract**
  - Finalize `heatmapSnapshots` document shape and ID conventions with FE (baseline/timeframe naming, fields, versioning).
  - Update this doc and the FE doc (`RS-FE-FEAT-HMUI-2602`) to reflect the agreed contract.

- [ ] **RS-BE-FEAT-HMSNAP-2602-T02 – Implement snapshot computation core**
  - Implement a pure function that, given `(baseline, timeframe)`, produces a `HeatmapSnapshotDocV1` object in memory, using existing RS calc and data loaders.

- [ ] **RS-BE-FEAT-HMSNAP-2602-T03 – Implement rebuildHeatmapSnapshotAdmin function**
  - Wrap the snapshot core in an admin-only Cloud Function that validates input and writes to Firestore.

- [ ] **RS-BE-FEAT-HMSNAP-2602-T04 – Wire baselines & universes**
  - Resolve baselines and their universes from `pair-registry` (or initial static config) and ensure consistency with FE `DashboardV3Store.baselines` and `baselineUniverses`.

- [ ] **RS-BE-FEAT-HMSNAP-2602-T05 – Add monitoring & optional scheduler**
  - Add structured logs and optional scheduler jobs for nightly refresh of key baselines/timeframes.

---

## 8. Open Questions & Next Steps

- **Universe source of truth**
  - `pair-registry` is the **authoritative source** for baseline universes. Snapshot and history jobs must resolve baselines and pair lists from `pair-registry` (directly or via upstream normalization jobs), not from ad-hoc holdings files.

- **Time horizon for history**
  - The system must support RS history **back to 2019** for the baselines in scope. Viewport snapshots remain bounded (60d / ~6m / ~2y) for fast first paint; deeper history is provided via the `getBaselineHeatmapHistory` function, which may use **time-sharded backend artifacts** under the hood (e.g., 1–2 year blocks) but always returns a baseline-level matrix to the FE.

- **Fallback and error handling (prod)**
  - In production, failure to load viewport snapshots or baseline history **must not** trigger a FE-only per-pair loader. Instead, errors are surfaced explicitly to the UI (e.g., listing failed baselines/pairs) and logged on the backend. FE-only loading remains a development/prototyping tool, not a production fallback.

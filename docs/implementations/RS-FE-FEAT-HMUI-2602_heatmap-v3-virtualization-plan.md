# RS-FE-FEAT-HMUI-2602 – Heatmap v3 Virtualization & Scrolling Plan

Author: Dr. John Reed (Senior Technical Lead & System Architect) (C:\aa\projects\rel-str\docs\planning\15_PERSONA.md)
Date: 2026-02-28
Status: Draft (v3 execution plan approved for implementation)

---

## 1. Architectural Risk & Challenge (NgRx & Firebase)

- **Immediate Risk**
  - Horizontal jank at ~3,000 columns due to unbounded DOM growth and overly chatty scroll handlers. Any multi-owner scroll per axis or variable sizing in v3 will cause header/left drift, missed frames, and layout thrash. 
  - Store bloat if bulk matrices leak into selectors; memory/GC pressure will spike with baseline/timeframe switches.

- **Guardrails**
  - Single scroll owner per axis (center owns vertical via CDK viewport; center owns horizontal via inner scroll container).
  - Store holds only indices and selection signals; the data service is the sole owner of the merged shard matrix cache.

---

## 2. Technical Critique & Best Practice (Angular, TypeScript, RxJS)

- **Anti‑patterns to avoid**
  - Multiple scrollable panes per axis (e.g., left and center both vertically scrollable; header and center both owning horizontal scroll).
  - Variable column widths in v3; dynamic measurement per column; per-cell components/directives.

- **Best‑practice stance**
  - Fixed sizing for v3 via CSS variables `--cell-w` and `--row-h`.
  - rAF‑throttled horizontal scroll; compute a bounded column window with overscan.
  - Signal Store limited to: baseline, timeframe, palette, slice, timeRange, `viewportRows`, `viewportCols`.
  - Heatmap Data Service loads/merges shards and caches a single matrix per baseline/timeframe (TTL); selectors never copy matrices.

---

## 3. Execution Plan (Phased, No Code)

### Phase 1: Contracts & Sizing (v3 hard locks)
- Define CSS variables: `--cell-w`, `--row-h`. Default to fixed values.
- Measure once on init; add a `ResizeObserver` on the center container; debounce 150ms to recompute `visibleCols`.
- Exit: measured `cellW/rowH` stable; no resize-induced misalignment.

### Phase 2: Single‑Axis Scroll Ownership
- Vertical: center is the only `cdk-virtual-scroll-viewport`. Left sticky names render the same `scrolledIndexChange` range and never own scroll.
- Horizontal: center inner grid is the only horizontal scroll container. Header is passive (mirrors `scrollLeft`).
- Exit: verify only one scrollTop owner and one scrollLeft owner (devtools).

### Phase 3: Horizontal Windowing
- rAF‑throttled handler computes:
  - `visibleStart = floor(scrollLeft / cellW)`
  - `visibleCols = ceil(viewportWidth / cellW)`
  - `overscan = round(1.5 × visibleCols)` (initial tuning target)
  - `window = [max(0, start-overscan), min(total, start+visibleCols+overscan)]`
- Clamp total active cells to ≤ 80,000 (e.g., 500 rows × 120 cols) by reducing `visibleCols` if necessary.
- Exit: no visible column pop-in during max-speed pans.

### Phase 4: Sticky Header Sync
- Header renders only the current `viewportCols` slice and mirrors center’s `scrollLeft`.
- Use identical overscan/windowing for header and cells.
- Exit: zero drift during rapid pans and across zoom levels (80%, 125%, 150%).

### Phase 5: Store vs Data Service Boundaries
- Store (signals): baseline, timeframe, palette, slice, timeRange, `viewportRows`, `viewportCols`.
- Data Service: shard loading + merged matrix cache (TTL). Components slice by `[rowsWindow, colsWindow]` without copying matrices into the store.
- Exit: heap snapshot shows a single matrix per baseline/timeframe and no selector copies.

### Phase 6: Performance Telemetry & Tuning
- Instrument: render time per window, updates/sec during pan, dropped frames, active cell count.
- Start overscan at 1.5× `visibleCols`; adjust to eliminate jank without inflating DOM.
- Exit: smooth pan across ~3,000 columns with ≤ 1 dropped frame over a 2s sweep; CPU/memory stable.

### Phase 7: Scale Validation
- Test with synthetic 500 rows × 3,000 columns.
- Scenarios: rapid horizontal pan, long vertical scroll, zoom levels, resize, baseline/timeframe switches.
- Exit: no drift, no jank; store free of matrices; single-axis ownership enforced.

---

## 4. Layout & DOM Constraints
- Regions:
  - Left sticky names: passive virtual list; no horizontal scroll; matches `--row-h` of center.
  - Top header: passive; mirrors center’s `scrollLeft`; renders `viewportCols` slice only.
  - Center grid: owns vertical (CDK) and horizontal scroll.
- Cells:
  - Flat templates (no child components per cell).
  - Color applied via CSS classes (palette index → class) to minimize style recalculations.

---

## 5. Acceptance Criteria
- Single scroll owner per axis (center for both); left/header passive.
- Fixed `--cell-w`/`--row-h` in v3; rAF‑throttled horizontal windowing with 1.5× overscan.
- ≤ 80K active cells rendered; smooth pans through ~3,000 columns; negligible dropped frames.
- Signal Store holds indices and selections only; shard matrix resides solely in the data service cache.

---

## 5b. Current Implementation Status (Heatmap v4 UI rendering)

- Decisions implemented
  - Single scroll owner per axis: CDK viewport owns vertical; body viewport owns horizontal. Header is passive and mirrors `scrollLeft`.
  - Fixed sizing via CSS vars: `--heatmap-cell-width: 60px`, `--heatmap-cell-height: 30px`; sticky-left width fixed.
  - Phase‑lock: shared CSS var `--heatmap-grid-offset` updated on every scroll using `-(scrollLeft % cellWidth)` so header/body visuals stay aligned at all zoom/DPRs.
  - Precise auto‑end: initial render uses `scrollTo({ left: scrollWidth })` and applies the same phase; removes the right-edge off‑by‑one.
  - Removed gradient overlays: container `repeating-linear-gradient` separators were anti‑aliased and caused fuzzy lines/drift; eliminated.
  - Crisp per‑cell separators: header/data cells render right‑edge separators via `::after` (1px) and week‑start via `::before` (2px). Overlays do not affect layout.
  - Layout invariants: no layout‑affecting vertical borders; zero padding on cells; header/body containers use `width: max-content` with `flex: 0 0 auto` to avoid shrink.
  - Gutter alignment: `scrollbar-gutter: stable` (not `both-edges`); removed stray gaps/margins on scrollable flex containers.
  - Trailing space: `--heatmap-trailing-space` adds equal right padding to month band, header data, and body cells for breathing room beyond the last column.

- Risks addressed
  - Header/body drift during arbitrary pans and zoom/DPR combinations.
  - Fuzzy vertical separators from gradient overlays.
  - Initial landing near—but not at—the far right.

- Follow‑ups
  - Horizontal windowing for the time axis (pending once UI is stable at scale).
  - Optional: reduce non‑week‑start separator contrast for lower visual weight.

## 6. Deferrals to v4 (Out of Scope for v3)
- Right‑side actions (hover rail / context menu overlay) – to be designed and implemented after v3 stability is proven.
- Variable‑width columns for D/W/M mixed view:
  - Introduce column descriptors `{ key: string; widthPx: number }` and a prefix‑sum indexer to map `scrollLeft` → column via binary search.
  - Preserve the same single‑owner scroll model and windowing; only the indexer changes.

---

## 7. Testing Matrix
- Horizontal pan stress (max speed) at 100%, 125%, 150% zoom.
- Vertical scroll long run (top → bottom → top) verifying no drift.
- Resize tests (narrow → wide) recomputing `visibleCols` without jank.
- Baseline/timeframe switches validating matrix cache ownership and memory stability.

---

## 8. Telemetry & Observability
- Log window compute time, render time, updates/sec, active cell count, and dropped frames.
- Set alert thresholds for regressions (e.g., > 2 dropped frames over 2s continuous pan).

---

## 9. Dependencies & References
- Backend shards and schema: `RS-BE-FEAT-HMSNAP-2602_backend-heatmap-snapshots-for-dashboard-v3.md`.
- FE epic context: `RS-FE-FEAT-HMUI-2602_dashboardv3-heatmap-ui-sort-filter-render-treatments.md`.


**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid  
**Thread:** Misc fixes for option pct change grid  
**Thread Slug:** misc-fixes-pct-change  
**Issue:** #358  
**Thread Parent:** #357  
**Topic Parent:** #326  
**Task:** #412  
**Domain:** OPTIONS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-18  
**Last Updated:** 2026-09-18  

---

# Code Review — Task #412: Fix chart popup overlay crash + per-point annotations

## Verdict: PASS (after fixes)

## Scope reviewed

- `pct-change-grid.component.ts` — shared-overlay refactor: removed
  per-cell `cdkConnectedOverlay`; single overlay per grid re-anchored
  via `activeOrigin`/`overlayCell` signals; `@if(activeOrigin())` defers
  directive creation until an origin exists; handlers take the
  `CdkOverlayOrigin` template ref
- `contract-mini-chart.component.ts` — `edgeAnnot` + first/last
  computeds replaced by `pointAnnots`/`priceAnnots`/`deltaAnnots`
  (label every vertex)
- Both matching spec files (updated + new single-pane regression test)

## Root cause of the reported crash

Per-cell `cdkConnectedOverlay` created an `OverlayRef` (position
strategy + scroll listener) for every populated cell — hundreds per
grid × multiple grids → browser died on Run. First fix attempt bound
`activeOrigin()!` = null at init → null-origin position strategy →
crashed on render ("never saw a flash"). Final: `@if` guard defers the
directive until an icon supplies a real origin.

## Standards axis

- **Fixed — stale `activeOrigin`:** captured `CdkOverlayOrigin` died
  with its element on grid re-render → `effect()` on `grid()` now
  resets `activeOrigin`/`overlayCell`.
- **Fixed — pane-class literal duplicated** → `CHART_PANE_CLASS` const.
- Noted — file ~480 lines, over the 400-line smell bar (pre-existing +
  refactor growth); candidate for template/style extraction later.
- Spec conventions consistent (`fakeAsync`/`tick`, afterEach pane
  cleanup, single-pane regression test).

## Spec axis

- All prior ACs preserved: hover preview, click pin, pinned isolation
  (handlers early-return before re-anchoring), grace delay, pane-enter
  cancel, outside-click dismissal, empty cells iconless.
- `overlayOpen` requires selection matching `overlayCell` AND this
  grid's targetDate — multi-grid isolation holds.
- Annotations: every vertex labeled (price above, delta below,
  centered); null-delta points unlabeled; single-point renders
  dot + label, no polyline.
- Cosmetic note: price/delta labels can collide at coincident vertices;
  ~10+ point series may crowd the 240px width.

## Test results

- Pct-change suite: **259/259** (incl. single-pane regression test)
- `tsc --noEmit`: clean

## Findings summary

| Severity | Count | Status |
|---|---|---|
| Major | 1 | Fixed (stale-origin → effect reset) |
| Minor | 2 | 1 fixed (pane-class const), 1 noted (file size) |
| Nit | 2 | Noted (annotation crowding, lingering closed overlay) |

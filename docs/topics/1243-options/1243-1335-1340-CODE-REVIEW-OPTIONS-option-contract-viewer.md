**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** OCC Contract String Group Generator  
**Thread Slug:** occ-string-generator  
**Issue:** #1335  
**Thread Parent:** #1325  
**Topic Parent:** #1243  
**Task:** #1340  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-03  
**Last Updated:** 2026-11-03  

# Code Review — Task #1340 (FE: Chart study-range brush overlay)

**Verdict: PASS** — all acceptance criteria met; all critical/major findings fixed in-gate.

## Axes summary

| Axis | Result |
|---|---|
| Standards | 1 major (X-axis rect is the label strip, height 0 — overlays take y/height from `seriesClipRect`), 5 minors, nits — **all majors/minors fixed in-gate** |
| Spec | All 7 criteria MET; every TEST-FE edge case spec'd; 2 reservations fixed in-gate |
| Thermo-nuclear | 2 majors (untracked axis-geometry reads; empty-labels → `undefined` emission), 9 minors — **all fixable majors/minors fixed in-gate** |

## Round 2 re-review (same three axes, post-fix code)

Round-1 fixes re-verified against the installed Syncfusion SDK — all confirmed
correct, including the `seriesClipRect` geometry source and the `axisTick`
mutable-rect tracking. New findings were LOW/nits only; all actionable ones
fixed in this pass:

- Vacuous hover-suppression spec — re-pointed at a real plotted contract so
  the armed guard is genuinely asserted.
- `brushUpAt` accepted a non-left mouseup (could commit a left gesture on a
  right-button release) — gated on `button === 0`; spec'd.
- `axisSpace` didn't guard the SDK's pre-layout `Rect(undefined,…,0,0)` —
  finite/width check added.
- `dragRect` asymmetric gutter clamping could yield negative width — both
  edges now clamp into the plot interval.
- `AxisSpace` JSDoc drifted from the new geometry source — corrected.
- `axisTick` not bumped on the `chart.refresh()`/`dataBind()` relayout
  paths — bumped.
- `.brush-capture` missing `user-select: none` — added.

Deferred (consciously, flagged for the QA eyeball): px-based <2px click
suppression on very dense domains; band spans all pane rows in single-contract
mode (matches Syncfusion's X-mode zoom semantics); gutter-origin drags clamp
to edge dates; `onStudyRange` signature wider than the emitter contract.

## Per-criterion (Spec axis)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Brush-mode toggle (arm/disarm; Esc; cursor) | MET | `option-chart.component.html:368` "Select range" (`aria-pressed`, `active-toggle`); `onEscapeKey` `component.ts:543`; `.brush-capture` `cursor: crosshair` |
| 2 | Drag → own rect via px→category→date | MET | capture div + `brushDownAt/MoveTo/UpAt`; `dragRect`; math in `options-contract-chart-brush.utils.ts` |
| 3 | Snap to corpusDates; label fallback | MET | `edgeToDate`/`nearestIndexByDate`; `brushCorpus` ← `genStore.corpusDates()` |
| 4 | Emit `(studyRange)`; never mutate axis | MET | `output<StudyRange>`; zero `selectionMode`/visibleRange writes; spec asserts axis untouched |
| 5 | Active bound = faint band; clears | MET | `brushBand` ← `genStore.refine().aliveRange`; band spec asserts px geometry + clear |
| 6 | Hover dimming suppressed while armed | MET | `onChartMouseMove` early-return + capture layer eats events; spec'd |
| 7 | Specs: drags, clamp, snap, no-mutation | MET | 18 component + 13 utils specs |

## Findings resolved in-gate

| Severity | Finding | Fix |
|---|---|---|
| MAJOR (Standards) | `axisCollections[0].rect.height = 0` on a category X-axis — overlays rendered as 0px slivers below the plot | `axisSpace()` takes y/height from `chartAxisLayoutPanel.seriesClipRect` (Syncfusion's own X-zoom rect source) with `primaryYAxis.rect` fallback; stub fixture now models the real contract (rect height 0 + clip rect); band spec pins `top`/`height` |
| MAJOR (Thermo) | `axisSpace()` reads mutable chart internals — band goes stale after container resize | `axisTick` signal bumped in `onZoomComplete`, `onScrollEnd`, and the ResizeObserver rAF chain; computeds track it; spec asserts band reposition after geometry change |
| MAJOR (Thermo/Spec) | Empty `xLabels` → `{start: undefined}` emitted → `applyRange` `trim()` crash | `resolveBrushRange` returns `null` on empty labels; `brushUpAt` skips emit; spec'd |
| MINOR | Right-click while armed commits a same-day bound | `brushDownAt(px, button)` gates on `event.button === 0`; spec'd |
| MINOR | Bare click emits a degenerate one-day bound | `brushUpAt` suppresses `<2px` gestures; spec'd |
| MINOR | Band fully outside rendered domain clamps onto edge categories | `brushBand` suppresses bounds fully outside the label domain; spec'd |
| MINOR | Band edges could paint into axis gutters when scrolled | edges clamped to `[space.x, space.x+width]`; `null` when no visible portion |
| MINOR | Binary search assumed sorted `corpusDates` | `resolveBrushRange` sorts a copy per call |
| MINOR | `categoryIndexToPx` `delta<=0` → NaN px | early-returns `space.x`; spec'd |
| MINOR | Frozen hover highlight persists while armed | `clearDragOnDisarm` effect emits hover `null` on arm; spec'd |
| NIT | Unused `pxToCategoryIndex` import; `output<StudyRange \| null>` never emitted null; inline axis cast duplicated shared boundary types; missing JSDoc | import removed; narrowed to `output<StudyRange>`; uses `SfChartInstance`/`SfChartAxisRect`; JSDoc added |

## Findings noted (not blocking — product/UX calls)

- **Armed layer disables all chart navigation + touch input** (Thermo MAJOR-3, design constraint): while armed, wheel-zoom/pan/legend and touch gestures are unreachable — by design (mouse semantics are drag). To bound a range past the visible window: disarm → zoom/pan → re-arm. Touch unsupported (mouse events only). **Confirm intended UX in QA.**
- Document-level `Escape` also fires when Esc'ing a mat-datepicker/dialog while armed (disarm + close). Literal criterion met.
- If the chart block `@if`s out while armed, the button remains the only disarm path (Esc listener lives on the component).
- Band edges paint slot-center to slot-center (~half category unshaded per side). Cosmetic; matches Category-axis geometry.
- Template mouse bindings/`pxFromEvent` untestable under jsdom (`getBoundingClientRect` → 0) — manual verification surface.
- `mouseleave` mid-drag cancels — spec'd; a drag overshooting the wrap edge by a px is discarded rather than completing clamped.
- Keyboard-only users cannot set a bound (drag-only) — the drawer bound is read-only+clear. Product decision, not blocking.

## Test results

- Focused seam: **6 suites / 130 tests** green (component brush 18, utils 13, page wiring, drawer, store).
- Full suite: **288 suites / 4,999 tests** green (run before in-gate fixes; focused seam re-verified after).
- `tsc --noEmit` clean on `tsconfig.app.json` + `tsconfig.spec.json`; `ng build` green.
- Manual dev-server check pending in `/proj qa`.

## Scope note

The page files (`option-chart.component.*`) contain an unrelated uncommitted Selection Replay slice alongside this task's hunks — excluded from this review; lands under #1361.

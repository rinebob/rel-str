**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** OCC Contract String Group Generator  
**Thread Slug:** occ-string-generator  
**Issue:** #1329  
**Thread Parent:** #1325  
**Topic Parent:** #1243  
**Domain:** OPTIONS  
**Type:** TEST  
**Area:** FE  
**Status:** Draft  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# Test Plan — FE: OCC Group Generator Drawer

## E2E User Journeys (manual UAT scenarios)

- G1 — Open drawer → axes form restores the symbol's last params → Run →
  preview table populates → Send → textarea fills with `date,id` lines +
  chart plots the set (replaces prior plotted set).
- G2 — Set refine bounds → preview narrows instantly with no network call.
- G3 — Arm brush → drag on chart → band renders → preview shrinks to
  alive-across-range contracts → open date fills when toggle on.
- G4 — Switch symbol → drawer state swaps to that symbol's saved config.
- G5 — Truncated response → warning visible with count.
- G6 — Endpoint error → error state + retry; empty result → explicit empty
  state (not confused with loading).

## Integration Tests

- Store + service: `run()` → stubbed service → `records`/`filtered`/
  `status`/`truncated`/`corpusDates` all correct; error → error state.
- Store + settings: `run`/`clear` persists; reopening loads
  `rs-optgen:{SYMBOL}`; two symbols keep separate blobs.
- Page + store: send writes textarea + invokes the `loadPlotted` path;
  replace semantics (absent contracts removed, kept not refetched).
- Chart + page: `(studyRange)` → `store.applyRange` → refine bound +
  open-date fill per toggle.

## Unit Tests

- `toAvailabilityQuery`: explicit expiries override range; type mapping;
  optional params omitted.
- `refineContracts`: each axis incl. boundary-inclusivity;
  alive-across-range (`firstObserved ≤ start`, `lastObserved ≥ end`);
  combined filters compose (AND).
- `toPairLines`: `date,id` vs bare `id`; deterministic sort; empty set.
- Settings blob: round-trip; unknown `version` → defaults; openDate never
  persisted; corrupt JSON → defaults.
- Brush math: px → category → date mapping incl. clamping at axis edges;
  corpusDates snapping (nearest member); fallback to axis labels.

## Test Seams

- **Highest seam:** component-level spec of the drawer + page with the
  service stubbed — covers query → preview → emit → plotted-set in one
  place.
- **Lower seams:** pure utils and settings blob (fast, no TestBed); store
  with mocked service.

## Existing Test Coverage

- `plotted-contracts-feature.spec.ts` covers `loadPlotted` replace semantics
  — the send path reuses it; add a wiring spec that emitted lines reach it,
  not re-tests of the store internals.
- `sandbox-settings` spec establishes the wrapped-localStorage fixture
  pattern to mirror.
- Chart spec has mouse-event helpers (connected hover) to reuse for brush
  synthetic drags.

## Edge Cases

- Zero contracts returned; refine narrows to zero (distinct empty messages).
- `corpusDates` absent (drawer never ran) → brush falls back to axis labels.
- Drag outside the plot area → clamp to axis domain, not an error range.
- Re-arm brush mid-drag → single active gesture; Esc cancels without emit.
- Send with empty filtered set → disabled Send + hint, not an empty
  `loadPlotted` call.
- Symbol switch mid-fetch → stale response discarded (in-flight guard,
  `loadPlotted` precedent).
- Brush armed while chart is empty (no plotted set) → allowed: the
  underlying overlay supplies the domain.

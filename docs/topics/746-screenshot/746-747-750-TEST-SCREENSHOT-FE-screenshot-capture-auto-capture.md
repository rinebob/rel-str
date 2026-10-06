**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Auto-Capture  
**Thread Slug:** auto-capture  
**Issue:** #750  
**Thread Parent:** #747  
**Topic Parent:** #746  
**Domain:** SCREENSHOT  
**Type:** TEST  
**Area:** FE  
**Status:** Draft  
**Created:** 2026-10-03  
**Last Updated:** 2026-10-03  

# Test Plan — FE: /dev/screenshot Page

## E2E User Journeys

- Journey 1: user navigates to `dev/screenshot`, enters a symbol, submits → returned SVG displays inline, PNG + storage paths shown.
- Journey 2: submitted capture appears inside each card-layout variant at different sizes; quick-zoom re-renders to the last ~15 bars and toggles back.

## Integration Tests

- Dev page + mocked `screenshot.service`: form submit wires spec fields → callable args; response renders into result region and layout variants.
- Service spec: `httpsCallable` invoked with correct function name and spec payload; error mapping surfaced.

## Unit Tests

- **Zoom (component-driven):** second callable call with `intervals:[i]` + `visibleBars:15` + `renderOnly:true`; per-artifact toggle restores the primary render; stale responses from superseded captures are dropped.
- **Spec form:** default values (D+W on, event 'manual'), validation (empty symbol blocked).
- **Result rendering:** SVG injected, paths list rendered, error state displays typed message.

## Test Seams

- Highest seam: TestBed component spec with `screenshot.service` mocked — covers form → call → render pipeline.
- Lower seams: zoom viewBox math as pure function; path/formatters.

## Existing Test Coverage

- Component spec conventions under `src/app/features/`; Firebase token stubs per AGENTS.md (`{ provide: Functions, useValue: {} }` or mock the service — preferred here since the service is ours).

## Edge Cases

- Callable error states: invalid-argument, failed-precondition, internal — each renders a distinguishable message.
- Empty/missing SVG in response → error display, no broken markup injection.
- visibleBars < requested zoom window → zoom disabled or clamped.
- Slow callable → pending state; double-submit prevented while in flight.

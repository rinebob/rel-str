**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Intraday Bar Strength (IBS)  
**Thread Slug:** intraday-bar-strength  
**Issue:** #1670  
**Thread Parent:** #1665  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-11-21  
**Last Updated:** 2026-11-21  

# Test Plan — FE: IBS gate in trend-rider dots + suppressed-marker toggle

## Scope

`detectZoneUptickDots` gate + `UptickDotResult` partition, the `showSuppressedSignals`/`ibsThreshold` indicator params, suppressed-series rendering through `extras-signals`/`base-indicators`, and the sandbox toggle.

## E2E User Journeys

- Sandbox: load a liquid symbol (e.g., SPY) on daily interval → enable ST Trend Rider V1 (or V2) → toggle `showSuppressedSignals` on → hollow/dimmed markers appear at suppressed bars alongside solid emitted dots; toggle off → chart identical to prod. Same journey on the V2 indicator.
- Dev-server journey only — no automation required for the visual pass (consistent with prior indicator Threads; UAT doc at ship time covers the eyeball).

## Integration Tests

- `detectZoneUptickDots` with synthetic zone + bar series → `UptickDotResult.emitted` contains only passing signals; `.suppressed` contains the IBS-rejected candidates at the same positions the unfiltered algorithm would have produced.
- `extras-signals` → `base-indicators` path: extras bundle carrying suppressed sets produces the additional scatter series only when `showSuppressedSignals` is on.
- Existing callers (`signal-detail`, `quick-charts`, gallery/position-card charts, sandbox) compile and receive `emitted` — a spec or typecheck pinning that non-suppressed paths render emitted dots unchanged.

## Unit Tests

- **Gate partition:** candidate with IBS below/above threshold lands in `suppressed` vs `emitted`; boundary `0.5` inclusive → `emitted`.
- **Default off:** with `showSuppressedSignals` falsy, downstream series list gains no suppressed series; emitted series content identical to pre-change output (regression-identical).
- **Threshold param:** `ibsThreshold: 0.7` re-partitions accordingly.
- **Visuals:** suppressed series carries the `ST_SUPPRESSED_DOT` style constants, not the solid uptick colors.

## Test Seams

- Highest: `detectZoneUptickDots` pure call with synthetic inputs (same seam its existing specs use).
- Mid: extras bundle → indicator-config list, asserting series presence/absence — no TestBed component render needed for the gate logic; rendering-style assertions stay on the data level.
- `now` injected — no `jest.useFakeTimers`, no `fakeAsync`/`tick` for async paths (AGENTS.md constraints).

## Test data / fixtures

- Synthetic `ltfZoneData`/`htfZoneData`/`ltfBars` fixtures from existing `st-trend-rider-dots` specs, extended with bars whose hand-computed IBS sits at `0.2 / 0.5 / 0.8` on the signal bars.

## Existing Test Coverage

- `st-trend-rider-dots.indicator.spec.ts` (or nearest spec file) — detection fixtures + assertion style; existing cases stay green (emitted must be unchanged when no suppression applies).
- `flex-chart-sandbox.component.spec.ts` — pattern for sandbox-control specs (decorator-based mock components only — NOT signal `input()`/`output()`, per AGENTS.md).

## Edge Cases

- Signal bar zero-range (IBS 0.5) → emitted at default threshold (inclusive).
- All candidates suppressed → emitted series empty but present (no crash in the scatter path).
- Developing current-day bar on an intraday-loaded chart before 12:00 ET → `undefined` → emitted unfiltered (availability parity with BE).
- `showSuppressedSignals` on with empty suppressed set → no extra series.

## Verify relay

- `npx jest` scoped to `st-trend-rider-dots` + `chart-indicators` + `flex-chart-sandbox` specs.
- `npx tsc --noEmit` (app) — `UptickDotResult` compat across all callers.
- Sandbox manual pass per the E2E journey.

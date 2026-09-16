**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Trend Rider Zero Cross  
**Thread Slug:** trend-rider-zero-cross  
**Blueprint:** #318  
**Task:** #320  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-14  
**Last Updated:** 2026-09-14  

---

## Verdict: PASS

---

## Review Scope

Task #320 — FE: Trend Rider Zero Cross — Remove client-side detection, use BE dots

Files reviewed:
- `src/app/features/shared/components/flex-chart/indicators/st-trend-rider-dots.indicator.ts` — removed `detectZoneZeroCrossDots()` and zero-cross indicator options
- `src/app/features/shared/components/flex-chart/indicators/st-trend-rider-dots.indicator.spec.ts` — DELETED
- `src/app/features/shared/components/flex-chart/indicators/indicator-registry.ts` — removed zero-cross exports, options, series type
- `src/app/features/shared/components/flex-chart/flex-chart.types.ts` — removed `StIndicator.ZONE_ZERO_CROSS_DOTS`
- `src/app/features/savant-trader/utils/chart-indicators/signal-marker-converters.ts` — removed `computeZeroCrossDots()`
- `src/app/features/savant-trader/utils/chart-indicators/base-indicators.ts` — removed `ZeroCrossDotColors`, zero-cross `ChartExtras` fields
- `src/app/features/savant-trader/utils/chart-indicators/extras-signals.ts` — removed zero-cross signals and `dailyBars`/`weeklyBars` params
- `src/app/features/savant-trader/utils/chart-indicators.ts` — removed zero-cross barrel exports
- `src/app/features/savant-trader/components/signal-detail/signal-detail.component.ts` — removed zero-cross wiring
- `src/app/features/savant-trader/components/quick-charts/quick-charts.component.ts` — removed zero-cross wiring

---

## Standards Axis

### Findings

**Minor — stale JSDoc comment (FIXED)**  
`buildDotPlacementContext` JSDoc referenced "zero-cross dot detection" which no longer exists. Fixed to reference only uptick dot detection.

**All other checks passed:**
- Zero-cross references removed consistently across all files
- No dangling imports or dead code
- `createExtrasSignals` signature change propagated to all callers
- Barrel exports consistent with `base-indicators.ts`
- `ChartExtras` interface clean (no orphaned fields)
- `addChartExtras` works correctly without zero-cross branches
- Indicator menu IDs correct (no stale zero-cross IDs)
- Test file deletion appropriate (entire file tested removed function)

---

## Spec Axis

### PRD US3 Acceptance Criteria

| Criterion | Status |
|---|---|
| Remove client-side `detectZoneZeroCrossDots` | MET |
| Remove client-side `computeZeroCrossDots` | MET |
| Remove `zeroCrossDotsV1`/`zeroCrossDotsV2` from chart extras | MET |
| Remove `ST_ZONE_V1/V2_ZERO_CROSS_DOTS_INDICATOR` options | MET |
| Zero-cross dots come from same `dotMarkers.zoneV1`/`zoneV2` arrays | MET |
| Zero-cross dots render in main price pane alongside confirmation dots | MET |
| No separate zero-cross toggle in indicator menu | MET |

All US3 FE acceptance criteria MET.

---

## Thermo-Nuclear Axis

### Findings

**Major — `detectZoneUptickDots` is dead code (DEFERRED)**  
`detectZoneUptickDots` is exported but not called anywhere in `src/` — all dot rendering now comes from `convertZoneDotMarkers()` using BE-provided data. This is pre-existing (confirmation dots also come from BE). Removing it is a separate cleanup task, not in scope for #320.

**Minor — file header describes old data flow (NON-ISSUE)**  
The file header JSDoc describes the function's algorithm, not current usage. The function still implements that algorithm. Leaving as-is.

**Nit — zero-cross and confirmation dots share colors (INTENTIONAL)**  
All dots in `zoneV1`/`zoneV2` now use the same `UptickDotColors` per version/direction. This is consistent with the product decision: "you don't need to differentiate they're all just trend rider signals."

### Behavioral parity confirmed

- `convertZoneDotMarkers()` reads `dotMarkers.zoneV1`/`zoneV2` — unchanged
- BE (Task #319) merges zero-cross DotMarkers into those arrays
- ATR(14) * 2.5 placement is identical between BE and old FE
- Zero-cross dots will render alongside confirmation dots

---

## Fixes Applied During Review

1. **Stale JSDoc comment** — Updated `buildDotPlacementContext` comment to remove "zero-cross" reference.

---

## Verification Results

- TypeScript: no errors in changed files (1 pre-existing error in `indicator-config-dialog.component.ts`)
- Flex-chart tests: 26/26 pass
- No remaining zero-cross references in `src/`

---

## Follow-Ups (Non-Blocking)

1. **Remove `detectZoneUptickDots` dead code** — The function and its helpers (`computeATR`, `buildDotPlacementContext`) are unused. Separate cleanup task.
2. **`StIndicator.ZONE_UPTICK_DOTS` has no calculator** — Pre-existing. Only renders with pre-computed data via `addChartExtras`.

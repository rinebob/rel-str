**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Trend Rider Zero Cross  
**Thread Slug:** trend-rider-zero-cross  
**Issue:** #317  
**Thread Parent:** #304  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Implementation Plan  
**Status:** Complete  
**Created:** 2026-09-14  
**Last Updated:** 2026-09-14  

---

## Overview

Add zero-cross detection to the existing BE Trend Rider signal pipeline. Zero-cross signals and dots are merged into the existing arrays — no separate pipeline, no new fields.

## Areas

- **BE** — Add zero-cross detection to signal-detection.ts, wire into indicator-computation.ts
- **FE** — Remove client-side zero-cross detection, use BE-provided dots

## BE Implementation Plan

### Module: Zero-Cross Detection

Location: `functions/src/st-cloud-function/strategies/signal-detection.ts`

Add `detectAllZoneZeroCrossSignals()` alongside `detectAllStTrendRiderSignals()`:

```ts
export function detectAllZoneZeroCrossSignals(
  ltfZone: number[],
  ltfBars: OHLCV[],
  version: 'V1' | 'V2',
  timeframe: 'D' | 'W',
): ZoneSignal[] {
  if (ltfZone.length < 2) return [];
  const signals: ZoneSignal[] = [];
  for (let i = 1; i < ltfZone.length; i++) {
    const prevZone = ltfZone[i - 1];
    const currZone = ltfZone[i];
    // NaN breaks the sequence (null zones from BE become NaN)
    if (Number.isNaN(prevZone) || Number.isNaN(currZone)) continue;
    // Zero is neutral
    if (prevZone < 0 && currZone > 0) {
      signals.push({
        action: StSignalDirection.LONG,
        signalType: `${timeframe}_ST_TREND_RIDER_${version}_LONG`,
        reason: `ST Trend Rider: ${version} zone crossed zero ${prevZone}→${currZone}`,
        index: i,
        indicators: { [`zone${version}`]: currZone, [`zone${version}Prev`]: prevZone },
      });
    } else if (prevZone > 0 && currZone < 0) {
      signals.push({
        action: StSignalDirection.SHORT,
        signalType: `${timeframe}_ST_TREND_RIDER_${version}_SHORT`,
        reason: `ST Trend Rider: ${version} zone crossed zero ${prevZone}→${currZone}`,
        index: i,
        indicators: { [`zone${version}`]: currZone, [`zone${version}Prev`]: prevZone },
      });
    }
  }
  return signals;
}
```

### Module: Pipeline Wiring

Location: `functions/src/st-cloud-function/indicator-computation.ts`

In `generateZoneSignals()`, after the existing `detectAllStTrendRiderSignals()` call, add zero-cross detection and merge:

```ts
const confirmationSignals = detectAllStTrendRiderSignals(zoneNumbers, windowV2Numbers, ohlcv, version, timeframe);
const zeroCrossSignals = detectAllZoneZeroCrossSignals(zoneNumbers, ohlcv, version, timeframe);
const allSignals = [...confirmationSignals, ...zeroCrossSignals];
```

Then `generateZoneDotMarkers()` already works on any `IndicatorSignalMarker[]` — no changes needed. The merged signals flow into `SignalIntervalData.zoneV1`/`zoneV2` and `dotMarkers.zoneV1`/`zoneV2`.

## FE Implementation Plan

### Remove client-side zero-cross detection

Files to update:
- `src/app/features/shared/components/flex-chart/indicators/st-trend-rider-dots.indicator.ts` — remove `detectZoneZeroCrossDots`
- `src/app/features/savant-trader/utils/chart-indicators/signal-marker-converters.ts` — remove `computeZeroCrossDots`
- `src/app/features/savant-trader/utils/chart-indicators/base-indicators.ts` — remove `zeroCrossDotsV1`/`V2` from chart extras
- `src/app/features/savant-trader/utils/chart-indicators/extras-signals.ts` — remove zero-cross signal wiring
- `src/app/features/savant-trader/components/signal-detail/signal-detail.component.ts` — remove zero-cross computation/wiring
- `src/app/features/savant-trader/components/quick-charts/quick-charts.component.ts` — remove zero-cross wiring
- `src/app/features/savant-trader/utils/chart-indicators.ts` — remove zero-cross indicator option exports
- `src/app/features/shared/components/flex-chart/indicators/indicator-registry.ts` — remove zero-cross indicator registrations
- `src/app/features/shared/components/flex-chart/flex-chart.types.ts` — remove `StIndicator.ZONE_ZERO_CROSS_DOTS`

Zero-cross dots now come from the same `dotMarkers.zoneV1`/`zoneV2` arrays as confirmation dots.

## Cross-Area Boundaries

- FE changes depend on BE changes being deployed (BE must provide zero-cross dots before FE can stop computing them)
- BE changes can be deployed first (FE will just ignore the extra dots until it's updated)

## Risks

- **Signal volume**: Zero-cross fires on every sign flip. No state machine gate. In practice, zones are smoothed so oscillation is rare.
- **FE migration**: Removing Task #310's client-side detection is a rollback. Need to ensure BE-provided dots render correctly.
- **Duplicate signals**: If zero-cross and confirmation fire on the same bar, both appear. Intentional — different events.

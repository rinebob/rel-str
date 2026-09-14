**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Trend Rider Zero Cross  
**Thread Slug:** trend-rider-zero-cross  
**Issue:** #317  
**Thread Parent:** #304  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Test Plan  
**Status:** Complete  
**Created:** 2026-09-14  
**Last Updated:** 2026-09-14  

---

## BE Test Plan

### Unit Tests

Location: `functions/src/st-cloud-function/strategies/signal-detection.spec.ts` (or equivalent)

- `detectAllZoneZeroCrossSignals`:
  - Returns empty for arrays < 2 elements
  - Detects bullish cross: `[-1, +1]` → long signal at index 1
  - Detects bearish cross: `[+1, -1]` → short signal at index 1
  - Detects jumps over zero: `[-3, +2]` → long, `[+3, -2]` → short
  - Zero is neutral: `[-1, 0]` → no signal, `[0, +1]` → no signal
  - NaN breaks sequence: `[NaN, +1]` after `[-1]` → no signal
  - Multiple crosses: `[-1, +1, -1, +1]` → 3 signals (long, short, long)
  - Same signalType as confirmation: `D_ST_TREND_RIDER_V1_LONG` etc.

### Integration Tests

- `generateZoneSignals` returns merged array with both confirmation and zero-cross signals
- `generateZoneDotMarkers` produces dots for zero-cross signals with correct ATR offset
- `generateSymbolSignals` includes zero-cross signals in `SignalIntervalData.zoneV1`/`zoneV2`
- Zero-cross dots appear in `dotMarkers.zoneV1`/`zoneV2`

### Verification Scripts

- Script that calls the BE computation on a real symbol and verifies zero-cross signals appear in the response
- Verify zero-cross dots have correct y-placement (low - ATR*2.5 for long, high + ATR*2.5 for short)

## FE Test Plan

### Unit Tests

- Remove `detectZoneZeroCrossDots` tests from `st-trend-rider-dots.indicator.spec.ts`
- Verify zero-cross dots come from `intervalData.dotMarkers.zoneV1`/`zoneV2` (existing `computeZoneDots` path)

### E2E / UI Verification

- Dev server: zero-cross dots render on signal-detail and quick-charts
- Zero-cross dots appear at the same bars as before (BE-provided, not FE-computed)
- No separate zero-cross toggle in indicator menu (removed)
- Zero-cross dots render alongside confirmation dots

## Edge Cases

- Empty zone array → no signals
- All-zero zone array → no signals
- Zone array with nulls → sequence breaks, no fabricated crosses
- Zone oscillating around zero → multiple signals (expected behavior)
- Same-bar zero-cross and confirmation → both signals appear (intentional)

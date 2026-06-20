# ST-Trend-Strength Indicator

**Status**: ✅ Implemented (rendering as line — histogram TBD)

Target file: `src/app/features/shared/components/flex-chart/indicators/st-trend-strength.indicator.ts`
Backend math: `functions/src/indicators/st-trend-strength.ts`

---

## PineScript Source

- `rb-ta/lib/rb-DI-plus-minus-lib.pine` — DI+/- compute module

---

## File Structure

| Export | Type | Purpose |
|--------|------|---------|
| `ST_TREND_STRENGTH_INDICATOR` | `IndicatorOption` | Chart UI config: pane lower-2, auto scale |
| `calculateStTrendStrength` | `IndicatorCalculator` | Pure function: PriceBar[] → `{ x, y: diHist }[]` |

---

## Theory

Measures directional trend strength using a proprietary adaptation of the Directional Index.
All lookbacks use `HTF_MULTIPLIER = 3` (comparing values 3 bars back instead of 1).
Produces `diHist = DI+ - DI-` which oscillates around zero:
- Positive = bulls in control
- Negative = bears in control
- Magnitude = strength of trend

---

## Algorithm

All lookbacks use `mult = HTF_MULTIPLIER = 3`:

1. **True Range**: `TR = max(H-L, |H - close[i-3]|, |L - close[i-3]|)`
2. **Directional Movement**:
   - `+DM = (H - H[i-3]) > (L[i-3] - L) && (H - H[i-3]) > 0 ? (H - H[i-3]) : 0`
   - `-DM = (L[i-3] - L) > (H - H[i-3]) && (L[i-3] - L) > 0 ? (L[i-3] - L) : 0`
3. **Wilder Smoothing** (period=14, lookback=3):
   - `smoothedTR[i] = smoothedTR[i-3] - (smoothedTR[i-3] / 14) + TR[i]`
   - Same for smoothed+DM and smoothed-DM
4. **DI values**:
   - `DI+ = (smoothed+DM / smoothedTR) × 100`
   - `DI- = (smoothed-DM / smoothedTR) × 100`
   - `diHist = DI+ - DI-`

---

## Parameters

| Key | Default | Description |
|---|---|---|
| `period` | 14 | Wilder smoothing period (ADX_LENGTH) |

**HTF_MULTIPLIER = 3** (hardcoded, non-configurable)

---

## Chart Rendering

- **Pane**: lower-2 (separate from price and zone)
- **Axis**: auto-scaled (typically -50 to +50 range)
- **Reference lines**: 0 (neutral), +10 (upper threshold), -10 (lower threshold)
- **Current**: Line series of diHist values
- **Target (TBD)**: Histogram (column) bars — yellow positive, blue negative

### TradingView Appearance

In TradingView, renders as a histogram with:
- Yellow/gold bars when diHist > 0
- Blue bars when diHist < 0
- Reference lines at 0, ±10

---

## Conversion Notes

- All lookbacks in the DI formula use `mult=3` (compare to bar 3 periods back, not 1)
- Wilder smoothing carries forward from `[i-3]` not `[i-1]`
- ADX and DX are computed in backend math but only diHist is rendered in the chart currently
- Backend also computes cross signals (diHist crosses 0, ±10) and break patterns for strategy use

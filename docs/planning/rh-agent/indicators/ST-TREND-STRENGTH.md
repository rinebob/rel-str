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

## Signal Rules

Two categories of signals derived from diHist values.

### 1. Threshold Crossovers

Three threshold levels: **-10**, **0**, **+10**

**Long entry** — diHist crosses from below to above a threshold:
- Below -10 → above -10 (bearish pressure easing)
- Below 0 → above 0 (bulls take control)
- Below +10 → above +10 (strong bullish momentum)

**Short entry** — diHist crosses from above to below a threshold:
- Above +10 → below +10 (bullish momentum fading)
- Above 0 → below 0 (bears take control)
- Above -10 → below -10 (strong bearish momentum)

### 2. Pullback Breakout

**Long** (diHist > 0):
- Track swing highs (bar higher than both neighbors)
- Value pulls back below the swing high
- Value breaks back above the swing high → **long signal**
- Example: 15 → 12 → 18 → signal fires on the 18 bar
- Resets swing high after each breakout for chaining

**Short** (diHist < 0):
- Track swing lows (bar lower than both neighbors)
- Value pulls back above the swing low (toward zero)
- Value breaks back below the swing low → **short signal**
- Example: -12 → -9 → -14 → signal fires on the -14 bar
- Resets swing low after each breakout for chaining

### Implementation
- Signal detector: `src/app/features/shared/components/flex-chart/signals/st-trend-strength.signals.ts`
- Function: `detectTrendStrengthSignals(indicatorData, bars) → SignalMarker[]`
- Internally combines `detectThresholdCrossovers()` + `detectPullbackBreakouts()`
- Marker placement: bar low for longs, bar high for shorts
- Applied to all timeframes: Daily, Weekly, Monthly

### Future Signal Types (TBD)
- Additional pullback/breakout patterns
- Divergence detection
- Rate-of-change acceleration

---

## Conversion Notes

- All lookbacks in the DI formula use `mult=3` (compare to bar 3 periods back, not 1)
- Wilder smoothing carries forward from `[i-3]` not `[i-1]`
- ADX and DX are computed in backend math but only diHist is rendered in the chart currently
- Backend also computes cross signals (diHist crosses 0, ±10) and break patterns for strategy use

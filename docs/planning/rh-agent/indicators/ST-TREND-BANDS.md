# ST-Trend-Bands Indicator

**Status**: ✅ Implemented & rendering in UI

Target file: `src/app/features/shared/components/flex-chart/indicators/st-trend-bands.indicator.ts`
Backend math: `functions/src/indicators/st-trend-bands.ts`

---

## PineScript Source

- `rb-ta/lib/rb-smha-core.pine` — CTF band engine
- `rb-ta/lib/rb-smha-core-htf.pine` — HTF band engine with jagged stepping
- `rb-ta/ind/rb-smha-four-band-plot.pine` — 4-band composition and plotcandle rendering

---

## File Structure

| Export | Type | Purpose |
|--------|------|---------|
| `ST_TREND_BANDS_INDICATOR` | `IndicatorOption` | Chart UI config: params, pane, axis scale |
| `calculateStTrendBands` | `IndicatorCalculator` | Returns band midpoints for line rendering |
| `computeAllBands` | `function` | Returns 4 `BandSeriesData[]` for Candle series rendering |
| `BandSeriesData` | `interface` | Per-band OHLC data + colors |

---

## Theory

Smoothed Heikin-Ashi Moving Average bands. Four bands of increasing timeframe create a nested
trend structure — fast bands react quickly, slow/HTF bands show dominant trend direction.
When all bands align (same color), strong trend is in effect.

---

## Algorithm

Per band (`computeBand(bars, smoothLen, afterLen, mult)`):

1. **Pre-smooth** raw OHLC with `EMA(smoothLen × mult)` → smoothed O, H, L, C
2. **HA transform** on smoothed OHLC:
   - `haClose = (O + H + L + C) / 4`
   - `haOpen[i] = isFirst ? (O + C) / 2 : (haOpen[i-mult] + haClose[i-mult]) / 2`
   - `haHigh = max(H, haOpen, haClose)`
   - `haLow = min(L, haOpen, haClose)`
3. **Post-smooth** HA OHLC with `EMA(afterLen × mult)` → final band O, H, L, C
4. **Force body**: `H = max(O, C)`, `L = min(O, C)`, `mid = L + |H-L|/2`
5. **Trend direction**: `up = C > O`

### Four Bands

| Band | Engine | Lengths | Effective EMA | Colors |
|---|---|---|---|---|
| Band 1 (CTF fast) | CTF (mult=1) | 5/5 | 5 | Yellow up / Blue down |
| Band 2 (CTF slow) | CTF (mult=1) | 10/10 | 10 | Yellow up / Blue down |
| Band 3 (HTF fast) | HTF (mult=3) | 5/5 | 15 | Orange up / Dark blue down |
| Band 4 (HTF slow) | HTF (mult=3) | 10/10 | 30 | Orange up / Dark blue down |

---

## Parameters

| Key | Default | Description |
|---|---|---|
| `ctfFastLength` | 5 | CTF fast pre-smooth and post-smooth length |
| `ctfSlowLength` | 10 | CTF slow pre-smooth and post-smooth length |

**HTF_MULTIPLIER = 3** (hardcoded, non-configurable)

---

## Chart Rendering

- **Pane**: overlay (main price pane)
- **Series type**: 4 × Candle (`type="Candle"`, `enableSolidCandles=true`)
- **Opacity**: 0.7
- **Data flow**: `computeAllBands(bars)` → `BandSeriesData[]` → 4 Candle series

The flex-chart component detects `st-trend-bands` in mainPaneSeries and triggers `trendBandSeries()`
computed signal which calls `computeAllBands()` directly (bypasses standard line rendering).

---

## Conversion Notes

- EMA must skip leading NaN values (cascaded EMAs produce NaN prefix)
- HTF bands use `haOpen[i - mult]` (lookback of 3) for recursive HA state
- HTF "jagged stepping" is implicit in the mult=3 lookback — values naturally hold for 3 bars
- No explicit `closeTimeMatch` needed since we multiply EMA lengths instead of sampling HTF bars

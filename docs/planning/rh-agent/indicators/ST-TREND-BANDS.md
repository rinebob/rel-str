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

---

## ST-TrendBandWidth

**Status**: 🔲 Planned

**Purpose**: Measures the total vertical span of all 4 bands combined at each bar. Captures the compression → expansion → pullback rhythm that precedes high-probability trend continuation entries.

---

### Definition

At each bar index `i`:

```
totalBandWidth[i] = max(band1.h[i], band2.h[i], band3.h[i], band4.h[i])
                  - min(band1.l[i], band2.l[i], band3.l[i], band4.l[i])
```

This is a derived series from `TrendBandsResult` — no new indicator math required, one pass over existing output.

---

### Derived Series

No moving averages. All values are derived purely from the width series itself using ratio comparisons and rolling min/max.

| Series | Formula | Purpose |
|---|---|---|
| `width[i]` | `max(band1.h, band2.h, band3.h, band4.h) - min(band1.l, band2.l, band3.l, band4.l)` | Raw total band span at bar i |
| `widthMin[i]` | `min(width[i-N .. i])` | Rolling N-bar minimum — baseline for compression |
| `widthMax[i]` | `max(width[i-N .. i])` | Rolling N-bar maximum — baseline for expansion |
| `expansionRatio[i]` | `width[i] / width[i - N]` | How much wider now vs N bars ago — spike = breakout |
| `spiked[i]` | `expansionRatio[i] > expansionThreshold` | True on bars where a significant expansion occurred |
| `barsSinceSpike[i]` | bars since last `spiked` was true | Tracks recency of the expansion event |
| `recentlyExpanded[i]` | `barsSinceSpike[i] <= maxPullbackBars` | Expansion happened recently enough to be valid |
| `stillElevated[i]` | `expansionRatio[i] > retainThreshold` | Width hasn't collapsed back — still in expanded regime |
| `validSetup[i]` | `recentlyExpanded[i] && stillElevated[i]` | Combined regime gate — use this to filter signals |

Suggested defaults (to be validated via backtest):

| Parameter | Default | Meaning |
|---|---|---|
| `N` | 10 | Lookback for ratio and rolling min/max |
| `expansionThreshold` | 1.25 | Width must be 25% wider than N bars ago to count as a spike |
| `retainThreshold` | 1.10 | Width must still be 10% wider than N bars ago at signal bar |
| `maxPullbackBars` | 10 | Spike must have occurred within last 10 bars |

---

### Pattern: Compression → Expansion → Pullback

The target setup:

1. **Compression** — `width` is near its N-bar low (`width[i] ≈ widthMin[i]`). Bands are tight, price is ranging.
2. **Expansion spike** — `expansionRatio` crosses above `expansionThreshold`. Bands widen rapidly — the breakout bar.
3. **Pullback** — price retraces, zone drops. `recentlyExpanded` is true, `stillElevated` is true.
4. **Resumption** — zone upticks (or downticks for short). `validSetup` is true. **This is the entry signal.**
5. **Repeat** — second and third pullback/resumption cycles remain valid as long as `validSetup` stays true.
6. **Failure swing** — first zone move in the opposite direction that fails to hold. `validSetup` may also turn false as bands contract.

**Rocket vs rubber band**: rubber bands fail `stillElevated` — by the time they reverse, the bands have already snapped back. Rockets pass because the pullback occurs while bands are still wide.

---

### Integration with Zone Signals

`ST-TrendBandWidth` is a **regime gate** only. It does not replace zone signals — it filters them.

A zone uptick or downtick is promoted to a high-confidence signal when `validSetup[i]` is true at the signal bar. Any direction is valid (uptick for long, downtick for short) — directional bias comes from the zone transition itself, not from this indicator.

---

### Implementation Plan

**Step 1 — Backend math** (`functions/src/indicators/st-trend-bands.ts`)
- Add `TrendBandWidthResult` interface:
  ```ts
  export interface TrendBandWidthResult {
    width:            number[];   // raw total band span per bar
    expansionRatio:   number[];   // width[i] / width[i-N]
    spiked:           boolean[];  // expansionRatio > expansionThreshold
    barsSinceSpike:   number[];   // bars since last spiked=true
    recentlyExpanded: boolean[];  // barsSinceSpike <= maxPullbackBars
    stillElevated:    boolean[];  // expansionRatio > retainThreshold
    validSetup:       boolean[];  // recentlyExpanded && stillElevated
  }
  ```
- Add `computeTrendBandWidth(bands: TrendBandsResult, params?): TrendBandWidthResult`
- Export from `functions/src/indicators/index.ts`

**Step 2 — Add enum value** (`src/app/features/shared/components/flex-chart/flex-chart.types.ts`)
- Add `TREND_BAND_WIDTH = 'st-trend-band-width'` to `StIndicator` enum

**Step 3 — Frontend indicator file** (new `src/app/features/shared/components/flex-chart/indicators/st-trend-band-width.indicator.ts`)
- `ST_TREND_BAND_WIDTH_INDICATOR` config:
  - `defaultPane: 'lower-1'` — same pane as ST-TrendStrength to overlay and compare
  - `axisScale: 'auto'`
- `calculateStTrendBandWidth` calculator:
  - Returns per-bar line series of raw `width` values
  - Color: green (`#4caf50`) when `validSetup` is true, grey (`#666666`) when false
- `computeBandWidthDots` function:
  - Returns scatter dots on the **price pane (main)** at bars where `validSetup` is true
  - Color: green for long context, consistent with zone uptick dots

**Step 4 — Register** (`indicator-registry.ts`)
- Export `ST_TREND_BAND_WIDTH_INDICATOR` and `calculateStTrendBandWidth`
- Add to `indicatorCalculators` map: `[StIndicator.TREND_BAND_WIDTH]: calculateStTrendBandWidth`
- Add `SERIES_TYPE_MAP` entry: `[StIndicator.TREND_BAND_WIDTH]: 'line'`
- Add to `ST_INDICATOR_OPTIONS`

**Step 5 — Backtest validation** (`functions/scripts/backtest-zone-filters.ts`)
- Compute `TrendBandWidthResult` per symbol alongside existing zone signals
- Add filter categories: `validSetup only`, `with-trend + validSetup`, `counter-trend + validSetup`, `validSetup + zone depth`
- Run against full symbol universe, review signal count vs win rate before any strategy changes

**Step 6 — Visual review**
- Enable indicator on charts, tune `expansionThreshold` and `maxPullbackBars` visually
- Confirm width line and validSetup dots align with expected compression → expansion → pullback setups

**Step 7 — Strategy integration (only after Steps 5 & 6 confirm value)**
- Apply `validSetup` as a post-filter in the strategy or pass into signal detection
- Tag signals with `widthValidSetup: true/false` in the `indicators` map for UI display

---

### Open Questions (resolve via backtest + visual review)

- What `expansionThreshold` best separates real breakouts from noise? (start at 1.25, test 1.15–1.40)
- What `maxPullbackBars` captures the first pullback without being too permissive? (start at 10)
- Do weekly signals need different thresholds given fewer bars per year?
- Does `validSetup` correlate with `diHist` spikes on ST-TrendStrength? (visual check on shared pane)
